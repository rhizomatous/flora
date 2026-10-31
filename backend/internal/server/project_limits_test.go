package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/projects"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestProjectBodyLimitAcceptsFullCollection(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.SaveCredentials(ctx, storage.Credentials{GitHubToken: "fixture-only", Provider: "anthropic", Model: "fixture", ProviderKey: "fixture-only"}); err != nil {
		t.Fatal(err)
	}
	svc := projects.New(store)
	calls := 0
	svc.Client.Transport = projectTransport(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"default_branch":"main"}`))}, nil
	})
	a := &api{projects: svc}
	mux := http.NewServeMux()
	a.projectRoutes(mux)
	in := projects.Input{Name: strings.Repeat("<", 200), Configuration: storage.Configuration{SetupCommand: strings.Repeat("<", 8192)}}
	for i := 0; i < projects.MaxRepositories; i++ {
		in.Configuration.Repositories = append(in.Configuration.Repositories, storage.Repository{URL: fmt.Sprintf("https://github.com/%s/%s%03d.git", strings.Repeat("o", 39), strings.Repeat("r", 97), i), BaseBranch: strings.Repeat("<", 255), Role: "extra"})
	}
	body, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	if len(body) <= 16<<10 || len(body) > projects.MaxInputBytes {
		t.Fatalf("unexpected fixture size %d", len(body))
	}
	request := func(body []byte) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/api/projects", bytes.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	if w := request(body); w.Code != 201 || calls != 2*projects.MaxRepositories {
		t.Fatalf("full collection rejected: %d %s (%d calls)", w.Code, w.Body, calls)
	}
	if w := request(append(bytes.Repeat([]byte(" "), projects.MaxInputBytes), body...)); w.Code != 400 {
		t.Fatalf("oversized body accepted: %d", w.Code)
	}
	// The shared decoder used by auth/settings retains its smaller limit.
	r := httptest.NewRequest("POST", "/api/settings", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	var value any
	if decode(w, r, &value) {
		t.Fatal("project limit broadened other routes")
	}
}
