package server

import (
	"context"
	"encoding/json"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/webassets"
)

func TestUsageRequiresAuthenticationAndBoundedRange(t *testing.T) {
	store, svc, authentication, token, _, cleanup := chatAPI(t)
	defer cleanup()
	handler := New(webassets.FS(), authentication, settings.New(store), "http://localhost", svc)
	for _, test := range []struct {
		query         string
		authenticated bool
		status        int
	}{
		{"?from=2026-11-01T00:00:00Z&to=2026-11-02T00:00:00Z", false, 401},
		{"?from=2026-11-01T00:00:00Z&to=2026-11-02T00:00:00Z", true, 200},
		{"", true, 400},
		{"?from=2026-11-02T00:00:00Z&to=2026-11-01T00:00:00Z", true, 400},
		{"?from=2024-01-01T00:00:00Z&to=2026-11-01T00:00:00Z", true, 400},
	} {
		req := httptest.NewRequest("GET", "http://localhost/api/usage"+test.query, nil)
		if test.authenticated {
			req.AddCookie(&http.Cookie{Name: cookieName, Value: token})
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != test.status {
			t.Fatalf("%s: got %d want %d: %s", test.query, response.Code, test.status, response.Body.String())
		}
	}
}

func TestUsageChatLinksUsePublicIDs(t *testing.T) {
	store, svc, authentication, token, project, cleanup := chatAPI(t)
	defer cleanup()
	ctx := context.Background()
	c, err := store.CreateChat(ctx, project.ID, "Usage", "flora@sha256:"+strings.Repeat("a", 64), "1")
	if err != nil {
		t.Fatal(err)
	}
	raw := json.RawMessage(`{"info":{"id":"assistant","role":"assistant","time":{"created":1000,"completed":2000}},"parts":[{"id":"step","type":"step-finish","cost":0.025,"tokens":{"input":12,"output":34,"cache":{"read":0,"write":0}}}]}`)
	if err := store.SaveUsageMessage(ctx, c.ID, "root", "", "", raw); err != nil {
		t.Fatal(err)
	}
	handler := New(webassets.FS(), authentication, settings.New(store), "http://localhost", svc)
	req := httptest.NewRequest("GET", "http://localhost/api/usage?from=1970-01-01T00:00:00Z&to=1970-01-02T00:00:00Z", nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: token})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	var report storage.UsageReport
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	if err := json.Unmarshal(response.Body.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if len(report.Chats) != 1 || report.Chats[0].ID != c.PublicID {
		t.Fatalf("missing public chat link: %+v", report.Chats)
	}
}
