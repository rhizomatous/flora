package server

import (
	"errors"
	"net/http"

	"github.com/rhizomatous/flora/backend/internal/projects"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func (a *api) onboardingRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/onboarding/project", func(w http.ResponseWriter, r *http.Request) {
		var in projects.Input
		if !decodeLimit(w, r, &in, projects.MaxInputBytes) {
			return
		}
		// A saved selection wins even when GitHub access changed after the save.
		list, err := a.projects.Store.Projects(r.Context())
		if err != nil {
			projectError(w, err)
			return
		}
		if len(list) == 0 {
			in, err = a.projects.Validate(r.Context(), in)
			if err != nil {
				projectError(w, err)
				return
			}
		} else {
			in.Name, in.Configuration = list[0].Name, list[0].Configuration
		}
		project, err := a.projects.Store.CreateOnboardingProject(r.Context(), in.Name, in.Configuration)
		if err != nil {
			projectError(w, err)
			return
		}
		jsonResponse(w, 200, project)
	})
	mux.HandleFunc("GET /api/onboarding", func(w http.ResponseWriter, r *http.Request) {
		state, err := a.auth.Store.Onboarding(r.Context())
		if err != nil {
			failure(w, 500, "Could not load setup progress.")
			return
		}
		jsonResponse(w, 200, state)
	})
	mux.HandleFunc("PUT /api/onboarding", func(w http.ResponseWriter, r *http.Request) {
		var state storage.Onboarding
		if !decode(w, r, &state) {
			return
		}
		if state.Step == "finish" {
			state.Step = "project"
		}
		if err := a.auth.Store.SaveOnboarding(r.Context(), state); err != nil {
			if errors.Is(err, storage.ErrOnboardingIncomplete) {
				failure(w, 400, "Connect a model, GitHub, and a project before opening Flora.")
			} else if errors.Is(err, storage.ErrInvalid) || errors.Is(err, storage.ErrNotFound) {
				failure(w, 400, "Choose a setup step and an existing project.")
			} else {
				failure(w, 500, "Could not save setup progress.")
			}
			return
		}
		state.Started = true
		jsonResponse(w, 200, state)
	})
}
