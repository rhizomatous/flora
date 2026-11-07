package changes

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestVerifyPullLinksAndRetainOnFailure(t *testing.T) {
	s, c, _ := fixture(t)
	ctx := context.Background()
	credentials(t, s, "host-only-test-token")
	if err := s.Store.SaveRuntimeMessage(ctx, "link-event", storage.Message{ChatID: c.ID, RuntimeMessageID: "assistant-1", Role: "assistant", Text: "Created https://github.com/example/core/pull/42 and https://github.com/other/repo/pull/9", Payload: json.RawMessage(`{"parts":[{"type":"tool","state":{"output":"https://evil.test/example/core/pull/42"}}]}`)}); err != nil {
		t.Fatal(err)
	}
	requests := 0
	fail := false
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		requests++
		if r.Header.Get("Authorization") != "Bearer host-only-test-token" {
			t.Fatalf("unsafe verification: %s", r.URL)
		}
		if r.URL.Path == "/repos/other/repo/pulls/9" {
			return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader(`{}`)), Header: make(http.Header)}, nil
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
	if err != nil || len(r.Pulls.Items) != 1 || !r.Pulls.Items[0].Draft || r.Pulls.Error != "" {
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
	if err != nil || len(r.Pulls.Items) != 1 || r.Pulls.Error == "" || requests != 3 || strings.Contains(r.Pulls.Error, "sensitive") {
		t.Fatalf("PR retention failed: %+v %v", r.Pulls, err)
	}
}

func TestEmptyPullScanThrottlesAndDiscoversLaterLink(t *testing.T) {
	s, c, _ := fixture(t)
	ctx := context.Background()
	requests := 0
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		requests++
		if r.URL.String() != "https://api.github.com/repos/example/core/pulls/42" {
			t.Fatalf("unexpected verification: %s", r.URL)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"number":42,"state":"open","draft":true,"html_url":"https://github.com/example/core/pull/42"}`)), Header: make(http.Header)}, nil
	})}
	s.verifyPulls(ctx, c, client)
	p, err := s.Store.Paths(ctx, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(p.Artifacts)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	var empty Pulls
	if err = load(root, "pulls.json", &empty); err != nil {
		t.Fatal(err)
	}
	if stamp, err := time.Parse(time.RFC3339Nano, empty.CheckedAt); err != nil || time.Since(stamp) >= 30*time.Second || len(empty.Items) != 0 || requests != 0 {
		t.Fatalf("empty scan was not recorded: %+v %v", empty, err)
	}
	before, err := root.Stat("pulls.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Store.SaveCredentials(ctx, storage.Credentials{GitHubToken: "fixture-token", Provider: "anthropic", Model: "test", ProviderKey: "fixture-key"}); err != nil {
		t.Fatal(err)
	}
	if err = s.Store.SaveRuntimeMessage(ctx, "new-link", storage.Message{ChatID: c.ID, RuntimeMessageID: "assistant-link", Role: "assistant", Text: "https://github.com/example/core/pull/42", Payload: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	// A new service also honors the saved scan window without reading new links.
	New(s.Store, nil).verifyPulls(ctx, c, client)
	after, err := root.Stat("pulls.json")
	if err != nil {
		t.Fatal(err)
	}
	if requests != 0 || !os.SameFile(before, after) {
		t.Fatal("empty scan did not throttle the next scan and write")
	}
	empty.CheckedAt = time.Now().Add(-31 * time.Second).UTC().Format(time.RFC3339Nano)
	if err = save(root, "pulls.json", empty); err != nil {
		t.Fatal(err)
	}
	s.verifyPulls(ctx, c, client)
	var discovered Pulls
	if err = load(root, "pulls.json", &discovered); err != nil {
		t.Fatal(err)
	}
	if requests != 1 || len(discovered.Items) != 1 || discovered.Items[0].Number != 42 || discovered.CheckedAt == empty.CheckedAt {
		t.Fatalf("new link was not discovered after the scan window: %+v", discovered)
	}
}
