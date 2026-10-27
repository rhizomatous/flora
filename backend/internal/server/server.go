package server

import (
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/settings"
)

// New serves public static assets and protects every API except the explicit
// health/onboarding/login allowlist. Register future data routes on this mux.
func New(assets fs.FS, authentication *auth.Service, credentials *settings.Service, origin string) http.Handler {
	mux := http.NewServeMux()
	api := &api{auth: authentication, settings: credentials, origin: origin, passwordSlots: make(chan struct{}, 2)}
	api.routes(mux)
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
	return api.protect(mux)
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
