package server

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"github.com/rhizomatous/flora/backend/internal/githubapp"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func githubError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, githubapp.ErrSetup):
		failure(w, 400, githubapp.ErrSetup.Error())
	case errors.Is(err, storage.ErrNotFound):
		failure(w, 400, "GitHub access was not found. Resume setup or check the App installation on GitHub.")
	default:
		failure(w, 502, githubapp.ErrRemote.Error())
	}
}

func (a *api) githubRoutes(mux *http.ServeMux) {
	connection := a.settings.GitHub
	// Cross-site navigation cannot send the strict session cookie. Return to the
	// same-origin UI, which completes setup with an authenticated, CSRF-checked POST.
	// This landing route never exchanges codes or changes connection credentials.
	mux.HandleFunc("GET /github/callback", func(w http.ResponseWriter, r *http.Request) {
		query := url.Values{}
		for _, key := range []string{"code", "state", "installation_id", "setup_action"} {
			value := r.URL.Query().Get(key)
			if len(value) > 256 {
				failure(w, 400, "Invalid GitHub callback.")
				return
			}
			if value != "" {
				query.Set(key, value)
			}
		}
		query.Set("github_callback", "1")
		w.Header().Set("Cache-Control", "no-store")
		http.Redirect(w, r, "/?"+query.Encode()+"#connections/github", http.StatusSeeOther)
	})
	mux.HandleFunc("GET /api/github/connection", func(w http.ResponseWriter, r *http.Request) {
		view, err := connection.View(r.Context())
		if err != nil {
			githubError(w, err)
			return
		}
		jsonResponse(w, 200, view)
	})
	mux.HandleFunc("POST /api/github/connect", func(w http.ResponseWriter, r *http.Request) {
		start, err := connection.Start(r.Context(), token(r), a.origin)
		if err != nil {
			githubError(w, err)
			return
		}
		jsonResponse(w, 200, start)
	})
	mux.HandleFunc("POST /api/github/complete", func(w http.ResponseWriter, r *http.Request) {
		var in githubapp.Callback
		if !decode(w, r, &in) {
			return
		}
		if err := connection.Complete(r.Context(), token(r), in); err != nil {
			githubError(w, err)
			return
		}
		jsonResponse(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/github/installation", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			ID int64 `json:"id"`
		}
		if !decode(w, r, &in) {
			return
		}
		if in.ID <= 0 {
			failure(w, 400, "Choose a GitHub installation.")
			return
		}
		if err := connection.Select(r.Context(), in.ID); err != nil {
			githubError(w, err)
			return
		}
		jsonResponse(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/github/disconnect", func(w http.ResponseWriter, r *http.Request) {
		if err := connection.Disconnect(r.Context()); err != nil {
			githubError(w, err)
			return
		}
		jsonResponse(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/github/repositories", func(w http.ResponseWriter, r *http.Request) {
		page := 1
		if value := r.URL.Query().Get("page"); value != "" {
			page, _ = strconv.Atoi(value)
		}
		repositories, err := connection.Repositories(r.Context(), page)
		if err != nil {
			githubError(w, err)
			return
		}
		jsonResponse(w, 200, repositories)
	})
}
