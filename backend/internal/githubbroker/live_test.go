package githubbroker

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// TestLiveGitHub is the opt-in live check against real GitHub. It is skipped
// unless all of the following are set:
//
//	FLORA_PROBE_LIVE=1          explicit opt-in
//	FLORA_PROBE_REPO=owner/name a private repository designated for testing
//	FLORA_BROKER_GH_TOKEN       fine-grained token restricted to that repo
//
// It proves the broker transport against the real github.com and
// api.github.com: repository metadata through the API surface and a real
// `git ls-remote` through the smart-HTTP surface. It performs no mutations.
// Container end-to-end execution additionally requires Docker; see
// agent/probes/github/run-probe.sh.
func TestLiveGitHub(t *testing.T) {
	if os.Getenv("FLORA_PROBE_LIVE") != "1" {
		t.Skip("set FLORA_PROBE_LIVE=1, FLORA_PROBE_REPO, and FLORA_BROKER_GH_TOKEN to run")
	}
	repo, err := normalizeRepo(os.Getenv("FLORA_PROBE_REPO"))
	if err != nil {
		t.Fatalf("FLORA_PROBE_REPO: %v", err)
	}
	token := os.Getenv("FLORA_BROKER_GH_TOKEN")
	if token == "" {
		t.Fatal("FLORA_BROKER_GH_TOKEN is required")
	}
	store := newStore(t)
	broker, err := New(Config{Token: token, Store: store})
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(broker)
	defer front.Close()

	cap, err := store.Mint("live-probe", 30*time.Minute)
	if err != nil {
		t.Fatal(err)
	}

	// gh-style API call: view repository metadata through the broker.
	req, err := http.NewRequest(http.MethodGet, front.URL+"/api/v3/repos/"+repo, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "token "+cap.ID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var body struct {
		FullName string `json:"full_name"`
		Private  bool   `json:"private"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("repository view failed: %s", resp.Status)
	}
	if !strings.EqualFold(body.FullName, repo) {
		t.Fatalf("unexpected repository %q, want %q", body.FullName, repo)
	}
	t.Logf("viewed repository %s (private=%t) through broker", body.FullName, body.Private)

	// Ordinary git: ls-remote through the broker using only the capability.
	if _, err := exec.LookPath("git"); err == nil {
		out, err := gitMayFail("", nil, "ls-remote", front.URL+"/"+repo+".git")
		if err == nil {
			t.Fatal("ls-remote without capability unexpectedly succeeded")
		}
		u := mustParse(t, front.URL)
		u.User = url.User(cap.ID)
		out, err = gitMayFail("", nil, "ls-remote", u.String()+"/"+repo+".git")
		if err != nil {
			t.Fatalf("ls-remote with capability failed: %v\n%s", err, out)
		}
		if strings.Contains(out, token) {
			t.Fatal("administrator token leaked into git output")
		}
		t.Log("git ls-remote through broker succeeded")
	}

	// Revocation must cut live access immediately.
	if err := store.Revoke(cap.ID); err != nil {
		t.Fatal(err)
	}
	req2, err := http.NewRequest(http.MethodGet, front.URL+"/api/v3/repos/"+repo, nil)
	if err != nil {
		t.Fatal(err)
	}
	req2.Header.Set("Authorization", "token "+cap.ID)
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatal(err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked capability still authorized: %s", resp2.Status)
	}
	t.Log("revoked capability denied against live GitHub")
}
