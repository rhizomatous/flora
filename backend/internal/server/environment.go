package server

import (
	"errors"
	"net/http"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func (a *api) environmentRoutes(mux *http.ServeMux) {
	for _, method := range []string{"GET", "POST"} {
		mux.HandleFunc(method+" /api/projects/{id}/environment/effective", func(w http.ResponseWriter, r *http.Request) {
			if _, err := a.settings.Store.Project(r.Context(), r.PathValue("id")); err != nil {
				projectError(w, err)
				return
			}
			var changes []storage.EnvironmentChange
			if method == "POST" && !decodeLimit(w, r, &changes, 512<<10) {
				return
			}
			values, err := a.settings.Store.PreviewEnvironment(r.Context(), r.PathValue("id"), changes)
			if err != nil {
				chatError(w, err)
				return
			}
			jsonResponse(w, 200, values)
		})
	}

	for _, route := range []struct{ path, scope string }{{"/api/settings/environment", "installation"}, {"/api/projects/{id}/environment", "project"}, {"/api/chats/{id}/environment", "chat"}} {
		for _, method := range []string{"GET", "PATCH"} {
			if route.scope == "chat" && method == "PATCH" {
				continue
			}
			mux.HandleFunc(method+" "+route.path, func(w http.ResponseWriter, r *http.Request) {
				owner := r.PathValue("id")
				if route.scope == "project" {
					if _, err := a.settings.Store.Project(r.Context(), owner); err != nil {
						projectError(w, err)
						return
					}
				}
				if route.scope == "chat" {
					if _, err := a.settings.Store.Chat(r.Context(), owner); err != nil {
						chatError(w, err)
						return
					}
				}
				if method == "PATCH" {
					var changes []storage.EnvironmentChange
					if !decodeLimit(w, r, &changes, 512<<10) {
						return
					}
					if err := a.settings.Store.SaveEnvironment(r.Context(), route.scope, owner, changes); err != nil {
						var validation *storage.EnvironmentError
						if errors.As(err, &validation) {
							failure(w, 400, validation.Message)
						} else {
							failure(w, 503, "Could not save environment variables.")
						}
						return
					}
				}
				values, err := a.settings.Store.Environment(r.Context(), route.scope, owner)
				if err != nil {
					failure(w, 503, "Could not load environment variables.")
					return
				}
				jsonResponse(w, 200, values)
			})
		}
	}
}
