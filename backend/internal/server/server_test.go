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
		"docs/help.txt": {Data: []byte("Flora help")},
	})
	for _, tc := range []struct {
		method, path      string
		status            int
		contentType, body string
	}{
		{"GET", "/api/health", 200, "application/json", `{"status":"ok"}`},
		{"GET", "/", 200, "text/html", "<title>Flora</title>"},
		{"GET", "/chats/example", 200, "text/html", "<title>Flora</title>"},
		{"GET", "/chats/john-doe", 200, "text/html", "<title>Flora</title>"},
		{"GET", "/chats/john.doe", 200, "text/html", "<title>Flora</title>"},
		{"GET", "/chats/john.doe/", 200, "text/html", "<title>Flora</title>"},
		{"GET", "/chats/archive.css/messages", 200, "text/html", "<title>Flora</title>"},
		{"GET", "/assets/app.js", 200, "javascript", "console.log"},
		{"GET", "/assets", 404, "text/plain", "404"},
		{"GET", "/assets/", 404, "text/plain", "404"},
		{"GET", "/docs", 404, "text/plain", "404"},
		{"GET", "/docs/", 404, "text/plain", "404"},
		{"GET", "/assets/missing", 404, "text/plain", "404"},
		{"GET", "/assets/missing.js", 404, "text/plain", "404"},
		{"GET", "/missing.js", 404, "text/plain", "404"},
		{"GET", "/missing.CSS", 404, "text/plain", "404"},
		{"GET", "/missing.js.map", 404, "text/plain", "404"},
		{"GET", "/favicon.ico", 404, "text/plain", "404"},
		{"GET", "/images/missing.svg", 404, "text/plain", "404"},
		{"GET", "/fonts/missing.woff2", 404, "text/plain", "404"},
		{"GET", "/manifest.webmanifest", 404, "text/plain", "404"},
		{"GET", "/api/missing", 404, "text/plain", "404"},
		{"GET", "/api/john.doe", 404, "text/plain", "404"},
		{"GET", "/api/", 404, "text/plain", "404"},
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
