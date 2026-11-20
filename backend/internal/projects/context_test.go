package projects

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestPullContextKeepsTokenInHeadersAndBoundsSource(t *testing.T) {
	s := fixture(t)
	s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "api.github.com" || r.URL.Path != "/repos/owner/private/pulls/42" || r.Header.Get("Authorization") != "Bearer github_pat_SECRET" {
			t.Fatalf("unsafe request: %s", r.URL)
		}
		return response(200, `{"number":42,"title":"Title","body":"Description","state":"open","updated_at":"now","head":{"sha":"head"},"base":{"sha":"base"},"token":"must-not-enter-context"}`), nil
	})
	pulls, err := s.ContextPulls(context.Background(), "owner/private", 42)
	if err != nil || len(pulls) != 1 || pulls[0].Body != "Description" || pulls[0].Head.SHA != "head" {
		t.Fatal(pulls, err)
	}
	s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		return response(403, `{"message":"github_pat_SECRET"}`), nil
	})
	if _, err := s.ContextPulls(context.Background(), "owner/private", 42); err == nil || strings.Contains(err.Error(), "SECRET") {
		t.Fatal("missing access error or credential leak", err)
	}
	s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) { return response(200, `{}`), nil })
	if _, err := s.ContextPulls(context.Background(), "owner/private", 42); err == nil {
		t.Fatal("accepted incomplete PR")
	}
}
