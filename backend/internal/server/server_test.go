package server

import (
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestRoutes(t *testing.T) {
	handler := New(fstest.MapFS{
		"index.html":    {Data: []byte("<!doctype html><title>Flora</title>")},
		"assets/app.js": {Data: []byte("console.log('flora')")},
	})
	for _, tc := range []struct {
		method, path      string
		status            int
		contentType, body string
	}{
		{"GET", "/api/health", 200, "application/json", `{"status":"ok"}`},
		{"GET", "/", 200, "text/html", "<title>Flora</title>"},
		{"GET", "/chats/example", 200, "text/html", "<title>Flora</title>"},
		{"GET", "/assets/app.js", 200, "javascript", "console.log"},
		{"GET", "/assets/missing.js", 404, "text/plain", "404"},
		{"GET", "/api/missing", 404, "text/plain", "404"},
		{"GET", "/api", 404, "text/plain", "404"},
		{"POST", "/", 405, "text/plain", "Method Not Allowed"},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(tc.method, tc.path, nil))
			if response.Code != tc.status || !strings.Contains(response.Header().Get("Content-Type"), tc.contentType) || !strings.Contains(response.Body.String(), tc.body) {
				t.Fatalf("unexpected response: status=%d type=%s body=%s", response.Code, response.Header().Get("Content-Type"), response.Body.String())
			}
		})
	}
}
