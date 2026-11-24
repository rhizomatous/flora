package server

import (
	"net/http"
	"net/http/httptest"
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
