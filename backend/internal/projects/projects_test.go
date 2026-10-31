package projects

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func fixture(t *testing.T) *Service {
	t.Helper()
	s, err := storage.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	if err := s.SaveCredentials(context.Background(), storage.Credentials{Provider: "openai", Model: "model", GitHubToken: "github_pat_SECRET", ProviderKey: "provider_SECRET"}); err != nil {
		t.Fatal(err)
	}
	return New(s)
}
func input(repo, branch string) Input {
	return Input{Name: " Private project ", Configuration: storage.Configuration{Repositories: []storage.Repository{{URL: repo, BaseBranch: branch}}, SetupCommand: "npm ci\nprintf 'ready'"}}
}
func response(code int, body string) *http.Response {
	return &http.Response{StatusCode: code, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}
}

func TestPrivateRepositoryAndDefaults(t *testing.T) {
	s := fixture(t)
	calls := 0
	s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != "GET" || r.URL.Host != "api.github.com" || r.URL.Scheme != "https" || r.Header.Get("Authorization") != "Bearer github_pat_SECRET" || r.URL.RawQuery != "" {
			t.Fatalf("unsafe GitHub request: %s", r.URL)
		}
		if calls == 1 {
			if r.URL.Path != "/repos/owner/private" {
				t.Fatal(r.URL)
			}
			return response(200, `{"private":true,"default_branch":"release/stable"}`), nil
		}
		if r.URL.EscapedPath() != "/repos/owner/private/branches/release%2Fstable" {
			t.Fatal(r.URL)
		}
		return response(200, `{"name":"release/stable"}`), nil
	})
	for _, repo := range []string{"owner/private", "https://github.com/owner/private.git", "https://github.com/owner/private/"} {
		calls = 0
		got, err := s.Validate(context.Background(), input(repo, ""))
		if err != nil {
			t.Fatal(err)
		}
		r := got.Configuration.Repositories[0]
		if calls != 2 || got.Name != "Private project" || r.Name != "owner/private" || r.URL != "https://github.com/owner/private.git" || r.BaseBranch != "release/stable" || r.Role != "core" || got.Configuration.SetupCommand != "npm ci\nprintf 'ready'" {
			t.Fatalf("bad defaults: %+v", got)
		}
	}
}

func TestRepositoryAndBranchInjectionRejectedBeforeNetwork(t *testing.T) {
	s := fixture(t)
	s.Client.Transport = transport(func(*http.Request) (*http.Response, error) { t.Fatal("invalid input reached network"); return nil, nil })
	for _, repo := range []string{"http://github.com/a/b", "https://evil.test/a/b", "https://github.com.evil.test/a/b", "https://user:SECRET@github.com/a/b", "https://github.com:443/a/b", "https://github.com/a/b?q=SECRET", "https://github.com/a/b#SECRET", "https://github.com/a%2Fb/c", "https://github.com/a/../b", "a/..", "a/b/c", "a/b?x=y", "a/b\n", "git@github.com:a/b"} {
		if _, err := s.Validate(context.Background(), input(repo, "main")); err == nil || strings.Contains(err.Error(), "SECRET") {
			t.Errorf("accepted or leaked %q: %v", repo, err)
		}
	}
	for _, branch := range []string{"-main", "../main", "main..next", "a@{b", "a.lock", ".main", "a/", "a//b", "a b", "a?b", "a\\b", "a\nb", "a\x7fb", "@"} {
		if _, err := s.Validate(context.Background(), input("owner/private", branch)); err == nil {
			t.Errorf("accepted branch %q", branch)
		}
	}
	for _, in := range []Input{{}, {Name: "name"}, input("a/b", "main")} {
		if len(in.Configuration.Repositories) != 0 {
			in.Configuration.Repositories[0].Role = "invalid"
		}
		if _, err := s.Validate(context.Background(), in); err == nil {
			t.Fatal("accepted invalid configuration")
		}
	}
}

func TestUsefulRemoteFailuresWithoutSecrets(t *testing.T) {
	for _, tc := range []struct {
		name    string
		code    int
		branch  bool
		message string
	}{
		{"invalid token", 401, false, "rejected the saved token"},
		{"permissions", 403, false, "permissions"},
		{"missing repository", 404, false, "Repository was not found"},
		{"missing branch", 404, true, "Base branch was not found"},
		{"upstream", 500, false, "unavailable"},
		{"redirect", 302, false, "unavailable"},
		{"transport", 0, false, "Cannot reach"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := fixture(t)
			s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
				if tc.branch && !strings.Contains(r.URL.Path, "/branches/") {
					return response(200, `{}`), nil
				}
				if tc.code == 0 {
					return nil, errors.New("github_pat_SECRET")
				}
				return response(tc.code, "github_pat_SECRET provider_SECRET"), nil
			})
			_, err := s.Validate(context.Background(), input("owner/private", "main"))
			if err == nil || !strings.Contains(err.Error(), tc.message) || strings.Contains(err.Error(), "SECRET") {
				t.Fatal(err)
			}
		})
	}
}

func TestRedirectCannotForwardToken(t *testing.T) {
	s := fixture(t)
	var leaked bool
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked = true }))
	defer destination.Close()
	calls := 0
	s.Client.Transport = transport(func(*http.Request) (*http.Response, error) {
		calls++
		r := response(302, "")
		r.Header.Set("Location", destination.URL)
		return r, nil
	})
	if _, err := s.Validate(context.Background(), input("a/b", "main")); err == nil || calls != 1 || leaked {
		t.Fatal("redirect was followed")
	}
}

func TestMissingCredentialsAndEmptyRepository(t *testing.T) {
	s := fixture(t)
	s.Client.Transport = transport(func(*http.Request) (*http.Response, error) { return response(200, `{"default_branch":null}`), nil })
	if _, err := s.Validate(context.Background(), input("a/b", "")); err == nil || !strings.Contains(err.Error(), "no usable default branch") {
		t.Fatal(err)
	}
	store, err := storage.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	s.Store = store
	if _, err := s.Validate(context.Background(), input("a/b", "main")); err == nil || !strings.Contains(err.Error(), "installation settings") {
		t.Fatal(err)
	}
}

func TestPublicRepositoryWithExplicitBranchAndOptionalSetup(t *testing.T) {
	s := fixture(t)
	calls := 0
	s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		calls++
		if calls == 1 {
			return response(200, `{"private":false,"default_branch":"main"}`), nil
		}
		if r.URL.Path != "/repos/owner/public/branches/develop" {
			t.Fatal(r.URL)
		}
		return response(200, `{}`), nil
	})
	in := input("owner/public", "develop")
	in.Configuration.SetupCommand = ""
	in.Configuration.Repositories[0].Role = "extra"
	got, err := s.Validate(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 || got.Configuration.Repositories[0].BaseBranch != "develop" || got.Configuration.Repositories[0].Role != "extra" || got.Configuration.SetupCommand != "" {
		t.Fatal(got)
	}
}

func TestConfigurationLimits(t *testing.T) {
	s := fixture(t)
	s.Client.Transport = transport(func(*http.Request) (*http.Response, error) { t.Fatal("invalid input reached network"); return nil, nil })
	for _, mutate := range []func(*Input){
		func(in *Input) { in.Name = strings.Repeat("n", 201) },
		func(in *Input) { in.Configuration.SetupCommand = strings.Repeat("x", 8193) },
		func(in *Input) { in.Configuration.SetupCommand = "a\x00b" },
		func(in *Input) { in.Configuration.Repositories = make([]storage.Repository, 101) },
		func(in *Input) { in.Configuration.Repositories[0].URL = strings.Repeat("x", 301) },
		func(in *Input) { in.Configuration.Repositories[0].Name = strings.Repeat("x", 141) },
		func(in *Input) {
			in.Configuration.Repositories = append(in.Configuration.Repositories, storage.Repository{URL: "OWNER/private"})
		},
	} {
		in := input("owner/private", "main")
		mutate(&in)
		if _, err := s.Validate(context.Background(), in); err == nil {
			t.Fatal("accepted invalid input")
		}
	}
}

func TestValidateEveryRepositoryAndBranch(t *testing.T) {
	s := fixture(t)
	in := input("first/app", "main")
	in.Configuration.Repositories = append(in.Configuration.Repositories,
		storage.Repository{URL: "second/app", BaseBranch: "release", Role: "core"},
		storage.Repository{URL: "third/extra", BaseBranch: "next", Role: "extra"})
	for _, missing := range []string{"", "/repos/second/app", "/repos/third/extra/branches/next"} {
		var paths []string
		s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
			paths = append(paths, r.URL.Path)
			if r.URL.Path == missing {
				return response(404, ""), nil
			}
			return response(200, `{"default_branch":"main"}`), nil
		})
		got, err := s.Validate(context.Background(), in)
		if missing != "" {
			if err == nil {
				t.Fatalf("accepted missing %s", missing)
			}
			continue
		}
		if err != nil || len(paths) != 6 || got.Configuration.Repositories[1].Name != "second/app" || got.Configuration.Repositories[2].Role != "extra" {
			t.Fatalf("validation: %+v %v %v", got, paths, err)
		}
	}
}
