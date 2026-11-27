package server

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/rhizomatous/flora/backend/internal/projects"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func (a *api) onboardingRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/onboarding/readiness", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Finish bool `json:"finish"`
		}
		if !decode(w, r, &in) {
			return
		}
		state, err := a.auth.Store.Onboarding(r.Context())
		if err != nil {
			failure(w, 500, "Could not load setup progress.")
			return
		}
		result := a.checkReadiness(r.Context(), state.ProjectID)
		// Re-read selection because another tab can change it during diagnostics.
		latest, err := a.auth.Store.Onboarding(r.Context())
		if err != nil || latest.ProjectID != state.ProjectID {
			result.Ready = false
			result.Checks = append(result.Checks, settings.ReadinessCheck{ID: "selection", Name: "Project selection", Message: "Project selection changed. Choose your project and retry.", FixPath: "onboarding/project", FixLabel: "Choose project"})
		}
		if in.Finish && result.Ready {
			state.Step, state.Completed = "finish", true
			if err := a.auth.Store.SaveOnboarding(r.Context(), state); err != nil {
				failure(w, 500, "Could not finish setup. Retry checks.")
				return
			}
			state.Started = true
		}
		jsonResponse(w, 200, struct {
			Readiness  settings.Readiness `json:"readiness"`
			Onboarding storage.Onboarding `json:"onboarding"`
		}{result, state})
	})
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
		if state.Completed {
			failure(w, 400, "Run setup readiness checks before opening Flora.")
			return
		}
		if err := a.auth.Store.SaveOnboarding(r.Context(), state); err != nil {
			if errors.Is(err, storage.ErrInvalid) || errors.Is(err, storage.ErrNotFound) {
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

func (a *api) checkReadiness(ctx context.Context, projectID string) settings.Readiness {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	return a.settings.CheckReadiness(ctx, projectID, a.chats != nil)
}
