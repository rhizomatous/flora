package server

import (
	"errors"
	"net/http"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func automationError(w http.ResponseWriter, err error) {
	if errors.Is(err, storage.ErrStale) {
		failure(w, 409, "This automation changed in another window. Reload this page before saving.")
		return
	}
	if errors.Is(err, storage.ErrNotFound) {
		failure(w, 404, "Automation or project was not found.")
		return
	}
	if errors.Is(err, storage.ErrInvalid) {
		failure(w, 400, "Provide a name, instructions within the message limit, a valid schedule and time zone, and a run destination.")
		return
	}
	chatError(w, err)
}
func (a *api) automationRoutes(mux *http.ServeMux) {
	store := a.settings.Store
	mux.HandleFunc("GET /api/automations", func(w http.ResponseWriter, r *http.Request) {
		list, err := store.Automations(r.Context())
		if err != nil {
			automationError(w, err)
			return
		}
		type entry struct {
			storage.Automation
			LatestRun *storage.AutomationRun `json:"latestRun,omitempty"`
		}
		entries := make([]entry, 0, len(list))
		for _, item := range list {
			runs, err := store.AutomationRuns(r.Context(), item.ID)
			if err != nil {
				automationError(w, err)
				return
			}
			row := entry{Automation: item}
			if len(runs) > 0 {
				row.LatestRun = &runs[0]
			}
			entries = append(entries, row)
		}
		jsonResponse(w, 200, entries)
	})
	mux.HandleFunc("GET /api/automations/{id}", func(w http.ResponseWriter, r *http.Request) {
		item, err := store.Automation(r.Context(), r.PathValue("id"))
		if err != nil {
			automationError(w, err)
			return
		}
		runs, err := store.AutomationRuns(r.Context(), item.ID)
		if err != nil {
			automationError(w, err)
			return
		}
		jsonResponse(w, 200, map[string]any{"automation": item, "runs": runs})
	})
	for _, route := range []string{"POST /api/automations", "PUT /api/automations/{id}"} {
		mux.HandleFunc(route, func(w http.ResponseWriter, r *http.Request) {
			var in storage.Automation
			if !decodeChat(w, r, &in) {
				return
			}
			in.ID = r.PathValue("id")
			in.ChatID = ""
			if in.Execution != nil {
				if a.chats == nil {
					failure(w, 503, "Chat runtime is not configured.")
					return
				}
				var chatIDs []string
				if in.ID != "" && in.Mode == "same" {
					existing, err := store.Automation(r.Context(), in.ID)
					if err != nil {
						automationError(w, err)
						return
					}
					if existing.Mode == "same" && existing.ChatID != "" {
						chatIDs = append(chatIDs, existing.ChatID)
					}
				}
				if err := a.chats.ValidateAutomationExecution(r.Context(), in.Execution, chatIDs...); err != nil {
					automationError(w, err)
					return
				}
			}
			saved, err := store.SaveAutomation(r.Context(), in, time.Now())
			if err != nil {
				automationError(w, err)
				return
			}
			jsonResponse(w, 200, saved)
		})
	}
	mux.HandleFunc("POST /api/automations/preview", func(w http.ResponseWriter, r *http.Request) {
		var in storage.AutomationConfig
		if !decodeChat(w, r, &in) {
			return
		}
		next, err := in.Next(time.Now())
		if err != nil {
			automationError(w, err)
			return
		}
		jsonResponse(w, 200, map[string]string{"nextRun": next.Format(time.RFC3339)})
	})
	mux.HandleFunc("POST /api/automations/{id}/run", func(w http.ResponseWriter, r *http.Request) {
		if a.chats == nil {
			failure(w, 503, "Chat runtime is not configured.")
			return
		}
		var in struct {
			RequestID string `json:"requestID"`
		}
		if !decodeChat(w, r, &in) {
			return
		}
		run, err := a.chats.StartAutomation(r.Context(), r.PathValue("id"), in.RequestID, time.Now(), false)
		if err != nil {
			automationError(w, err)
			return
		}
		if run.ChatID != "" && run.PublicChatID == "" {
			c, err := store.Chat(r.Context(), run.ChatID)
			if err != nil {
				automationError(w, err)
				return
			}
			run.PublicChatID = c.PublicID
		}
		jsonResponse(w, 202, run)
	})
}
