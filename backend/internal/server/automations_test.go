package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/webassets"
)

func TestAutomationAPIAndSharedChat(t *testing.T) {
	store, svc, authentication, token, project, cleanup := chatAPI(t)
	defer cleanup()
	origin := "https://flora.test"
	handler := New(webassets.FS(), authentication, settings.New(store), origin, svc)
	call := func(method, path, body, cookie, from string, want int) []byte {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Origin", from)
		req.Header.Set("Content-Type", "application/json")
		if cookie != "" {
			req.AddCookie(&http.Cookie{Name: cookieName, Value: cookie})
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		return w.Body.Bytes()
	}
	for _, route := range []struct{ method, path string }{{"GET", "/api/automations"}, {"GET", "/api/automations/missing"}, {"POST", "/api/automations"}, {"PUT", "/api/automations/missing"}, {"POST", "/api/automations/missing/run"}, {"POST", "/api/automations/preview"}} {
		call(route.method, route.path, "{}", "", origin, 401)
		if route.method != "GET" {
			call(route.method, route.path, "{}", token, "https://evil.test", 403)
		}
	}
	input := storage.Automation{ProjectID: project.ID, Enabled: true, AutomationConfig: storage.AutomationConfig{Name: "Review", Instructions: "Summarize this repository", Mode: "same", Frequency: "daily", Days: []int{1}, Time: "09:00", TimeZone: "UTC"}}
	body, _ := json.Marshal(input)
	var a storage.Automation
	if err := json.Unmarshal(call("POST", "/api/automations", string(body), token, origin, 200), &a); err != nil {
		t.Fatal(err)
	}
	start := func(requestID string) storage.AutomationRun {
		t.Helper()
		var r storage.AutomationRun
		if err := json.Unmarshal(call("POST", "/api/automations/"+a.ID+"/run", `{"requestID":"`+requestID+`"}`, token, origin, 202), &r); err != nil {
			t.Fatal(err)
		}
		return r
	}
	first := start("first")
	duplicate := start("first")
	if first.ChatID == "" || first.ID != duplicate.ID || first.ChatID != duplicate.ChatID {
		t.Fatalf("bad replay: %+v %+v", first, duplicate)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		c, err := store.Chat(context.Background(), first.ChatID)
		if err != nil {
			t.Fatal(err)
		}
		if c.Status == storage.Idle {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("did not complete: %+v", c)
		}
		time.Sleep(10 * time.Millisecond)
	}
	second := start("second")
	if second.ChatID != first.ChatID {
		t.Fatalf("same mode created another chat: %+v", second)
	}
	history, err := store.AutomationRuns(context.Background(), a.ID)
	if err != nil || len(history) != 2 || history[1].Status != "completed" {
		t.Fatalf("history %+v %v", history, err)
	}
	// A new-chat automation must create independent chats after completion.
	input.Mode = "new"
	body, _ = json.Marshal(input)
	if err := json.Unmarshal(call("POST", "/api/automations", string(body), token, origin, 200), &a); err != nil {
		t.Fatal(err)
	}
	third := start("third")
	if third.ChatID == first.ChatID {
		t.Fatal("new mode reused a chat")
	}
	call("POST", "/api/automations/preview", `{"name":"x","instructions":"x","mode":"new","frequency":"weekly","days":[],"time":"09:00","timeZone":"UTC"}`, token, origin, 400)
}
