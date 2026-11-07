package server

import (
	"errors"
	"net/http"

	"github.com/rhizomatous/flora/backend/internal/projects"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func projectError(w http.ResponseWriter, err error) {
	var validation *projects.ValidationError
	switch {
	case errors.As(err, &validation):
		failure(w, 400, validation.Message)
	case errors.Is(err, storage.ErrNotFound):
		failure(w, 404, "Project was not found.")
	default:
		failure(w, 500, "Project storage unavailable. Check storage permissions and free space.")
	}
}

func (a *api) projectRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/projects", func(w http.ResponseWriter, r *http.Request) {
		list, err := a.projects.Store.Projects(r.Context())
		if err != nil {
			projectError(w, err)
			return
		}
		jsonResponse(w, 200, list)
	})
	mux.HandleFunc("GET /api/projects/{id}", func(w http.ResponseWriter, r *http.Request) {
		p, err := a.projects.Store.Project(r.Context(), r.PathValue("id"))
		if err != nil {
			projectError(w, err)
			return
		}
		jsonResponse(w, 200, p)
	})
	for _, method := range []string{"POST", "PUT"} {
		pattern := method + " /api/projects"
		if method == "PUT" {
			pattern += "/{id}"
		}
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			if method == "PUT" {
				if _, err := a.projects.Store.Project(r.Context(), r.PathValue("id")); err != nil {
					projectError(w, err)
					return
				}
			}
			var in projects.Input
			if !decodeLimit(w, r, &in, projects.MaxInputBytes) {
				return
			}
			in, err := a.projects.Validate(r.Context(), in)
			if err != nil {
				projectError(w, err)
				return
			}
			if method == "POST" {
				p, err := a.projects.Store.CreateProject(r.Context(), in.Name, in.Configuration)
				if err != nil {
					projectError(w, err)
					return
				}
				w.Header().Set("Location", "/api/projects/"+p.ID)
				jsonResponse(w, 201, p)
			} else {
				if err := a.projects.Store.UpdateProject(r.Context(), r.PathValue("id"), in.Name, in.Configuration); err != nil {
					projectError(w, err)
					return
				}
				p, err := a.projects.Store.Project(r.Context(), r.PathValue("id"))
				if err != nil {
					projectError(w, err)
					return
				}
				jsonResponse(w, 200, p)
			}
		})
	}
}
