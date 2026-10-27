package server

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestRoutes(t *testing.T) {
	store, err := storage.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	handler := New(fstest.MapFS{
		"index.html":    {Data: []byte("<!doctype html><title>Flora</title>")},
		"assets/app.js": {Data: []byte("console.log('flora')")},
		"docs/help.txt": {Data: []byte("Flora help")},
	}, auth.New(store), settings.New(store), "https://flora.test")
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
		{"GET", "/api/missing", 401, "application/json", "Log in"},
		{"GET", "/api/john.doe", 401, "application/json", "Log in"},
		{"GET", "/api/", 401, "application/json", "Log in"},
		{"GET", "/api", 401, "application/json", "Log in"},
		{"POST", "/", 403, "application/json", "HTTPS"},
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
