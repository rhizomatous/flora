package server

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// New serves the embedded SPA and the initial liveness endpoint.
func New(assets fs.FS) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte("{\"status\":\"ok\"}\n"))
	})
	// Unknown APIs must never receive the SPA's HTML fallback.
	mux.HandleFunc("GET /api/", http.NotFound)
	mux.HandleFunc("GET /api", http.NotFound)
	files := http.FileServerFS(assets)
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			files.ServeHTTP(w, r)
			return
		}
		if info, err := fs.Stat(assets, strings.TrimSuffix(name, "/")); err == nil {
			if info.IsDir() {
				http.NotFound(w, r)
				return
			}
			files.ServeHTTP(w, r)
			return
		}
		// Missing assets are errors, not successful HTML responses.
		if name == "assets" || strings.HasPrefix(name, "assets/") || isStaticPath(name) {
			http.NotFound(w, r)
			return
		}
		index, err := fs.ReadFile(assets, "index.html")
		if err != nil {
			http.Error(w, "web assets unavailable", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(index)
	})
	return mux
}

// Only known static extensions on the final segment suppress the SPA fallback;
// dots in client-side route identifiers (such as /chats/john.doe) are valid.
func isStaticPath(name string) bool {
	switch strings.ToLower(path.Ext(name)) {
	case ".html", ".js", ".mjs", ".css", ".map", ".json", ".webmanifest",
		".ico", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif",
		".woff", ".woff2", ".ttf", ".otf", ".wasm", ".txt", ".xml":
		return true
	default:
		return false
	}
}
