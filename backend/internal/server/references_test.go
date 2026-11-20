package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/webassets"
)

func TestReferenceFileSnapshotSafety(t *testing.T) {
	store, _, auth, token, p, cleanup := chatAPI(t)
	defer cleanup()
	ctx := context.Background()
	c, err := store.CreateChat(ctx, p.ID, "Files", "flora@sha256:"+strings.Repeat("a", 64), "1")
	if err != nil {
		t.Fatal(err)
	}
	paths, err := store.Paths(ctx, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	creds := storage.Credentials{Provider: "anthropic", Model: "model", ProviderKey: "private-provider-key", GitHubToken: "github_pat_private-token"}
	if err := store.SaveCredentials(ctx, creds); err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string]string{"task.txt": "Use " + creds.ProviderKey + " and " + creds.GitHubToken, "large.txt": strings.Repeat("x", storage.MaxReferenceBytes+1), ".env": "password", "binary": string([]byte{0, 1, 2})} {
		if err := os.WriteFile(filepath.Join(paths.Workspace, name), []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	h := New(webassets.FS(), auth, settings.New(store), "https://flora.test")
	call := func(name, chat, session string) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(map[string]any{"chatID": chat, "source": contextSource{Kind: "file", Repository: p.Configuration.Repositories[0].Name, Path: name}})
		r := httptest.NewRequest("POST", "/api/projects/"+p.ID+"/context", strings.NewReader(string(raw)))
		r.Header.Set("Origin", "https://flora.test")
		r.Header.Set("Content-Type", "application/json")
		if session != "" {
			r.AddCookie(&http.Cookie{Name: cookieName, Value: session})
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := call("task.txt", c.ID, ""); w.Code != 401 {
		t.Fatal(w.Code, w.Body.String())
	}
	w := call("task.txt", c.ID, token)
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	var ref storage.ContextReference
	if err := json.Unmarshal(w.Body.Bytes(), &ref); err != nil {
		t.Fatal(err)
	}
	if ref.Content != "" || ref.Version == "" {
		t.Fatal("snapshot response exposed bytes or lost version")
	}
	if err := os.WriteFile(filepath.Join(paths.Workspace, "task.txt"), []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	a, err := store.AcceptMessageWithContext(ctx, c.ID, "send", "Review", nil, []string{ref.ID})
	if err != nil {
		t.Fatal(err)
	}
	raw := string(a.Message.Payload)
	if strings.Contains(raw, creds.ProviderKey) || strings.Contains(raw, creds.GitHubToken) || strings.Contains(raw, "changed") || !strings.Contains(raw, "[redacted]") {
		t.Fatal("unsafe or changed snapshot", raw)
	}
	for _, name := range []string{"missing.txt", "large.txt", ".env", "binary", "../escape"} {
		if w := call(name, c.ID, token); w.Code < 400 {
			t.Fatal("accepted", name, w.Body.String())
		}
	}
	if w := call("task.txt", "", token); w.Code != 409 {
		t.Fatal("new chat read workspace", w.Code, w.Body.String())
	}
}
