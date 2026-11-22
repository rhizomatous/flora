package projects

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestPullReferenceDiscoveryKeepsCredentialsInHeaders(t *testing.T) {
	s := fixture(t)
	s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "api.github.com" || r.URL.Path != "/repos/owner/private/pulls" || r.Header.Get("Authorization") != "Bearer github_pat_SECRET" {
			t.Fatalf("unsafe request: %s", r.URL)
		}
		return response(200, `[{"number":42,"title":"Title","body":"Description","token":"must-not-enter-context"}]`), nil
	})
	pulls, err := s.ContextPulls(context.Background(), "owner/private")
	if err != nil || len(pulls) != 1 || pulls[0].Number != 42 || pulls[0].Title != "Title" {
		t.Fatal(pulls, err)
	}
	s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		return response(403, `{"message":"github_pat_SECRET"}`), nil
	})
	if _, err := s.ContextPulls(context.Background(), "owner/private"); err == nil || strings.Contains(err.Error(), "SECRET") {
		t.Fatal("missing access error or credential leak", err)
	}
}

func TestPullReferenceStatus(t *testing.T) {
	merged := "2026-11-22T12:00:00Z"
	for _, tc := range []struct {
		pull PullContext
		want string
	}{
		{PullContext{State: "open"}, "open"},
		{PullContext{State: "open", Draft: true}, "draft"},
		{PullContext{State: "closed"}, "closed"},
		{PullContext{State: "closed", MergedAt: &merged}, "merged"},
		{PullContext{}, "unknown"},
	} {
		if got := tc.pull.Status(); got != tc.want {
			t.Errorf("status = %q, want %q", got, tc.want)
		}
	}
}
