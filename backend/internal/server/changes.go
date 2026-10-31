package server

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rhizomatous/flora/backend/internal/changes"
)

func (a *api) changesRoutes(mux *http.ServeMux) {
	review := changes.New(a.settings.Store, nil)
	mux.HandleFunc("GET /api/chats/{id}/changes", func(w http.ResponseWriter, r *http.Request) {
		data, err := review.Read(r.Context(), r.PathValue("id"), true)
		if err != nil {
			chatError(w, err)
			return
		}
		jsonResponse(w, 200, data)
	})
	mux.HandleFunc("GET /api/chats/{id}/changes/{file}/diff", func(w http.ResponseWriter, r *http.Request) {
		data, err := review.Read(r.Context(), r.PathValue("id"), false)
		if err != nil {
			chatError(w, err)
			return
		}
		i, err := strconv.Atoi(r.PathValue("file"))
		if err != nil || data.Snapshot == nil || i < 0 || i >= len(data.Snapshot.Files) {
			failure(w, 404, "Saved diff not found.")
			return
		}
		if r.URL.Query().Get("snapshot") != data.Snapshot.ID {
			failure(w, 409, "Changes were refreshed. Reload the review before downloading.")
			return
		}
		f := data.Snapshot.Files[i]
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="changes.diff"`)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeContent(w, r, "changes.diff", time.Time{}, strings.NewReader(f.Diff))
	})
}
