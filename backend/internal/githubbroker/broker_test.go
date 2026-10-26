package githubbroker

import (
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestGitCloneFetchPushThroughBroker proves ordinary git works through the
// broker: a container-style remote URL (capability as username, no
// administrator token anywhere container-side) clones, fetches, and pushes
// against a smart-HTTP upstream that requires the administrator token.
func TestGitCloneFetchPushThroughBroker(t *testing.T) {
	rig := newRig(t)
	cap := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)

	work := filepath.Join(t.TempDir(), "clone")
	gitRun(t, "", "clone", rig.cloneURL(cap, "octo/demo"), work)
	if _, err := os.Stat(filepath.Join(work, "README.md")); err != nil {
		t.Fatalf("clone missing README.md: %v", err)
	}
	if !rig.gitBack.SawToken {
		t.Fatal("upstream never saw the administrator token; broker did not inject it")
	}

	// The remote URL persisted in the container's .git/config must carry
	// only the capability, never the administrator token.
	cfg := gitRun(t, work, "config", "--get", "remote.origin.url")
	if strings.Contains(cfg, rig.adminToken) {
		t.Fatal("administrator token leaked into persisted git config")
	}

	// Commit and push through the broker.
	if err := os.WriteFile(filepath.Join(work, "change.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitRun(t, work, "add", "change.txt")
	gitRun(t, work, "-c", "user.email=probe@example.com", "-c", "user.name=Probe",
		"commit", "-m", "container change")
	gitRun(t, work, "push", "origin", "HEAD:main")

	// A second clone sees the pushed commit, and fetch works.
	work2 := filepath.Join(t.TempDir(), "clone2")
	gitRun(t, "", "clone", rig.cloneURL(cap, "octo/demo"), work2)
	if _, err := os.Stat(filepath.Join(work2, "change.txt")); err != nil {
		t.Fatalf("pushed change not visible in second clone: %v", err)
	}
	gitRun(t, work2, "fetch", "origin")
}

// TestReadOnlyCapabilityCannotPush checks operation scoping for git.
func TestReadOnlyCapabilityCannotPush(t *testing.T) {
	rig := newRig(t)
	cap := mintCap(t, rig.Store, "chat-ro", []string{"octo/demo"}, false)

	work := filepath.Join(t.TempDir(), "clone")
	gitRun(t, "", "clone", rig.cloneURL(cap, "octo/demo"), work) // fetch allowed
	if err := os.WriteFile(filepath.Join(work, "nope.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitRun(t, work, "add", "nope.txt")
	gitRun(t, work, "-c", "user.email=probe@example.com", "-c", "user.name=Probe",
		"commit", "-m", "should not push")
	out, err := gitMayFail(work, nil, "push", "origin", "HEAD:main")
	if err == nil {
		t.Fatalf("read-only capability pushed successfully; output:\n%s", out)
	}
}

// TestGitDenials covers authentication and per-chat/per-repository scoping
// failures at the git transport.
func TestGitDenials(t *testing.T) {
	rig := newRig(t)
	good := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)
	otherRepo := mintCap(t, rig.Store, "chat-2", []string{"octo/other"}, true)
	revoked := mintCap(t, rig.Store, "chat-3", []string{"octo/demo"}, true)
	if err := rig.Store.Revoke(revoked.ID); err != nil {
		t.Fatal(err)
	}
	expired, err := rig.Store.Mint("chat-4", []string{"octo/demo"}, true, -time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(t.TempDir(), "x")

	cases := []struct {
		name string
		url  string
	}{
		{"no capability", rig.front.URL + "/octo/demo.git"},
		{"unknown capability", strings.Replace(rig.cloneURL(good, "octo/demo"), good.ID, "flora_cap_deadbeef", 1)},
		{"revoked capability", rig.cloneURL(revoked, "octo/demo")},
		{"expired capability", rig.cloneURL(expired, "octo/demo")},
		// Cross-chat: chat-2's capability was minted for octo/other and
		// must not reach chat-1's repository.
		{"cross-chat repository", rig.cloneURL(otherRepo, "octo/demo")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, err := gitMayFail("", nil, "clone", tc.url, dst)
			if err == nil {
				t.Fatalf("clone unexpectedly succeeded; output:\n%s", out)
			}
			if strings.Contains(out, rig.adminToken) {
				t.Fatalf("administrator token leaked into git output:\n%s", out)
			}
		})
	}
}

// TestHTTPDenialShapes verifies denial status codes directly.
func TestHTTPDenialShapes(t *testing.T) {
	rig := newRig(t)
	good := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)
	readOnly := mintCap(t, rig.Store, "chat-ro", []string{"octo/demo"}, false)

	check := func(name, method, path, auth string, want int) {
		t.Helper()
		resp := doReq(t, method, rig.front.URL+path, auth, nil)
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != want {
			t.Errorf("%s: got %d, want %d; body: %s", name, resp.StatusCode, want, body)
		}
		if strings.Contains(string(body), rig.adminToken) {
			t.Errorf("%s: response leaked the administrator token", name)
		}
	}

	basic := "Basic " + base64Of(good.ID+":")
	basicRO := "Basic " + base64Of(readOnly.ID+":")
	check("missing auth", "GET", "/octo/demo.git/info/refs?service=git-upload-pack", "", http.StatusUnauthorized)
	check("authorized fetch refs", "GET", "/octo/demo.git/info/refs?service=git-upload-pack", basic, http.StatusOK)
	check("read-only receive-pack refs", "GET", "/octo/demo.git/info/refs?service=git-receive-pack", basicRO, http.StatusForbidden)
	check("unknown path", "GET", "/etc/passwd", basic, http.StatusNotFound)
	// The administrator token itself is never a valid container credential.
	check("admin token as bearer", "GET", "/octo/demo.git/info/refs?service=git-upload-pack",
		"Bearer "+rig.adminToken, http.StatusUnauthorized)
}

// TestRESTAPIScoping exercises the gh-style API surface: authorized
// repository calls pass, cross-repository and account-level calls are
// denied, and read-only capabilities cannot mutate.
func TestRESTAPIScoping(t *testing.T) {
	rig := newRig(t)
	writeCap := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)
	readCap := mintCap(t, rig.Store, "chat-ro", []string{"octo/demo"}, false)

	check := func(name, method, path, auth string, want int) {
		t.Helper()
		resp := doReq(t, method, rig.front.URL+path, auth, strings.NewReader(`{"title":"x"}`))
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != want {
			t.Errorf("%s: got %d, want %d; body: %s", name, resp.StatusCode, want, body)
		}
		if strings.Contains(string(body), rig.adminToken) {
			t.Errorf("%s: response leaked the administrator token", name)
		}
	}

	auth := "token " + writeCap.ID
	authRO := "token " + readCap.ID
	check("view pulls", "GET", "/api/v3/repos/octo/demo/pulls", auth, http.StatusOK)
	check("create draft PR", "POST", "/api/v3/repos/octo/demo/pulls", auth, http.StatusOK)
	check("cross-repository", "GET", "/api/v3/repos/octo/other/pulls", auth, http.StatusForbidden)
	check("account-level endpoint", "GET", "/api/v3/user", auth, http.StatusForbidden)
	check("read-only mutation", "POST", "/api/v3/repos/octo/demo/pulls", authRO, http.StatusForbidden)
	check("read-only read", "GET", "/api/v3/repos/octo/demo/pulls", authRO, http.StatusOK)
}

// TestGraphQLScoping checks the conservative repository-attribution
// heuristic used for gh pr view/create traffic.
func TestGraphQLScoping(t *testing.T) {
	rig := newRig(t)
	cap := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)
	auth := "token " + cap.ID

	check := func(name, body string, want int) {
		t.Helper()
		resp := doReq(t, http.MethodPost, rig.front.URL+"/api/graphql", auth, strings.NewReader(body))
		defer resp.Body.Close()
		respBody, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != want {
			t.Errorf("%s: got %d, want %d; body: %s", name, resp.StatusCode, want, respBody)
		}
		if strings.Contains(string(respBody), rig.adminToken) {
			t.Errorf("%s: response leaked the administrator token", name)
		}
	}

	check("attributed query allowed",
		`{"query":"query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ id } }","variables":{"owner":"octo","name":"demo"}}`,
		http.StatusOK)
	check("mutation allowed for write capability",
		`{"query":"mutation($owner:String!,$name:String!){ createPullRequest(input:{repositoryId:\"x\"}){ pullRequest { url } } } repository(owner:$owner,name:$name)","variables":{"owner":"octo","name":"demo"}}`,
		http.StatusOK)
	check("foreign repository denied",
		`{"query":"query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ id } }","variables":{"owner":"octo","name":"other"}}`,
		http.StatusForbidden)
	check("unattributed query denied",
		`{"query":"query { viewer { login } }"}`,
		http.StatusForbidden)
}

// TestRedirectProtection proves the broker never follows upstream redirects
// and never forwards the administrator token to another host.
func TestRedirectProtection(t *testing.T) {
	rig := newRig(t)
	cap := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)

	var targetHits int
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		targetHits++
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("redirect target received an Authorization header: %q", got)
		}
	}))
	defer target.Close()

	redirecting := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/stolen", http.StatusFound)
	}))
	defer redirecting.Close()

	gitURL := mustParse(t, rig.gitUp.URL)
	redirURL := mustParse(t, redirecting.URL)
	broker, err := New(Config{
		Token:       rig.adminToken,
		GitUpstream: gitURL,
		APIUpstream: redirURL,
		Store:       rig.Store,
	})
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(broker)
	defer front.Close()

	resp := doReqNoFollow(t, http.MethodGet, front.URL+"/api/v3/repos/octo/demo/pulls", "token "+cap.ID, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("broker should surface the redirect unfollowed; got %d", resp.StatusCode)
	}
	if targetHits != 0 {
		t.Fatalf("broker followed the redirect %d times", targetHits)
	}

	// Defense in depth: even if a request is aimed at a foreign host, the
	// injecting transport must withhold the administrator token.
	foreign := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("foreign host received an Authorization header: %q", got)
		}
	}))
	defer foreign.Close()
	req, err := http.NewRequest(http.MethodGet, foreign.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := broker.client.Do(req); err != nil {
		t.Fatal(err)
	}
}

// TestUpstream401DoesNotChallengeContainer ensures an upstream credential
// failure cannot turn into an interactive prompt inside the container.
func TestUpstream401DoesNotChallengeContainer(t *testing.T) {
	rig := newRig(t)
	rig.apiUp.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("WWW-Authenticate", `Basic realm="GitHub"`)
		http.Error(w, "bad credentials", http.StatusUnauthorized)
	})
	cap := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)
	resp := doReq(t, http.MethodGet, rig.front.URL+"/api/v3/repos/octo/demo/pulls", "token "+cap.ID, nil)
	defer resp.Body.Close()
	if got := resp.Header.Get("WWW-Authenticate"); got != "" {
		t.Fatalf("upstream challenge forwarded to container: %q", got)
	}
}

func base64Of(s string) string {
	return base64.StdEncoding.EncodeToString([]byte(s))
}
