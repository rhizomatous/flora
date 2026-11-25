package server

import (
	"net/http"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type usageChat struct {
	storage.UsageGroup
	PublicChatID string `json:"publicChatID"`
}

func (a *api) usageRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/usage", func(w http.ResponseWriter, r *http.Request) {
		from, fromErr := time.Parse(time.RFC3339, r.URL.Query().Get("from"))
		to, toErr := time.Parse(time.RFC3339, r.URL.Query().Get("to"))
		if fromErr != nil || toErr != nil || !from.Before(to) || to.Sub(from) > 366*24*time.Hour {
			failure(w, 400, "Choose a date range of up to 366 days.")
			return
		}
		report, err := a.settings.Store.UsageReport(r.Context(), from, to)
		if err != nil {
			failure(w, 503, "Could not load usage. Try again.")
			return
		}
		chats := make([]usageChat, 0, len(report.Chats))
		for _, group := range report.Chats {
			chat, err := a.settings.Store.Chat(r.Context(), group.ID)
			if err != nil {
				failure(w, 503, "Could not load usage. Try again.")
				return
			}
			chats = append(chats, usageChat{UsageGroup: group, PublicChatID: chat.PublicID})
		}
		jsonResponse(w, 200, struct {
			storage.UsageReport
			Chats []usageChat `json:"chats"`
		}{UsageReport: report, Chats: chats})
	})
}
