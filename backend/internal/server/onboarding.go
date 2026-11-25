package server

import (
	"errors"
	"net/http"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func (a *api) onboardingRoutes(mux *http.ServeMux) {
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
