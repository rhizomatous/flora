package projects

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func branchProject(t *testing.T, s *Service) storage.Project {
	t.Helper()
	p, err := s.Store.CreateProject(context.Background(), "Branches", storage.Configuration{Repositories: []storage.Repository{{Name: "owner/private", URL: "https://github.com/owner/private.git", BaseBranch: "main", Role: "core"}}})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestBranchPagesAndOverrideValidation(t *testing.T) {
	s := fixture(t)
	p := branchProject(t, s)
	calls := 0
	s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host != "api.github.com" || r.Header.Get("Authorization") != "Bearer github_pat_SECRET" {
			t.Fatal(r.URL)
		}
		if r.URL.RawQuery != "" {
			if r.URL.Path != "/repos/owner/private/branches" || r.URL.Query().Get("per_page") != "100" {
				t.Fatal(r.URL)
			}
			if r.URL.Query().Get("page") == "2" {
				return response(200, `[{"name":"release/stable"}]`), nil
			}
			rows := []string{}
			for i := 0; i < 100; i++ {
				rows = append(rows, fmt.Sprintf(`{"name":"branch-%d"}`, i))
			}
			return response(200, "["+strings.Join(rows, ",")+"]"), nil
		}
		if r.URL.EscapedPath() != "/repos/owner/private/branches/release%2Fstable" {
			t.Fatal(r.URL)
		}
		return response(200, `{}`), nil
	})
	first, err := s.Branches(context.Background(), p.ID, "owner/private", 1)
	if err != nil || len(first.Branches) != 100 || first.NextPage != 2 {
		t.Fatal(first, err)
	}
	second, err := s.Branches(context.Background(), p.ID, "owner/private", 2)
	if err != nil || len(second.Branches) != 1 || second.NextPage != 0 {
		t.Fatal(second, err)
	}
	if err := s.ValidateBranches(context.Background(), p.ID, map[string]string{"owner/private": "release/stable"}); err != nil {
		t.Fatal(err)
	}
	before := calls
	for _, branches := range []map[string]string{{"other/repo": "main"}, {"owner/private": ""}, {"owner/private": "../bad"}} {
		if err := s.ValidateBranches(context.Background(), p.ID, branches); err == nil {
			t.Fatal("invalid override accepted")
		}
	}
	if _, err := s.Branches(context.Background(), p.ID, "other/repo", 1); err == nil {
		t.Fatal("unconfigured repository accepted")
	}
	if _, err := s.Branches(context.Background(), p.ID, "owner/private", 0); err == nil {
		t.Fatal("invalid page accepted")
	}
	if calls != before {
		t.Fatal("invalid input reached GitHub")
	}
}

func TestBranchFailureResponses(t *testing.T) {
	for _, code := range []int{301, 401, 403, 404, 429, 500} {
		t.Run(fmt.Sprint(code), func(t *testing.T) {
			s := fixture(t)
			p := branchProject(t, s)
			s.Client.Transport = transport(func(*http.Request) (*http.Response, error) { return response(code, `token_SECRET`), nil })
			for _, err := range []error{func() error { _, err := s.Branches(context.Background(), p.ID, "owner/private", 1); return err }(), s.ValidateBranches(context.Background(), p.ID, map[string]string{"owner/private": "release"})} {
				if err == nil || strings.Contains(err.Error(), "SECRET") {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestDefaultBranchesAreValidatedAndMalformedPagesRejected(t *testing.T) {
	s := fixture(t)
	p := branchProject(t, s)
	s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/repos/owner/private/branches/main" {
			t.Fatal(r.URL)
		}
		return response(404, ""), nil
	})
	if err := s.ValidateBranches(context.Background(), p.ID, map[string]string{}); err == nil || !strings.Contains(err.Error(), "Base branch was not found") {
		t.Fatal(err)
	}
	for _, body := range []string{`null`, `{}`, `[{"name":"../bad"}]`, `secret invalid response`} {
		s.Client.Transport = transport(func(*http.Request) (*http.Response, error) { return response(200, body), nil })
		if _, err := s.Branches(context.Background(), p.ID, "owner/private", 1); err == nil || strings.Contains(err.Error(), "secret") {
			t.Fatal("accepted malformed response", body, err)
		}
	}
}
