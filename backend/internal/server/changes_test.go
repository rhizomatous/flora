package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/changes"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/webassets"
)

func savedReview(t *testing.T, store *storage.Store, p storage.Project) storage.Chat {
	t.Helper()
	ctx := context.Background()
	c, err := store.CreateChat(ctx, p.ID, "Saved changes", "flora@sha256:"+strings.Repeat("a", 64), "1.2.27")
	if err != nil {
		t.Fatal(err)
	}
	paths, err := store.Paths(ctx, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	snap := changes.Snapshot{ID: "fixture-snapshot", CapturedAt: "2026-01-01T00:00:00Z", Base: strings.Repeat("b", 40), Files: []changes.File{
		{Path: "src/hello.ts", Status: "M", Diff: "diff --git a/src/hello.ts b/src/hello.ts\n+hello review\n", Bytes: 61},
		{Path: "big.txt", Status: "A", Diff: strings.Repeat("+large line\n", 100000), Bytes: 1200000},
		{Path: "picture.png", Status: "M", Binary: true, Diff: "Binary files differ\n", Bytes: 20},
		{Path: "removed.txt", Status: "D", Diff: "-removed\n", Bytes: 9},
	}}
	snap.Bases = map[string]string{"first/app": strings.Repeat("b", 40), "second/app": strings.Repeat("c", 40)}
	for i := range snap.Files {
		snap.Files[i].Repository = "first/app"
	}
	snap.Files[1].Repository = "second/app"
	snap.Files = append(snap.Files, changes.File{Repository: "second/app", Path: "src/hello.ts", Status: "M", Diff: "+second repository review\n", Bytes: 26})
	b, _ := json.Marshal(snap)
	if err = os.WriteFile(filepath.Join(paths.Artifacts, "changes.json"), b, 0600); err != nil {
		t.Fatal(err)
	}
	pulls := changes.Pulls{CheckedAt: "2026-01-01T00:00:00Z", Error: "Pull request verification unavailable. Saved statuses may be out of date.", Items: []changes.Pull{
		{Repository: "first/app", URL: "https://github.com/first/app/pull/7", Number: 7, State: "open", Draft: true},
		{Repository: "second/app", URL: "https://github.com/second/app/pull/7", Number: 7, State: "merged"},
		{Repository: "first/app", URL: "https://github.com/first/app/pull/8", Number: 8, State: "closed"},
		{Repository: "third/private", URL: "https://github.com/third/private/pull/9", Number: 9, State: "open"},
	}}
	b, _ = json.Marshal(pulls)
	if err = os.WriteFile(filepath.Join(paths.Artifacts, "pulls.json"), b, 0600); err != nil {
		t.Fatal(err)
	}
	return c
}
func TestChangesAuthenticationAndFullDownload(t *testing.T) {
	store, svc, auth, token, p, cleanup := chatAPI(t)
	defer cleanup()
	c := savedReview(t, store, p)
	h := New(webassets.FS(), auth, settings.New(store), "https://flora.test", svc)
	base := "/api/chats/" + c.ID + "/changes"
	download := base + "/1/diff?snapshot=" + url.QueryEscape("fixture-snapshot")
	call := func(path, session string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest("GET", path, nil)
		if session != "" {
			r.AddCookie(&http.Cookie{Name: cookieName, Value: session})
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	for _, path := range []string{base, download} {
		if w := call(path, ""); w.Code != 401 {
			t.Fatalf("unprotected %s: %d", path, w.Code)
		}
	}
	w := call(base, token)
	var r changes.Review
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &r) != nil {
		t.Fatal(w.Body.String())
	}
	if !r.Stale || !r.Snapshot.Files[1].Truncated || r.Snapshot.Files[1].Diff != "" || r.Snapshot.Files[2].Diff != "" {
		t.Fatal("bad inline review")
	}
	if len(r.Pulls.Items) != 4 || r.Pulls.Error == "" {
		t.Fatal("saved PRs missing from authenticated review")
	}
	w = call(download, token)
	if w.Code != 200 || w.Body.Len() != 1200000 || w.Header().Get("Content-Disposition") == "" {
		t.Fatalf("bad download %d %d", w.Code, w.Body.Len())
	}
	if w = call(base+"/1/diff?snapshot=old", token); w.Code != 409 {
		t.Fatal("wrong snapshot downloaded")
	}
	if w = call(base+"/-1/diff", token); w.Code != 404 {
		t.Fatal("invalid file accepted")
	}
	if err := auth.Logout(context.Background(), token); err != nil {
		t.Fatal(err)
	}
	if w = call(download, token); w.Code != 401 {
		t.Fatal("revoked download allowed")
	}
}
func TestChangesBrowser(t *testing.T) {
	if os.Getenv("FLORA_CHAT_BROWSER_TEST") != "1" {
		t.Skip("set FLORA_CHAT_BROWSER_TEST=1 to run Chromium")
	}
	store, svc, auth, _, p, cleanup := chatAPI(t)
	defer cleanup()
	c := savedReview(t, store, p)
	srv := httptest.NewUnstartedServer(nil)
	srv.Config.Handler = New(webassets.FS(), auth, settings.New(store), "https://"+srv.Listener.Addr().String(), svc)
	srv.StartTLS()
	defer srv.Close()
	script, err := filepath.Abs("../../../scripts/changes.browser.mjs")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("node", script)
	cmd.Env = append(os.Environ(), "FLORA_BROWSER_URL="+srv.URL, "FLORA_BROWSER_CHAT="+c.ID)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("browser: %v\n%s", err, output)
	}
	t.Log(string(output))
}
