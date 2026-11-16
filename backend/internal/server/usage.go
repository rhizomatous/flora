package server

import (
	"net/http"
	"time"
)

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
		jsonResponse(w, 200, report)
	})
}
