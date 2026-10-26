package githubbroker

import (
	"bytes"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGitCloneFetchPushMultipleRepositories(t *testing.T) {
	rig := newRig(t)
	cap := mintCap(t, rig.Store, "chat-1")
	for _, repo := range []string{"octo/demo", "octo/other"} {
		work := filepath.Join(t.TempDir(), "clone")
		gitRun(t, "", "clone", rig.cloneURL(cap, repo), work)
		if !rig.gitBack.SawToken {
			t.Fatal("upstream did not receive token")
		}
		cfg := gitRun(t, work, "config", "--get", "remote.origin.url")
		if strings.Contains(cfg, rig.adminToken) {
			t.Fatal("admin token in git config")
		}
		if err := os.WriteFile(filepath.Join(work, "change.txt"), []byte("hello\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		gitRun(t, work, "add", "change.txt")
		gitRun(t, work, "-c", "user.email=probe@example.com", "-c", "user.name=Probe", "commit", "-m", "container change")
		gitRun(t, work, "push", "origin", "HEAD:main")
		gitRun(t, work, "fetch", "origin")
		work2 := filepath.Join(t.TempDir(), "clone2")
		gitRun(t, "", "clone", rig.cloneURL(cap, repo), work2)
		if _, err := os.Stat(filepath.Join(work2, "change.txt")); err != nil {
			t.Fatal(err)
		}
	}
}

func TestTransparentForwarding(t *testing.T) {
	rig := newRig(t)
	cap := mintCap(t, rig.Store, "chat-1")
	// These include the formerly pruned traversal fields, unrecognized fields,
	// multiple operations, opaque IDs, account operations and non-PR writes.
	cases := []struct{ method, path, upstream, body string }{
		{"POST", "/api/graphql?trace=a%2Fb", "/graphql?trace=a%2Fb", ` { "query":"fragment R on Repository { id parent { id } } query A { a:repository(owner:\"octo\",name:\"demo\") { ...R owner { repositories(first:10) { nodes { name } } } } b:repository(owner:\"octo\",name:\"other\") { id } } query B { viewer { email } }", "operationName":"A", "variables":{"untouched":1}, "extensions":{"x":true} } `},
		{"POST", "/api/graphql", "/graphql", `{"query":"mutation($input:CreatePullRequestInput!) { createPullRequest(input:$input) { pullRequest { headRepository { id } } } }","variables":{"input":{"repositoryId":"opaque-id"}}}`},
		{"POST", "/api/graphql", "/graphql", `{"query":"query { node(id:\"opaque\") { ... on Repository { parent @include(if:true) { id } } } }"}`},
		{"POST", "/api/graphql", "/graphql", "malformed JSON is GitHub's decision"},
		{"GET", "/api/v3/user?x=1&x=2", "/user?x=1&x=2", ""},
		{"GET", "/api/v3/repos/octo/other/contents/a%2Fb", "/repos/octo/other/contents/a%2Fb", ""},
		{"DELETE", "/api/v3/repos/octo/other", "/repos/octo/other", ""},
		{"PUT", "/api/v3/repos/octo/demo/pulls/1/merge", "/repos/octo/demo/pulls/1/merge", `{"merge_method":"squash"}`},
		{"POST", "/api/v3/repos/octo/other/issues", "/repos/octo/other/issues", ` {"title":"hello"} `},
		{"GET", "/api/v3//evil.test/path?url=https://evil.test", "//evil.test/path?url=https://evil.test", ""},
		{"GET", "/api/v3/repos/octo/demo/../other", "/repos/octo/demo/../other", ""},
	}
	for _, tc := range cases {
		t.Run(tc.method+tc.path+tc.body, func(t *testing.T) {
			hits := 0
			rig.apiUp.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				hits++
				body, _ := io.ReadAll(r.Body)
				if r.Method != tc.method || r.URL.RequestURI() != tc.upstream || string(body) != tc.body {
					t.Errorf("request modified: %s %s %s", r.Method, r.URL.RequestURI(), body)
				}
				if r.Header.Get("Authorization") != "Bearer "+rig.adminToken || r.Header.Get("Cookie") != "" || r.Header.Get("Proxy-Authorization") != "" {
					t.Error("credential boundary failed")
				}
				if r.Header.Get("Accept") != "application/vnd.github+json" || r.Header.Get("X-Github-Api-Version") != "2022-11-28" {
					t.Error("API headers modified")
				}
				w.Header().Set("X-GitHub-Request-Id", "fixture-id")
				w.WriteHeader(http.StatusAccepted)
				io.WriteString(w, `{"upstream":"unchanged"}`)
			})
			req, _ := http.NewRequest(tc.method, rig.front.URL+tc.path, strings.NewReader(tc.body))
			req.Header.Set("Authorization", "token "+cap.ID)
			req.Header.Set("Cookie", "container-session=private")
			req.Header.Set("Proxy-Authorization", "Basic container-secret")
			req.Header.Set("Accept", "application/vnd.github+json")
			req.Header.Set("X-Github-Api-Version", "2022-11-28")
			req.Host = "evil.test" // Incoming Host never selects the upstream.
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			body, _ := io.ReadAll(resp.Body)
			if hits != 1 || resp.StatusCode != 202 || string(body) != `{"upstream":"unchanged"}` || resp.Header.Get("X-GitHub-Request-Id") != "fixture-id" {
				t.Fatalf("response modified or extra lookup: hits=%d status=%d body=%s", hits, resp.StatusCode, body)
			}
		})
	}
}

func TestUpstreamDenialsPreserved(t *testing.T) {
	rig := newRig(t)
	cap := mintCap(t, rig.Store, "chat")
	for _, code := range []int{401, 403, 404, 422, 429} {
		rig.apiUp.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("WWW-Authenticate", `Basic realm="GitHub"`)
			w.Header().Set("Retry-After", "60")
			w.WriteHeader(code)
			io.WriteString(w, `{"message":"Resource not accessible by personal access token"}`)
		})
		for _, path := range []string{"/api/v3/repos/private/denied", "/api/graphql"} {
			resp := doReq(t, "POST", rig.front.URL+path, "Bearer "+cap.ID, strings.NewReader("{}"))
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			if resp.StatusCode != code || string(body) != `{"message":"Resource not accessible by personal access token"}` || resp.Header.Get("Retry-After") != "60" || resp.Header.Get("WWW-Authenticate") != "" {
				t.Fatalf("upstream denial modified: %d %s", resp.StatusCode, body)
			}
		}
	}
	// GitHub GraphQL also reports permission errors in HTTP 200 responses.
	rig.apiUp.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"data":{"repository":null},"errors":[{"type":"NOT_FOUND"}]}`)
	})
	resp := doReq(t, "POST", rig.front.URL+"/api/graphql", "token "+cap.ID, strings.NewReader("{}"))
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || string(body) != `{"data":{"repository":null},"errors":[{"type":"NOT_FOUND"}]}` {
		t.Fatal("GraphQL denial changed")
	}
}

func TestCapabilityDenialsAndIndependentRevocation(t *testing.T) {
	rig := newRig(t)
	good := mintCap(t, rig.Store, "chat-1")
	revoked := mintCap(t, rig.Store, "chat-2")
	if err := rig.Store.Revoke(revoked.ID); err != nil {
		t.Fatal(err)
	}
	expired, err := rig.Store.Mint("chat-3", -time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	hits := 0
	upstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++; io.WriteString(w, "ok") })
	rig.apiUp.Config.Handler = upstream
	rig.gitUp.Config.Handler = upstream
	for _, id := range []string{"", "flora_cap_unknown", revoked.ID, expired.ID, rig.adminToken} {
		for _, path := range []string{"/api/graphql", "/api/v3/user", "/octo/demo.git/info/refs?service=git-upload-pack"} {
			resp := doReq(t, "GET", rig.front.URL+path, "Bearer "+id, nil)
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			if resp.StatusCode != 401 || strings.Contains(string(body), rig.adminToken) {
				t.Fatalf("invalid capability: %d %s", resp.StatusCode, body)
			}
		}
	}
	if hits != 0 {
		t.Fatal("denied capability reached upstream")
	}
	resp := doReq(t, "GET", rig.front.URL+"/api/v3/repos/octo/other", "token "+good.ID, nil)
	resp.Body.Close()
	if resp.StatusCode != 200 || hits != 1 {
		t.Fatal("revoking another chat affected live capability")
	}
}

func TestDestinationAndRedirectProtection(t *testing.T) {
	rig := newRig(t)
	cap := mintCap(t, rig.Store, "chat")
	hits := 0
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	defer target.Close()
	rig.apiUp.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL+"/stolen", 302) })
	resp := doReqNoFollow(t, "GET", rig.front.URL+"/api/v3/user", "token "+cap.ID, nil)
	resp.Body.Close()
	if resp.StatusCode != 302 || hits != 0 {
		t.Fatal("redirect followed")
	}
	req, _ := http.NewRequest("GET", target.URL, nil)
	req.Header.Set("Authorization", "Bearer "+rig.adminToken)
	if resp, err := rig.broker.client.Do(req); err == nil {
		resp.Body.Close()
		t.Fatal("foreign destination accepted")
	}
	if hits != 0 {
		t.Fatal("foreign destination reached")
	}
	for _, destination := range []string{"http://github.com", "https://github.com.evil.test", "https://api.github.com:444", "https://github.com@evil.test"} {
		req, _ := http.NewRequest("GET", destination, nil)
		if resp, err := rig.broker.client.Do(req); err == nil {
			resp.Body.Close()
			t.Fatal("unintended origin accepted")
		}
	}
	for _, method := range []string{"GET", "CONNECT"} {
		req := httptest.NewRequest(method, "http://evil.test/api/v3/user", nil)
		req.Header.Set("Authorization", "token "+cap.ID)
		w := httptest.NewRecorder()
		rig.broker.ServeHTTP(w, req)
		if w.Code != 400 {
			t.Fatal("forward proxy request accepted")
		}
	}
	for _, cfg := range []Config{
		{Token: "real-secret", Store: rig.Store, APIUpstream: mustParse(t, target.URL)},
		{Token: "real-secret", Store: rig.Store, OfflineTest: true, APIUpstream: mustParse(t, target.URL)},
		{Token: OfflineTestToken, Store: rig.Store, OfflineTest: true, APIUpstream: mustParse(t, "http://evil.test")},
	} {
		if _, err := New(cfg); err == nil {
			t.Fatal("unsafe upstream configuration accepted")
		}
	}
}

func TestNoCredentialLeakInLogsOrResponses(t *testing.T) {
	rig := newRig(t)
	cap := mintCap(t, rig.Store, "chat")
	var logs bytes.Buffer
	rig.broker.logger = slog.New(slog.NewTextHandler(&logs, nil))
	for _, path := range []string{"/api/v3/user?credential=" + cap.ID, "/api/graphql"} {
		resp := doReq(t, "GET", rig.front.URL+path, "token "+cap.ID, nil)
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if strings.Contains(string(body), rig.adminToken) {
			t.Fatal("admin token in response")
		}
	}
	rig.broker.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return nil, errors.New("transport error with secret " + rig.adminToken)
	})
	resp := doReq(t, "GET", rig.front.URL+"/api/v3/user", "token "+cap.ID, nil)
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 502 || strings.Contains(string(body), rig.adminToken) {
		t.Fatal("transport error leaked")
	}
	if strings.Contains(logs.String(), rig.adminToken) || strings.Contains(logs.String(), cap.ID) {
		t.Fatal("credential in logs")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestProductionTokenDestinations(t *testing.T) {
	b, err := New(Config{Token: "test-secret-never-sent-to-network", Store: newStore(t)})
	if err != nil {
		t.Fatal(err)
	}
	transport := b.client.Transport.(*authTransport)
	if transport.base.(*http.Transport).Proxy != nil {
		t.Fatal("environment proxy enabled")
	}
	hits := 0
	transport.base = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		hits++
		if r.Header.Get("Authorization") != "Bearer test-secret-never-sent-to-network" {
			t.Fatal("missing upstream token")
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("ok"))}, nil
	})
	for _, origin := range []string{"https://github.com", "https://api.github.com"} {
		req, _ := http.NewRequest("GET", origin+"/path", nil)
		resp, err := b.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
	}
	for _, origin := range []string{"http://github.com", "https://github.com.evil.test", "https://api.github.com:444", "https://github.com@evil.test", "https://evil.test"} {
		req, _ := http.NewRequest("GET", origin, nil)
		if resp, err := b.client.Do(req); err == nil {
			resp.Body.Close()
			t.Fatalf("accepted %s", origin)
		}
	}
	req, _ := http.NewRequest("GET", "https://github.com/path", nil)
	req.Host = "evil.test"
	if resp, err := b.client.Do(req); err == nil {
		resp.Body.Close()
		t.Fatal("Host mismatch accepted")
	}
	if hits != 2 {
		t.Fatalf("unintended destination reached transport: %d", hits)
	}
}
