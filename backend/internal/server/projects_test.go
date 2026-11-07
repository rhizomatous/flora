package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/projects"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

type projectTransport func(*http.Request) (*http.Response, error)

func (f projectTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestProjectAPIAndChatSnapshots(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	authentication := auth.New(store)
	token, _, err := authentication.Bootstrap(ctx, "a long unique password")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveCredentials(ctx, storage.Credentials{Provider: "openai", Model: "model", GitHubToken: "github_pat_SECRET", ProviderKey: "provider_SECRET"}); err != nil {
		t.Fatal(err)
	}
	svc := projects.New(store)
	remoteStatus := 200
	svc.Client.Transport = projectTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: remoteStatus, Body: io.NopCloser(strings.NewReader(`{"default_branch":"main"}`)), Header: http.Header{}}, nil
	})
	a := &api{auth: authentication, projects: svc, origin: "https://flora.test"}
	mux := http.NewServeMux()
	a.projectRoutes(mux)
	handler := a.protect(mux)
	call := func(method, path, body, cookie, origin string, want int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", origin)
		if cookie != "" {
			r.AddCookie(&http.Cookie{Name: cookieName, Value: cookie})
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: %d want %d: %s", method, path, w.Code, want, w.Body)
		}
		if strings.Contains(w.Body.String(), "SECRET") {
			t.Fatal("credential leak")
		}
		return w
	}
	body := `{"name":"Project","configuration":{"repositories":[{"url":"owner/private"},{"url":"other/private","baseBranch":"release","role":"core"},{"url":"owner/extra","baseBranch":"next","role":"extra"}],"setupCommand":"npm ci"}}`
	for _, route := range []struct{ method, path string }{{"GET", "/api/projects"}, {"GET", "/api/projects/missing"}, {"POST", "/api/projects"}, {"PUT", "/api/projects/missing"}} {
		call(route.method, route.path, body, "", a.origin, 401)
		if route.method != "GET" {
			call(route.method, route.path, body, token, "https://evil.test", 403)
		}
	}
	if w := call("GET", "/api/projects", "", token, "", 200); strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatal(w.Body)
	}
	call("POST", "/api/projects", `{"name":"bad","extra":true}`, token, a.origin, 400)
	call("POST", "/api/projects", `{} {}`, token, a.origin, 400)
	call("POST", "/api/projects", strings.Repeat("x", 17000), token, a.origin, 400)
	w := call("POST", "/api/projects", body, token, a.origin, 201)
	var p storage.Project
	if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	if w.Header().Get("Location") != "/api/projects/"+p.ID {
		t.Fatal("missing location")
	}
	path := "/api/projects/" + p.ID
	call("GET", path, "", token, "", 200)
	call("GET", "/api/projects/missing", "", token, "", 404)
	call("PUT", "/api/projects/missing", body, token, a.origin, 404)
	second := call("POST", "/api/projects", body, token, a.origin, 201)
	var other storage.Project
	json.Unmarshal(second.Body.Bytes(), &other)
	image := "flora@sha256:" + strings.Repeat("a", 64)
	chat, err := store.CreateChat(ctx, p.ID, "Before", image, "opencode/1")
	if err != nil {
		t.Fatal(err)
	}
	if len(chat.StartingCommits) != 0 {
		t.Fatal("validation recorded a starting commit before checkout")
	}
	updated := `{"name":"Renamed","configuration":{"repositories":[{"url":"owner/other","baseBranch":"next","role":"extra"},{"url":"owner/private","baseBranch":"develop","role":"core"}],"setupCommand":"new setup"}}`
	remoteStatus = 404
	call("PUT", path, updated, token, a.origin, 400)
	unchanged, _ := store.Project(ctx, p.ID)
	if unchanged.Name != p.Name {
		t.Fatal("failed validation changed project")
	}
	remoteStatus = 200
	call("PUT", path, updated, token, a.origin, 200)
	later, err := store.CreateChat(ctx, p.ID, "After", image, "opencode/1")
	if err != nil {
		t.Fatal(err)
	}
	old, _ := store.Chat(ctx, chat.ID)
	if len(old.Configuration.Repositories) != 3 || len(later.Configuration.Repositories) != 2 || old.Configuration.Repositories[1].Name != "other/private" || old.Configuration.Repositories[1].BaseBranch != "release" || old.Configuration.Repositories[2].Role != "extra" || later.Configuration.Repositories[1].BaseBranch != "develop" {
		t.Fatal("repository arrays were not frozen per chat")
	}
	if old.Configuration.SetupCommand != "npm ci" || old.Configuration.Repositories[0].BaseBranch != "main" || later.Configuration.SetupCommand != "new setup" || later.Configuration.Repositories[0].Role != "extra" || later.Configuration.Repositories[0].BaseBranch != "next" {
		t.Fatal("snapshot settings changed incorrectly")
	}
	independent, _ := store.Project(ctx, other.ID)
	if independent.Configuration.Repositories[0].URL != p.Configuration.Repositories[0].URL || independent.Name != "Project" {
		t.Fatal("projects share mutable settings")
	}
	sha := strings.Repeat("b", 40)
	if err := store.RecordStartingCommit(ctx, chat.ID, "owner/private", sha); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordStartingCommit(ctx, chat.ID, "owner/private", strings.Repeat("c", 40)); err != storage.ErrConflict {
		t.Fatal("starting SHA moved", err)
	}
	var list []storage.Project
	json.Unmarshal(call("GET", "/api/projects", "", token, "", 200).Body.Bytes(), &list)
	if len(list) != 2 {
		t.Fatal("projects missing from list")
	}
	if err := authentication.Logout(ctx, token); err != nil {
		t.Fatal(err)
	}
	call("GET", path, "", token, "", 401)
}
