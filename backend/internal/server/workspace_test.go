package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/webassets"
	"github.com/rhizomatous/flora/backend/internal/workspace"
)

func TestWorkspaceAuthenticatedPersistedAccess(t *testing.T) {
	store, _, auth, token, p, cleanup := chatAPI(t)
	defer cleanup()
	// No runtime service is installed: all access below must use the saved mount.
	h := New(webassets.FS(), auth, settings.New(store), "https://flora.test")
	for _, multi := range []bool{false, true} {
		configuration := p.Configuration
		configuration.Repositories = []storage.Repository{{Name: "first/app", Role: "core", URL: "https://github.com/first/app", BaseBranch: "main"}}
		if multi {
			configuration.Repositories = append(configuration.Repositories, storage.Repository{Name: "second/app", Role: "extra", URL: "https://github.com/second/app", BaseBranch: "main"})
		}
		project, err := store.CreateProject(context.Background(), "Files", configuration)
		if err != nil {
			t.Fatal(err)
		}
		c, err := store.CreateChat(context.Background(), project.ID, "Files", "flora@sha256:"+strings.Repeat("a", 64), "1.2.27")
		if err != nil {
			t.Fatal(err)
		}
		paths, err := store.Paths(context.Background(), c.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, repo := range configuration.Repositories {
			root := filepath.Join(paths.Workspace, strings.TrimPrefix(storage.RepositoryPath(configuration, repo), "/workspace"))
			if err := os.MkdirAll(root, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, "same.txt"), []byte(repo.Name), 0600); err != nil {
				t.Fatal(err)
			}
		}
		call := func(query, session string) *httptest.ResponseRecorder {
			r := httptest.NewRequest("GET", "/api/chats/"+c.ID+"/workspace"+query, nil)
			if session != "" {
				r.AddCookie(&http.Cookie{Name: cookieName, Value: session})
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			return w
		}
		for _, query := range []string{"", "?repository=first%2Fapp", "?repository=first%2Fapp&path=same.txt&action=preview", "?repository=first%2Fapp&path=same.txt&action=download&version=old"} {
			if w := call(query, ""); w.Code != 401 {
				t.Fatalf("unauthenticated %d", w.Code)
			}
		}
		if w := call("", token); w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		for _, repo := range configuration.Repositories {
			q := "?repository=" + url.QueryEscape(repo.Name) + "&path=same.txt"
			w := call(q+"&action=preview", token)
			var preview workspace.Preview
			if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &preview) != nil || preview.Text != repo.Name {
				t.Fatal(w.Body.String())
			}
			w = call(q+"&action=download&version="+preview.Version, token)
			if w.Code != 200 || w.Body.String() != repo.Name || w.Header().Get("Content-Disposition") == "" || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal(w.Body.String())
			}
		}
		for _, query := range []string{"?repository=outside", "?repository=first%2Fapp&path=..%2Fsecret&action=preview", "?repository=first%2Fapp&path=same.txt&action=download&version=stale", "?repository=first%2Fapp&path=missing&action=preview"} {
			if w := call(query, token); w.Code < 400 {
				t.Fatalf("unsafe access: %s", query)
			}
		}
		if err := os.RemoveAll(paths.Workspace); err != nil {
			t.Fatal(err)
		}
		if w := call("?repository=first%2Fapp", token); w.Code != 404 {
			t.Fatalf("missing mount became empty: %d %s", w.Code, w.Body.String())
		}
		if _, err := os.Stat(paths.Workspace); !os.IsNotExist(err) {
			t.Fatal("read recreated workspace")
		}

	}
}
