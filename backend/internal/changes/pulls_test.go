package changes

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestVerifyPullLinksAndRetainOnFailure(t *testing.T) {
	s, c, _ := fixture(t)
	ctx := context.Background()
	if err := s.Store.SaveCredentials(ctx, storage.Credentials{GitHubToken: "host-only-test-token", Provider: "anthropic", Model: "test", ProviderKey: "test-key"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Store.SaveRuntimeMessage(ctx, "link-event", storage.Message{ChatID: c.ID, RuntimeMessageID: "assistant-1", Role: "assistant", Text: "Created https://github.com/example/core/pull/42 and https://github.com/other/repo/pull/9", Payload: json.RawMessage(`{"parts":[{"type":"tool","state":{"output":"https://evil.test/example/core/pull/42"}}]}`)}); err != nil {
		t.Fatal(err)
	}
	requests := 0
	fail := false
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		requests++
		if r.URL.String() != "https://api.github.com/repos/example/core/pulls/42" || r.Header.Get("Authorization") != "Bearer host-only-test-token" {
			t.Fatalf("unsafe verification: %s", r.URL)
		}
		status := 200
		body := `{"number":42,"state":"open","draft":true,"html_url":"https://github.com/example/core/pull/42"}`
		if fail {
			status = 403
			body = `{"message":"sensitive upstream failure"}`
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}
	s.verifyPulls(ctx, c, client)
	r, err := s.Read(ctx, c.ID, true)
	if err != nil || len(r.Pulls.Items) != 1 || !r.Pulls.Items[0].Draft {
		t.Fatalf("unverified PR: %+v %v", r.Pulls, err)
	}
	p, _ := s.Store.Paths(ctx, c.ID)
	root, _ := os.OpenRoot(p.Artifacts)
	defer root.Close()
	r.Pulls.CheckedAt = ""
	if err := save(root, "pulls.json", r.Pulls); err != nil {
		t.Fatal(err)
	}
	fail = true
	s.verifyPulls(ctx, c, client)
	r, err = s.Read(ctx, c.ID, true)
	if err != nil || len(r.Pulls.Items) != 1 || r.Pulls.Error == "" || requests != 2 || strings.Contains(r.Pulls.Error, "sensitive") {
		t.Fatalf("PR retention failed: %+v %v", r.Pulls, err)
	}
}
