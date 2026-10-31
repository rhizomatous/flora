package changes

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func linkMessage(t *testing.T, s *Service, c storage.Chat, text string) {
	t.Helper()
	if err := s.Store.SaveRuntimeMessage(context.Background(), "link-"+c.ID, storage.Message{ChatID: c.ID, RuntimeMessageID: "link", Role: "assistant", Text: text, Payload: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
}

func promptly(t *testing.T, f func()) {
	t.Helper()
	done := make(chan struct{})
	go func() { defer close(done); f() }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("operation blocked behind GitHub scan")
	}
}

func TestBlockedGitHubDoesNotBlockChangesOrDuplicateScans(t *testing.T) {
	s, c, _ := fixture(t)
	ctx := context.Background()
	credentials(t, s, t.Name())
	linkMessage(t, s, c, "https://github.com/example/core/pull/1")
	other, err := s.Store.CreateChat(ctx, c.ProjectID, "other", c.ImageDigest, c.HarnessVersion)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Store.RecordStartingCommit(ctx, other.ID, "core", c.StartingCommits["core"]); err != nil {
		t.Fatal(err)
	}
	linkMessage(t, s, other, "https://github.com/example/core/pull/1")
	started, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	var requests atomic.Int32
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		requests.Add(1)
		close(started)
		select {
		case <-release:
		case <-r.Context().Done():
			return nil, r.Context().Err()
		}
		return reply(200, `{"number":1,"state":"open","html_url":"https://github.com/example/core/pull/1"}`), nil
	})}
	go func() { defer close(finished); s.verifyPulls(ctx, c, client) }()
	defer func() { releaseOnce.Do(func() { close(release) }); <-finished }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("scan never reached GitHub")
	}
	promptly(t, func() {
		if _, err := s.Read(ctx, c.ID, true); err != nil {
			t.Error(err)
		}
	})
	promptly(t, func() {
		if err := s.Refresh(ctx, other.ID); err != nil {
			t.Error(err)
		}
	})
	promptly(t, func() {
		if err := s.Refresh(ctx, c.ID); err != nil {
			t.Error(err)
		}
	})
	promptly(t, func() {
		if _, err := s.Read(ctx, other.ID, true); err != nil {
			t.Error(err)
		}
	})
	promptly(t, func() { New(s.Store, s.Engine).verifyPulls(ctx, c, client) })
	if requests.Load() != 1 {
		t.Fatal("duplicate scan reached GitHub")
	}
	fast := &http.Client{Transport: transport(func(*http.Request) (*http.Response, error) {
		return reply(200, `{"number":1,"state":"open","html_url":"https://github.com/example/core/pull/1"}`), nil
	})}
	promptly(t, func() { New(s.Store, s.Engine).verifyPulls(ctx, other, fast) })
	r, _ := s.Read(ctx, other.ID, true)
	if len(r.Pulls.Items) != 1 {
		t.Fatalf("other chat scan blocked: %+v", r.Pulls)
	}
	releaseOnce.Do(func() { close(release) })
	<-finished
	r, _ = s.Read(ctx, c.ID, true)
	if r.Snapshot == nil || len(r.Pulls.Items) != 1 {
		t.Fatalf("concurrent capture or PR update lost: %+v", r)
	}
}

func TestBranchTipReplacementRetainsCandidatesAndVerifiedPRs(t *testing.T) {
	s, c, _ := fixture(t)
	ctx := context.Background()
	credentials(t, s, t.Name())
	tip := fmt.Sprintf("%040x", 1)
	s.Engine = captureExecutor(func(_ context.Context, in io.Reader, out io.Writer) (int, error) {
		script, _ := io.ReadAll(in)
		if strings.Contains(string(script), "for-each-ref") {
			fmt.Fprintf(out, "work\x00%s\x00\x00\x00\n", tip)
		} else {
			fmt.Fprintln(out, "https://github.com/example/core.git")
		}
		return 0, nil
	})
	listed := []string{}
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		if strings.HasSuffix(r.URL.Path, "/pulls") {
			listed = append(listed, tip)
			n := 1
			if tip != fmt.Sprintf("%040x", 1) {
				n = 2
			}
			return reply(200, fmt.Sprintf(`[{"number":%d,"html_url":"https://github.com/example/core/pull/%d","head":{"ref":"work","sha":%q,"repo":{"full_name":"example/core"}}}]`, n, n, tip)), nil
		}
		n := strings.TrimPrefix(r.URL.Path, "/repos/example/core/pulls/")
		return reply(200, fmt.Sprintf(`{"number":%s,"state":"open","html_url":"https://github.com/example/core/pull/%s"}`, n, n)), nil
	})}
	s.verifyPulls(ctx, c, client)
	state := expirePulls(t, s, c)
	state.Candidates = append(state.Candidates, "https://github.com/example/core/pull/89")
	for n := 2; n <= 100; n++ {
		tip = fmt.Sprintf("%040x", n)
		if s.observeBranches(ctx, c, &state) {
			t.Fatal("observation failed")
		}
		if len(state.Branches) != 1 || state.Branches[0].SHA != tip {
			t.Fatalf("historical tips retained: %+v", state.Branches)
		}
	}
	// Loading an older artifact also collapses multiple tips for one branch.
	state.Branches = append([]pullBranch{{Repository: "example/core", HeadRepository: "example/core", Ref: "work", SHA: fmt.Sprintf("%040x", 1)}}, state.Branches...)
	p, _ := s.Store.Paths(ctx, c.ID)
	root, err := os.OpenRoot(p.Artifacts)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err = save(root, "pulls.json", state); err != nil {
		t.Fatal(err)
	}
	s.verifyPulls(ctx, c, client)
	r, _ := s.Read(ctx, c.ID, true)
	if len(listed) != 2 || listed[1] != tip || len(r.Pulls.Items) != 3 || len(r.Pulls.Branches) != 1 {
		t.Fatalf("latest tip/candidates lost: listed=%v %+v", listed, r.Pulls)
	}
}

func TestUnverified404IsSuppressedWithoutOutage(t *testing.T) {
	s, c, _ := fixture(t)
	ctx := context.Background()
	credentials(t, s, t.Name())
	linkMessage(t, s, c, "https://github.com/example/core/pull/404")
	requests := 0
	client := &http.Client{Transport: transport(func(*http.Request) (*http.Response, error) {
		requests++
		return reply(404, `{"message":"secret"}`), nil
	})}
	s.verifyPulls(ctx, c, client)
	state := expirePulls(t, s, c)
	if state.Error != "" || len(state.Items) != 0 || len(state.Missing) != 1 {
		t.Fatalf("hallucinated link became outage: %+v", state)
	}
	New(s.Store, nil).verifyPulls(ctx, c, client)
	r, _ := s.Read(ctx, c.ID, true)
	if requests != 1 || r.Pulls.Error != "" {
		t.Fatalf("saved message retried missing link: requests=%d %+v", requests, r.Pulls)
	}
}

func TestMatchingBranchDiscoversPreannouncedMissingLink(t *testing.T) {
	s, c, e := fixture(t)
	ctx := context.Background()
	credentials(t, s, t.Name())
	linkMessage(t, s, c, "https://github.com/example/core/pull/7 https://github.com/example/core/pull/99")
	created, inaccessible := false, false
	sha := ""
	details := map[string]int{}
	lists := 0
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/repos/example/core/pulls" {
			lists++
			if !created || r.URL.Query().Get("head") != "example:work" {
				t.Fatalf("unexpected branch query %s", r.URL)
			}
			candidate := fmt.Sprintf(`{"number":7,"html_url":"https://github.com/example/core/pull/7","head":{"ref":"work","sha":%q,"repo":{"full_name":"example/core"}}}`, sha)
			// Repeated matching results must not trigger duplicate detail calls.
			return reply(200, "["+candidate+","+candidate+"]"), nil
		}
		details[r.URL.Path]++
		if !created || inaccessible || strings.HasSuffix(r.URL.Path, "/99") {
			return reply(404, `{}`), nil
		}
		if r.URL.Path != "/repos/example/core/pulls/7" {
			t.Fatalf("unexpected detail %s", r.URL)
		}
		return reply(200, `{"number":7,"state":"open","draft":true,"html_url":"https://github.com/example/core/pull/7"}`), nil
	})}
	s.verifyPulls(ctx, c, client)
	missing := expirePulls(t, s, c)
	until, err := time.Parse(time.RFC3339Nano, missing.Missing["https://github.com/example/core/pull/7"])
	if err != nil || time.Until(until) < 23*time.Hour || missing.Error != "" {
		t.Fatalf("preannounced link not suppressed: %+v", missing)
	}
	s.verifyPulls(ctx, c, client)
	if details["/repos/example/core/pulls/7"] != 1 || details["/repos/example/core/pulls/99"] != 1 {
		t.Fatal("saved missing links were retried")
	}
	git(t, e.dir, "remote", "add", "origin", "https://github.com/example/core.git")
	git(t, e.dir, "checkout", "-b", "work")
	write(t, e.dir, "committed", "new work\n")
	git(t, e.dir, "commit", "-am", "work")
	sha = git(t, e.dir, "rev-parse", "HEAD")
	created = true
	expirePulls(t, s, c)
	s.verifyPulls(ctx, c, client)
	r, err := s.Read(ctx, c.ID, true)
	if err != nil || len(r.Pulls.Items) != 1 || r.Pulls.Items[0].Number != 7 || !r.Pulls.Items[0].Draft || r.Pulls.Error != "" || r.Pulls.Missing["https://github.com/example/core/pull/7"] != "" {
		t.Fatalf("matching PR stayed suppressed: %+v %v", r.Pulls, err)
	}
	if details["/repos/example/core/pulls/7"] != 2 || details["/repos/example/core/pulls/99"] != 1 || lists != 1 {
		t.Fatalf("duplicate or invalid detail requests: %v lists=%d", details, lists)
	}
	// A saved PR becoming inaccessible remains an outage, even if its branch
	// still matches. Branch results must not erase the retained status or warning.
	inaccessible = true
	expirePulls(t, s, c)
	s.verifyPulls(ctx, c, client)
	r, err = s.Read(ctx, c.ID, true)
	if err != nil || len(r.Pulls.Items) != 1 || r.Pulls.Error == "" || details["/repos/example/core/pulls/7"] != 3 || details["/repos/example/core/pulls/99"] != 1 {
		t.Fatalf("known 404 retention changed: %+v details=%v %v", r.Pulls, details, err)
	}
}

func TestGitHubBackoffSharedByTokenWithRotation(t *testing.T) {
	s, c, _ := fixture(t)
	ctx := context.Background()
	token := t.Name()
	credentials(t, s, token)
	linkMessage(t, s, c, "https://github.com/example/core/pull/1")
	requests := 0
	client := &http.Client{Transport: transport(func(*http.Request) (*http.Response, error) {
		requests++
		res := reply(429, `{"message":"secret"}`)
		res.Header.Set("Retry-After", "120")
		return res, nil
	})}
	s.verifyPulls(ctx, c, client)
	if !githubDelayed(token, time.Now().Add(time.Minute)) {
		t.Fatal("Retry-After not honored")
	}
	expirePulls(t, s, c)
	New(s.Store, nil).verifyPulls(ctx, c, client)
	if requests != 1 {
		t.Fatal("backoff ignored across services")
	}
	other, err := s.Store.CreateChat(ctx, c.ProjectID, "other", c.ImageDigest, c.HarnessVersion)
	if err != nil {
		t.Fatal(err)
	}
	linkMessage(t, s, other, "https://github.com/example/core/pull/1")
	s.verifyPulls(ctx, other, client)
	if requests != 1 {
		t.Fatal("backoff ignored across chats")
	}
	credentials(t, s, token+"-rotated")
	expirePulls(t, s, c)
	client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		requests++
		if r.Header.Get("Authorization") != "Bearer "+token+"-rotated" {
			t.Fatal("old token reused")
		}
		return reply(200, `{"number":1,"state":"open","html_url":"https://github.com/example/core/pull/1"}`), nil
	})
	s.verifyPulls(ctx, c, client)
	r, _ := s.Read(ctx, c.ID, true)
	if requests != 2 || len(r.Pulls.Items) != 1 || r.Pulls.Error != "" {
		t.Fatalf("token rotation stayed blocked: %+v", r.Pulls)
	}
	githubBackoff.Lock()
	delete(githubBackoff.until, sha256.Sum256([]byte(token)))
	githubBackoff.Unlock()
}

func TestGitHubBackoffHeaderBounds(t *testing.T) {
	now := time.Now()
	for name, header := range map[string]http.Header{
		"fallback": {}, "malformed": {"Retry-After": {"nonsense"}}, "seconds": {"Retry-After": {"120"}}, "date": {"Retry-After": {now.Add(2 * time.Minute).UTC().Format(http.TimeFormat)}}, "huge": {"Retry-After": {"999999999999999999"}}, "reset": {"X-Ratelimit-Reset": {fmt.Sprint(now.Add(2 * time.Minute).Unix())}},
	} {
		t.Run(name, func(t *testing.T) {
			token := t.Name()
			delayGitHub(token, header, now)
			githubBackoff.Lock()
			until := githubBackoff.until[sha256.Sum256([]byte(token))]
			delete(githubBackoff.until, sha256.Sum256([]byte(token)))
			githubBackoff.Unlock()
			if until.Before(now.Add(30*time.Second)) || until.After(now.Add(time.Hour)) {
				t.Fatalf("unbounded delay %s", until.Sub(now))
			}
			if (name == "seconds" || name == "date" || name == "reset") && until.Before(now.Add(119*time.Second)) {
				t.Fatal("retry header ignored")
			}
		})
	}
}

func TestGitHubRemoteNormalization(t *testing.T) {
	for _, raw := range []string{"https://GitHub.COM:443/Owner/Repo.git", "ssh://git@GitHub.COM:22/Owner/Repo.git", "git@GITHUB.COM:Owner/Repo.git", "https://user:do-not-save@github.com/Owner/Repo.git", "https://github.com/Owner/Repo/"} {
		if got := githubRepository(raw); got != "owner/repo" {
			t.Errorf("normalization failed: %q", got)
		}
	}
	for _, raw := range []string{"https://github.com:8443/owner/repo", "ssh://github.com:443/owner/repo", "https://github.com.evil.test/owner/repo", "https://github.com@evil.test/owner/repo", "http://github.com/owner/repo", "https://github.com//owner/repo", "https://github.com/owner/repo/path", "https://github.com/owner/repo?secret=test"} {
		if githubRepository(raw) != "" {
			t.Errorf("accepted non-GitHub remote")
		}
	}
	if got := githubRepository("https://github.com/owner/repo.git.git"); got != "owner/repo.git" {
		t.Fatalf("stripped more than one transport suffix: %q", got)
	}
}
