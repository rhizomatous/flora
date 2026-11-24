package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestGitHubRoutesRequireLiveInitiatingSession(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	authentication := auth.New(store)
	first := strings.Repeat("s", 43)
	if err := store.Bootstrap(ctx, "unused-hash", auth.TokenHash(first), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	config := settings.New(store)
	handler := New(fstest.MapFS{"index.html": {Data: []byte("public shell")}}, authentication, config, "https://flora.test")
	call := func(method, path, body, session, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if session != "" {
			r.AddCookie(&http.Cookie{Name: cookieName, Value: session})
		}
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := call("POST", "/api/github/connect", "{}", "", "https://flora.test"); w.Code != 401 {
		t.Fatal(w.Code, w.Body)
	}
	if w := call("POST", "/api/github/connect", "{}", first, "https://evil.test"); w.Code != 403 {
		t.Fatal(w.Code, w.Body)
	}
	start := call("POST", "/api/github/connect", "{}", first, "https://flora.test")
	if start.Code != 200 {
		t.Fatal(start.Code, start.Body)
	}
	if !strings.Contains(start.Header().Get("Content-Security-Policy"), "https://github.com/settings/apps/new") {
		t.Fatal("manifest submission blocked")
	}
	landing := call("GET", "/github/callback?code=code&state=untrusted", "", "", "")
	if landing.Code != 303 || !strings.HasSuffix(landing.Header().Get("Location"), "#settings") {
		t.Fatal(landing.Code, landing.Body)
	}
	if _, err := store.GitHubApp(ctx); err != storage.ErrNotFound {
		t.Fatal("landing route changed credentials")
	}
	if w := call("POST", "/api/github/complete", `{"state":"untrusted","code":"code"}`, first, "https://flora.test"); w.Code != 400 {
		t.Fatal(w.Code, w.Body)
	}
	view := call("GET", "/api/github/connection", "", first, "")
	var body map[string]any
	if view.Code != 200 || json.Unmarshal(view.Body.Bytes(), &body) != nil || body["state"] != "disconnected" {
		t.Fatal(view.Code, view.Body)
	}
	if strings.Contains(view.Body.String(), "secret") || strings.Contains(view.Body.String(), "PrivateKey") {
		t.Fatal("connection exposes credentials")
	}
	if err := authentication.Logout(ctx, first); err != nil {
		t.Fatal(err)
	}
	if w := call("POST", "/api/github/complete", `{"state":"untrusted","code":"code"}`, first, "https://flora.test"); w.Code != 401 {
		t.Fatal(w.Code, w.Body)
	}
}
