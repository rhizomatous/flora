package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/chat"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/testfixture"
	"github.com/rhizomatous/flora/backend/internal/webassets"
	sse "github.com/tmaxmax/go-sse"
)

func chatAPI(t *testing.T, interactive ...bool) (*storage.Store, *chat.Service, *auth.Service, string, storage.Project, func()) {
	t.Helper()
	fixture, err := testfixture.New(context.Background(), t.TempDir(), len(interactive) > 0 && interactive[0])
	if err != nil {
		t.Fatal(err)
	}
	return fixture.Store, fixture.Service, fixture.Auth, fixture.Token, fixture.Project, fixture.Close
}

func TestChatAPIAuthenticationValidationAndReplay(t *testing.T) {
	store, svc, authentication, token, project, cleanup := chatAPI(t)
	defer cleanup()
	server := httptest.NewUnstartedServer(nil)
	origin := "http://" + server.Listener.Addr().String()
	server.Config.Handler = New(webassets.FS(), authentication, settings.New(store), origin, svc)
	server.Start()
	defer server.Close()
	call := func(method, path, body, cookie, requestOrigin string, want int) []byte {
		t.Helper()
		r, _ := http.NewRequest(method, server.URL+path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", requestOrigin)
		if cookie != "" {
			r.AddCookie(&http.Cookie{Name: cookieName, Value: cookie})
		}
		res, err := server.Client().Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		if res.StatusCode != want {
			t.Fatalf("%s %s = %d, want %d: %s", method, path, res.StatusCode, want, b)
		}
		if strings.Contains(string(b), "test-secret") {
			t.Fatal("credential leaked")
		}
		return b
	}
	for _, route := range []struct{ method, path string }{
		{"GET", "/api/notifications"},
		{"POST", "/api/chats/missing/interrupt"}, {"POST", "/api/chats/missing/stop"},
		{"GET", "/api/chats"}, {"GET", "/api/chats/missing/setup-log"}, {"HEAD", "/api/chats/missing/setup-log"}, {"GET", "/api/chats/missing"}, {"GET", "/api/chats/missing/events"}, {"GET", "/api/chats/missing/questions"}, {"POST", "/api/projects/" + project.ID + "/chats"}, {"POST", "/api/chats/missing/messages"}, {"POST", "/api/chats/missing/questions/question/reply"},
	} {
		call(route.method, route.path, "{}", "", origin, 401)
		if route.method == "POST" {
			call(route.method, route.path, "{}", token, "https://evil.test", 403)
		}
	}
	body := `{"title":"Persistent API chat","requestID":"initial","text":"First prompt"}`
	path := "/api/projects/" + project.ID + "/chats"
	for _, invalid := range []string{`{"title":"Test","requestID":"bad","text":""}`, `{"title":"Test","requestID":"bad","text":"` + strings.Repeat("🌸", 32769) + `"}`, "{\"text\":\"" + string([]byte{255}) + "\"}", `{} {}`, `{"unknown":1}`} {
		call("POST", path, invalid, token, origin, 400)
	}
	var c storage.Chat
	if err := json.Unmarshal(call("POST", path, body, token, origin, 202), &c); err != nil {
		t.Fatal(err)
	}
	var duplicate storage.Chat
	json.Unmarshal(call("POST", path, body, token, origin, 202), &duplicate)
	if c.ID != duplicate.ID {
		t.Fatal("creation retry created a second chat")
	}
	call("GET", "/api/chats/"+c.ID+"/setup-log", "", token, "", 404)
	paths, err := store.Paths(context.Background(), c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(paths.Logs, "setup.log"), []byte("full retained setup output\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := call("GET", "/api/chats/"+c.ID+"/setup-log", "", token, "", 200); string(got) != "full retained setup output\n" {
		t.Fatal("full setup log download lost output")
	}
	call("POST", "/api/chats/"+c.ID+"/messages", `{"requestID":"active","text":"not queued"}`, token, origin, 409)
	call("GET", "/api/chats/"+c.ID+"/events?after=invalid", "", token, "", 400)
	call("GET", "/api/chats/missing/events", "", token, "", 404)
	read := func(after string, stopKind string) []storage.Activity {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		r, _ := http.NewRequestWithContext(ctx, "GET", server.URL+"/api/chats/"+c.ID+"/events", nil)
		r.AddCookie(&http.Cookie{Name: cookieName, Value: token})
		r.Header.Set("Last-Event-ID", after)
		res, err := server.Client().Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.Header.Get("Content-Type") != "text/event-stream" {
			t.Fatal("not SSE")
		}
		rows := []storage.Activity{}
		for event, err := range sse.Read(res.Body, nil) {
			if err != nil {
				t.Fatal(err)
			}
			var row storage.Activity
			if json.Unmarshal([]byte(event.Data), &row) != nil {
				t.Fatal("invalid event JSON")
			}
			if len(rows) > 0 && row.Sequence <= rows[len(rows)-1].Sequence {
				t.Fatal("replay out of order")
			}
			rows = append(rows, row)
			if row.Kind == stopKind {
				return rows
			}
		}
		t.Fatal("missing event")
		return nil
	}
	initial := read("", "message.accepted")
	cursor := initial[len(initial)-1].Sequence
	// No browser stream remains connected. Work must still complete and persist.
	time.Sleep(time.Second)
	call("GET", "/api/chats/"+c.ID, "", token, "", 200)
	if err := store.AppendActivity(context.Background(), c.ID, "reconnect-marker", "test.reconnect", json.RawMessage(`{"saved":true}`)); err != nil {
		t.Fatal(err)
	}
	replayed := read(fmt.Sprint(cursor), "test.reconnect")
	for _, row := range replayed {
		if row.Sequence <= cursor {
			t.Fatal("duplicate after cursor")
		}
	}
	if len(replayed) < 2 {
		t.Fatal("missed completion activity")
	}
	// The maximum decoded size is accepted even when every codepoint is multibyte.
	maxBody, _ := json.Marshal(map[string]string{"requestID": "max", "text": strings.Repeat("🌸", 32768)})
	call("POST", "/api/chats/"+c.ID+"/messages", string(maxBody), token, origin, 202)
	call("POST", "/api/chats/"+c.ID+"/messages", string(maxBody), token, origin, 202)
	// New saves reach an already connected client within one second. Revoking
	// its session also ends that open stream rather than leaking future activity.
	streamCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(streamCtx, "GET", server.URL+"/api/chats/"+c.ID+"/events", nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: token})
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	arrival := make(chan time.Time, 1)
	closed := make(chan struct{})
	go func() {
		defer close(closed)
		for event, err := range sse.Read(res.Body, nil) {
			if err != nil {
				return
			}
			if strings.Contains(event.Data, "live-marker") {
				arrival <- time.Now()
			}
		}
	}()
	savedAt := time.Now()
	if err := store.AppendActivity(context.Background(), c.ID, "live-marker", "test.live", json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	select {
	case at := <-arrival:
		if at.Sub(savedAt) >= time.Second {
			t.Fatal("status delivery exceeded one second")
		}
	case <-time.After(time.Second):
		t.Fatal("no live event")
	}
	if err := authentication.Logout(context.Background(), token); err != nil {
		t.Fatal(err)
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("revoked stream stayed open")
	}
	call("GET", "/api/chats/"+c.ID+"/events", "", token, "", 401)
}
