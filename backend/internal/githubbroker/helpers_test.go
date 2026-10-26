package githubbroker

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// newGitBackend serves a real git smart-HTTP endpoint for the bare
// repositories under projectRoot, requiring the administrator-style token
// so tests prove the broker injects credentials upstream.
func newGitBackend(projectRoot, token string) *GitBackend {
	return &GitBackend{ProjectRoot: projectRoot, RequireToken: token}
}

// seedBareRepo creates a bare repository with one commit under dir.
func seedBareRepo(t *testing.T, dir, name string) string {
	t.Helper()
	bare := filepath.Join(dir, name+".git")
	gitRun(t, "", "init", "--bare", "-b", "main", bare)
	work := filepath.Join(t.TempDir(), "work")
	gitRun(t, "", "clone", bare, work)
	if err := os.WriteFile(filepath.Join(work, "README.md"), []byte("probe\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitRun(t, work, "add", "README.md")
	gitRun(t, work, "-c", "user.email=probe@example.com", "-c", "user.name=Probe",
		"commit", "-m", "initial")
	gitRun(t, work, "push", "origin", "HEAD:main")
	return bare
}

func gitRun(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, out)
	}
	return string(out)
}

// gitMayFail runs git and expects failure, returning combined output.
func gitMayFail(dir string, env []string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	cmd.Env = append(cmd.Env, env...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func newStore(t *testing.T) *Store {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "capabilities.json"))
	if err != nil {
		t.Fatal(err)
	}
	return store
}

// probeRig wires a broker in front of a fake git upstream and a fake API
// upstream, all on httptest servers.
type probeRig struct {
	t          *testing.T
	adminToken string
	gitBack    *GitBackend
	gitUp      *httptest.Server
	apiUp      *httptest.Server
	apiHandler http.HandlerFunc
	broker     *Broker
	front      *httptest.Server
	Store      *Store
}

func newRig(t *testing.T) *probeRig {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git binary required for smart-HTTP probe tests")
	}
	rig := &probeRig{t: t, adminToken: "admin-fine-grained-token-TESTONLY"}
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "octo"), 0o755); err != nil {
		t.Fatal(err)
	}
	seedBareRepo(t, filepath.Join(root, "octo"), "demo")
	rig.gitBack = newGitBackend(root, rig.adminToken)
	rig.gitUp = httptest.NewServer(rig.gitBack)
	t.Cleanup(rig.gitUp.Close)
	rig.apiHandler = func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+rig.adminToken {
			http.Error(w, "upstream auth required", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"ok":true,"path":%q,"method":%q}`, r.URL.Path, r.Method)
	}
	rig.apiUp = httptest.NewServer(rig.apiHandler)
	t.Cleanup(rig.apiUp.Close)
	rig.Store = newStore(t)
	rig.broker = newBroker(t, rig)
	rig.front = httptest.NewServer(rig.broker)
	t.Cleanup(rig.front.Close)
	return rig
}

func newBroker(t *testing.T, rig *probeRig) *Broker {
	t.Helper()
	gitURL := mustParse(t, rig.gitUp.URL)
	apiURL := mustParse(t, rig.apiUp.URL)
	broker, err := New(Config{
		Token:       rig.adminToken,
		GitUpstream: gitURL,
		APIUpstream: apiURL,
		Store:       rig.Store,
	})
	if err != nil {
		t.Fatal(err)
	}
	return broker
}

func mustParse(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func mintCap(t *testing.T, store *Store, chat string, repos []string, write bool) Capability {
	t.Helper()
	cap, err := store.Mint(chat, repos, write, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return cap
}

// cloneURL builds the container-side remote URL carrying the capability as
// basic-auth username, exactly as an agent container would receive it.
func (rig *probeRig) cloneURL(cap Capability, repo string) string {
	u := mustParse(rig.t, rig.front.URL)
	u.User = url.User(cap.ID)
	return u.String() + "/" + repo + ".git"
}

func doReq(t *testing.T, method, url, auth string, body io.Reader) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatal(err)
	}
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// doReqNoFollow uses a client that never follows redirects, so redirect
// tests measure the broker's behavior rather than the test client's.
func doReqNoFollow(t *testing.T, method, url, auth string, body io.Reader) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatal(err)
	}
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	client := &http.Client{
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}
