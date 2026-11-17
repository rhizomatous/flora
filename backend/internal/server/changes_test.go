package server

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/changes"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/testfixture"
	"github.com/rhizomatous/flora/backend/internal/webassets"
)

func savedReview(t *testing.T, store *storage.Store, p storage.Project) storage.Chat {
	t.Helper()
	c, err := testfixture.SavedReview(store, p)
	if err != nil {
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
	if len(r.Pulls.Items) != 5 || r.Pulls.Error == "" {
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

// Chat summaries must remain available even when the much larger diff artifact is unreadable.
func TestChatPullSummaries(t *testing.T) {
	store, svc, auth, token, p, cleanup := chatAPI(t)
	defer cleanup()
	c := savedReview(t, store, p)
	paths, err := store.Paths(context.Background(), c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(paths.Artifacts, "changes.json"), []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	h := New(webassets.FS(), auth, settings.New(store), "https://flora.test", svc)
	expected := changes.New(store, nil).ReadPulls(context.Background(), c.ID)
	for _, endpoint := range []string{"/api/notifications", "/api/chats", "/api/chats/" + c.ID} {
		r := httptest.NewRequest("GET", endpoint, nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 401 {
			t.Fatalf("%s exposed PRs without authentication", endpoint)
		}
		r = httptest.NewRequest("GET", endpoint, nil)
		r.AddCookie(&http.Cookie{Name: cookieName, Value: token})
		w = httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("%s: %s", endpoint, w.Body.String())
		}
		var rows []chatView
		switch endpoint {
		case "/api/chats":
			err = json.Unmarshal(w.Body.Bytes(), &rows)
		case "/api/notifications":
			var feed struct{ Chats []chatView }
			err = json.Unmarshal(w.Body.Bytes(), &feed)
			rows = feed.Chats
		default:
			var detail struct{ Chat chatView }
			err = json.Unmarshal(w.Body.Bytes(), &detail)
			rows = []chatView{detail.Chat}
		}
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, row := range rows {
			if row.ID == c.ID {
				found = true
				if !reflect.DeepEqual(row.Pulls, expected) {
					t.Fatalf("%s: lost saved PR status: %+v", endpoint, row.Pulls)
				}
			}
		}
		if !found {
			t.Fatalf("%s: missing chat", endpoint)
		}
	}
	if err := os.Remove(filepath.Join(paths.Artifacts, "pulls.json")); err != nil {
		t.Fatal(err)
	}
	empty := changes.New(store, nil).ReadPulls(context.Background(), c.ID)
	if empty.Items == nil || len(empty.Items) != 0 || empty.Error != "" {
		t.Fatalf("missing artifact: %+v", empty)
	}
	if err := os.WriteFile(filepath.Join(paths.Artifacts, "pulls.json"), []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	broken := changes.New(store, nil).ReadPulls(context.Background(), c.ID)
	if broken.Items == nil || len(broken.Items) != 0 || broken.Error == "" {
		t.Fatalf("corrupt artifact: %+v", broken)
	}
}

func TestPullComparisonSavedDownloadAndAuthorization(t *testing.T) {
	store, svc, auth, token, p, cleanup := chatAPI(t)
	defer cleanup()
	c := savedReview(t, store, p)
	paths, _ := store.Paths(context.Background(), c.ID)
	link := "https://github.com/first/app/pull/7"
	sum := sha256.Sum256([]byte(link))
	snapshot := changes.PullReview{Snapshot: &changes.PullSnapshot{Snapshot: changes.Snapshot{ID: "pr-revision", CapturedAt: "2026-01-01T00:00:00Z", Base: strings.Repeat("a", 40), Files: []changes.File{{Path: "large.txt", Diff: "full saved PR diff", Bytes: 2000000}}}, URL: link, BaseRevision: changes.PullRevision{Repository: "first/app", Ref: "main", SHA: strings.Repeat("a", 40)}, HeadRevision: changes.PullRevision{Repository: "fork/app", Ref: "topic", SHA: strings.Repeat("b", 40)}}}
	data, _ := json.Marshal(snapshot)
	if err := os.WriteFile(filepath.Join(paths.Artifacts, fmt.Sprintf("pull-review-%x.json", sum)), data, 0600); err != nil {
		t.Fatal(err)
	}
	h := New(webassets.FS(), auth, settings.New(store), "https://flora.test", svc)
	base := "/api/chats/" + c.ID + "/pull-comparison"
	call := func(method, path, session string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		r.Header.Set("Origin", "https://flora.test")
		if session != "" {
			r.AddCookie(&http.Cookie{Name: cookieName, Value: session})
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	query := "?repository=first/app&number=7"
	download := base + "/0/diff" + query + "&snapshot=pr-revision"
	for _, path := range []string{base + query, download} {
		if w := call("GET", path, ""); w.Code != 401 {
			t.Fatalf("unprotected comparison %d", w.Code)
		}
	}
	if w := call("POST", base+query, ""); w.Code != 401 {
		t.Fatal("unprotected refresh")
	}
	w := call("GET", base+query, token)
	var review changes.PullReview
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &review) != nil || review.Snapshot == nil || !review.Snapshot.Files[0].Truncated || review.Snapshot.Files[0].Diff != "" {
		t.Fatalf("inline response %d %s", w.Code, w.Body.String())
	}
	w = call("GET", download, token)
	if w.Code != 200 || w.Body.String() != "full saved PR diff" || w.Header().Get("Content-Disposition") == "" {
		t.Fatal("full comparison download unavailable")
	}
	if w = call("GET", strings.Replace(download, "pr-revision", "old", 1), token); w.Code != 409 {
		t.Fatal("stale revision downloaded")
	}
	if w = call("GET", base+"?repository=second/app&number=7", token); w.Code != 200 || !strings.Contains(w.Body.String(), `"snapshot":null`) {
		t.Fatal("independent repository comparison lost")
	}
	if w = call("GET", base+"?repository=third/private&number=10", token); w.Code != 404 {
		t.Fatalf("unverified PR accepted: %d", w.Code)
	}
	if w = call("GET", base+"?repository=unlinked/repo&number=1", token); w.Code != 404 {
		t.Fatal("unlinked PR accepted")
	}
}
