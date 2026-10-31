package changes

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func expirePulls(t *testing.T, s *Service, c storage.Chat) Pulls {
	t.Helper()
	p, err := s.Store.Paths(context.Background(), c.ID)
	if err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(p.Artifacts)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	var state Pulls
	if err = load(root, "pulls.json", &state); err != nil {
		t.Fatal(err)
	}
	state.CheckedAt = ""
	if err = save(root, "pulls.json", state); err != nil {
		t.Fatal(err)
	}
	return state
}

func credentials(t *testing.T, s *Service, token string) {
	t.Helper()
	t.Cleanup(func() {
		githubBackoff.Lock()
		delete(githubBackoff.until, sha256.Sum256([]byte(token)))
		githubBackoff.Unlock()
	})
	if err := s.Store.SaveCredentials(context.Background(), storage.Credentials{GitHubToken: token, Provider: "anthropic", Model: "test", ProviderKey: "fixture-key"}); err != nil {
		t.Fatal(err)
	}
}

func reply(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}

func TestDiscoverBranchesAcrossRepositoriesAndRetainAfterStop(t *testing.T) {
	s, c, e := fixture(t)
	ctx := context.Background()
	credentials(t, s, "first-token")
	// Keep the default branch unchanged. A pre-existing PR for it is unrelated.
	git(t, e.dir, "branch", "-M", "main")
	git(t, e.dir, "remote", "add", "origin", "https://github.com/example/core.git")
	git(t, e.dir, "checkout", "-b", "work/one;$literal")
	write(t, e.dir, "committed", "work\n")
	git(t, e.dir, "commit", "-am", "work")
	sha := git(t, e.dir, "rev-parse", "HEAD")
	git(t, e.dir, "branch", "work/two")
	// An extra checkout is not materialized, while another core path is missing.
	c.Configuration.Repositories = append(c.Configuration.Repositories,
		storage.Repository{Name: "absent", URL: "https://github.com/example/absent", Role: "core", BaseBranch: "main"},
		storage.Repository{Name: "extra", URL: "https://github.com/example/extra", Role: "extra", BaseBranch: "main"})
	c.StartingCommits["absent"] = c.StartingCommits["core"]
	// Multi-repository paths place the first checkout in its own directory.
	if err := os.MkdirAll(filepath.Join(e.dir, "repos", "core"), 0700); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(e.dir)
	for _, entry := range entries {
		if entry.Name() != "repos" {
			if err := os.Rename(filepath.Join(e.dir, entry.Name()), filepath.Join(e.dir, "repos", "core", entry.Name())); err != nil {
				t.Fatal(err)
			}
		}
	}
	state := "open"
	requests := 0
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		requests++
		if r.URL.Host != "api.github.com" || r.Header.Get("Authorization") != "Bearer first-token" {
			t.Fatal("unsafe request")
		}
		if r.URL.Path == "/repos/example/core/pulls" {
			ref := strings.TrimPrefix(r.URL.Query().Get("head"), "example:")
			if ref != "work/one;$literal" && ref != "work/two" {
				t.Fatalf("unrelated branch %q", ref)
			}
			n := 1
			if ref == "work/two" {
				n = 2
			}
			return reply(200, fmt.Sprintf(`[{"number":%d,"html_url":"https://github.com/example/core/pull/%d","head":{"ref":%q,"sha":%q,"repo":{"full_name":"example/core"}}},{"number":99,"html_url":"https://github.com/example/core/pull/99","head":{"ref":%q,"sha":"wrong","repo":{"full_name":"someone/fork"}}}]`, n, n, ref, sha, ref)), nil
		}
		n := 1
		if strings.HasSuffix(r.URL.Path, "/2") {
			n = 2
		}
		return reply(200, fmt.Sprintf(`{"number":%d,"state":%q,"merged":%t,"html_url":"https://github.com/example/core/pull/%d"}`, n, state, state == "closed" && n == 1, n)), nil
	})}
	s.verifyPulls(ctx, c, client)
	r, err := s.Read(ctx, c.ID, true)
	if err != nil || len(r.Pulls.Items) != 2 || len(r.Pulls.Branches) != 2 || r.Pulls.Error == "" || requests != 4 {
		t.Fatalf("discovery: %+v requests=%d %v", r.Pulls, requests, err)
	}
	state = "closed"
	expirePulls(t, s, c)
	c.Status = storage.Stopped
	e.fail = true
	s.verifyPulls(ctx, c, client)
	r, err = New(s.Store, nil).Read(ctx, c.ID, true)
	if err != nil || len(r.Pulls.Items) != 2 || r.Pulls.Items[0].State != "merged" || r.Pulls.Items[1].State != "closed" || r.Pulls.Error != "" {
		t.Fatalf("stopped refresh: %+v %v", r.Pulls, err)
	}
}

func TestLinksCanonicalIdentityRotationAndOutage(t *testing.T) {
	s, c, _ := fixture(t)
	ctx := context.Background()
	credentials(t, s, "old-token")
	text := "https://github.com/Other/Private/pull/7 https://github.com/other/private/pull/7/files https://github.com/other/private/pull/7#issuecomment-1 https://github.com/example/core/pull/8junk https://github.com.evil.test/example/core/pull/4 https://evil.test/pull/3 https://github.com/example/core/pull/9999999999999999999999999"
	if err := s.Store.SaveRuntimeMessage(ctx, "links", storage.Message{ChatID: c.ID, RuntimeMessageID: "links", Role: "assistant", Text: text, Payload: json.RawMessage(`{"parts":[{"type":"tool","state":{"output":"https://github.com/second/repo/pull/7"}}]}`)}); err != nil {
		t.Fatal(err)
	}
	token := "old-token"
	status := 200
	count := 0
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		count++
		if r.Header.Get("Authorization") != "Bearer "+token || r.URL.Host != "api.github.com" {
			t.Fatal("unsafe token or host")
		}
		if status != 200 {
			if status == 0 {
				return nil, fmt.Errorf("secret upstream transport failure")
			}
			return reply(status, `{"message":"secret upstream body"}`), nil
		}
		repo := "other/private"
		if r.URL.Path == "/repos/second/repo/pulls/7" {
			repo = "second/repo"
		} else if r.URL.Path != "/repos/other/private/pulls/7" {
			t.Fatalf("untrusted link requested %s", r.URL)
		}
		return reply(200, fmt.Sprintf(`{"number":7,"state":"open","draft":true,"html_url":"https://github.com/%s/pull/7"}`, repo)), nil
	})}
	s.verifyPulls(ctx, c, client)
	r, _ := s.Read(ctx, c.ID, true)
	if len(r.Pulls.Items) != 2 || count != 2 || r.Pulls.Error != "" {
		t.Fatalf("canonical discovery: %+v count=%d", r.Pulls, count)
	}
	for _, failure := range []int{404, 500, 302, 0, 429} {
		expirePulls(t, s, c)
		token = "rotated-token"
		credentials(t, s, token)
		status = failure
		s.verifyPulls(ctx, c, client)
		r, _ = New(s.Store, nil).Read(ctx, c.ID, true)
		if len(r.Pulls.Items) != 2 || r.Pulls.Error == "" || strings.Contains(r.Pulls.Error, "secret") {
			t.Fatalf("retention %d: %+v", failure, r.Pulls)
		}
	}
}

func TestForkBranchUsesHeadIdentityAndCommit(t *testing.T) {
	s, c, e := fixture(t)
	ctx := context.Background()
	credentials(t, s, "token")
	git(t, e.dir, "remote", "add", "origin", "https://github.com/example/core.git")
	git(t, e.dir, "remote", "add", "fork", "git@github.com:contributor/fork.git")
	git(t, e.dir, "branch", "-M", "main")
	git(t, e.dir, "config", "branch.main.pushRemote", "fork")
	// Work can happen on the default branch, but its starting tip is not evidence.
	state := Pulls{}
	s.observeBranches(ctx, c, &state)
	if len(state.Branches) != 0 {
		t.Fatal("starting branch was treated as chat work")
	}
	write(t, e.dir, "committed", "fork work\n")
	git(t, e.dir, "commit", "-am", "fork work")
	sha := git(t, e.dir, "rev-parse", "HEAD")
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/repos/example/core/pulls" {
			if r.URL.Query().Get("head") != "contributor:main" {
				t.Fatalf("fork query %s", r.URL)
			}
			return reply(200, fmt.Sprintf(`[{"number":3,"html_url":"https://github.com/example/core/pull/3","head":{"ref":"main","sha":%q,"repo":{"full_name":"contributor/fork"}}}]`, sha)), nil
		}
		return reply(200, `{"number":3,"state":"open","html_url":"https://github.com/example/core/pull/3"}`), nil
	})}
	s.verifyPulls(ctx, c, client)
	r, _ := s.Read(ctx, c.ID, true)
	if len(r.Pulls.Items) != 1 || r.Pulls.Items[0].Number != 3 {
		t.Fatalf("fork discovery: %+v", r.Pulls)
	}
}

func TestVerificationRejectsWrongIdentityAndRedirects(t *testing.T) {
	for _, body := range []string{`{"number":9,"state":"open","html_url":"https://github.com/example/core/pull/1"}`, `{"number":1,"state":"open","html_url":"https://evil.test/pull/1"}`, `{"number":1,"state":"unknown","html_url":"https://github.com/example/core/pull/1"}`, `not json`} {
		t.Run(body, func(t *testing.T) {
			s, c, _ := fixture(t)
			credentials(t, s, "token")
			s.Store.SaveRuntimeMessage(context.Background(), "link", storage.Message{ChatID: c.ID, RuntimeMessageID: "link", Role: "assistant", Text: "https://github.com/example/core/pull/1", Payload: json.RawMessage(`{}`)})
			client := &http.Client{Transport: transport(func(*http.Request) (*http.Response, error) { return reply(200, body), nil })}
			s.verifyPulls(context.Background(), c, client)
			r, _ := s.Read(context.Background(), c.ID, true)
			if len(r.Pulls.Items) != 0 || r.Pulls.Error == "" {
				t.Fatalf("accepted bad identity: %+v", r.Pulls)
			}
		})
	}
}

func TestDiscoveryBudgetRotatesAndDoesNotFollowRedirect(t *testing.T) {
	s, c, _ := fixture(t)
	ctx := context.Background()
	credentials(t, s, "token")
	var text strings.Builder
	for n := 1; n <= 40; n++ {
		fmt.Fprintf(&text, "https://github.com/example/core/pull/%d\n", n)
	}
	if err := s.Store.SaveRuntimeMessage(ctx, "many", storage.Message{ChatID: c.ID, RuntimeMessageID: "many", Role: "assistant", Text: text.String(), Payload: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	count := 0
	redirect := false
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		count++
		if r.URL.Host != "api.github.com" {
			t.Fatal("followed untrusted redirect")
		}
		if redirect {
			res := reply(302, `{}`)
			res.Header.Set("Location", "https://evil.test/stolen")
			return res, nil
		}
		n := strings.TrimPrefix(r.URL.Path, "/repos/example/core/pulls/")
		return reply(200, fmt.Sprintf(`{"number":%s,"state":"open","html_url":"https://github.com/example/core/pull/%s"}`, n, n)), nil
	})}
	s.verifyPulls(ctx, c, client)
	r, _ := s.Read(ctx, c.ID, true)
	if count != 32 || len(r.Pulls.Items) != 32 || r.Pulls.Error == "" {
		t.Fatalf("scan not bounded: count=%d %+v", count, r.Pulls)
	}
	expirePulls(t, s, c)
	s.verifyPulls(ctx, c, client)
	r, _ = s.Read(ctx, c.ID, true)
	if count != 64 || len(r.Pulls.Items) != 40 {
		t.Fatalf("scan starved candidates: count=%d %+v", count, r.Pulls)
	}
	expirePulls(t, s, c)
	redirect = true
	s.verifyPulls(ctx, c, client)
	r, _ = s.Read(ctx, c.ID, true)
	if count != 96 || len(r.Pulls.Items) != 40 || r.Pulls.Error == "" {
		t.Fatalf("redirect retention: count=%d %+v", count, r.Pulls)
	}
}

func TestBranchOnlyDiscoveryInTwoMaterializedRepositories(t *testing.T) {
	s, c, e := fixture(t)
	ctx := context.Background()
	credentials(t, s, "fixture-token")
	c.Configuration.Repositories = []storage.Repository{
		{Name: "first/app", URL: "https://github.com/first/app.git", Role: "core", BaseBranch: "main"},
		{Name: "second/app", URL: "https://github.com/second/app.git", Role: "extra", BaseBranch: "main"},
	}
	c.StartingCommits = map[string]string{}
	shas := map[string]string{}
	for _, r := range c.Configuration.Repositories {
		dir := filepath.Join(e.dir, "repos", r.Name)
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		git(t, dir, "init", "-b", "main")
		write(t, dir, "file", "base\n")
		git(t, dir, "add", ".")
		git(t, dir, "commit", "-m", "base")
		c.StartingCommits[r.Name] = git(t, dir, "rev-parse", "HEAD")
		git(t, dir, "checkout", "-b", "work")
		write(t, dir, "file", "work "+r.Name+"\n")
		git(t, dir, "commit", "-am", "work")
		git(t, dir, "remote", "add", "origin", r.URL)
		shas[r.Name] = git(t, dir, "rev-parse", "HEAD")
	}
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		repo := "first/app"
		if strings.Contains(r.URL.Path, "second/app") {
			repo = "second/app"
		}
		if strings.HasSuffix(r.URL.Path, "/pulls") {
			return reply(200, fmt.Sprintf(`[{"number":5,"html_url":"https://github.com/%s/pull/5","head":{"ref":"work","sha":%q,"repo":{"full_name":%q}}}]`, repo, shas[repo], repo)), nil
		}
		return reply(200, fmt.Sprintf(`{"number":5,"state":"open","html_url":"https://github.com/%s/pull/5"}`, repo)), nil
	})}
	s.verifyPulls(ctx, c, client)
	r, _ := s.Read(ctx, c.ID, true)
	if len(r.Pulls.Items) != 2 || r.Pulls.Items[0].Repository != "first/app" || r.Pulls.Items[1].Repository != "second/app" || r.Pulls.Error != "" {
		t.Fatalf("multi-repository discovery: %+v", r.Pulls)
	}
}

func TestBranchPaginationSurvivesRestart(t *testing.T) {
	s, c, _ := fixture(t)
	ctx := context.Background()
	credentials(t, s, "fixture-token")
	c.Status = storage.Stopped
	paths, _ := s.Store.Paths(ctx, c.ID)
	root, err := os.OpenRoot(paths.Artifacts)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	sha := strings.Repeat("a", 40)
	initial := Pulls{Items: []Pull{}, Branches: []pullBranch{{Repository: "example/core", HeadRepository: "example/core", Ref: "work", SHA: sha}}}
	if err = save(root, "pulls.json", initial); err != nil {
		t.Fatal(err)
	}
	pages := []string{}
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		if strings.HasSuffix(r.URL.Path, "/pulls") {
			page := r.URL.Query().Get("page")
			pages = append(pages, page)
			if page == "1" {
				return reply(200, "["+strings.TrimSuffix(strings.Repeat(`{},`, 100), ",")+"]"), nil
			}
			return reply(200, fmt.Sprintf(`[{"number":6,"html_url":"https://github.com/example/core/pull/6","head":{"ref":"work","sha":%q,"repo":{"full_name":"example/core"}}}]`, sha)), nil
		}
		return reply(200, `{"number":6,"state":"closed","merged":true,"html_url":"https://github.com/example/core/pull/6"}`), nil
	})}
	s.verifyPulls(ctx, c, client)
	first := expirePulls(t, s, c)
	if first.Branches[0].Page != 2 || len(first.Items) != 0 {
		t.Fatalf("pagination not saved: %+v", first)
	}
	New(s.Store, nil).verifyPulls(ctx, c, client)
	r, _ := s.Read(ctx, c.ID, true)
	if strings.Join(pages, ",") != "1,2" || len(r.Pulls.Items) != 1 || r.Pulls.Items[0].State != "merged" {
		t.Fatalf("pagination restart: pages=%v %+v", pages, r.Pulls)
	}
}
