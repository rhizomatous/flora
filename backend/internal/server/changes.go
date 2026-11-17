package server

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/rhizomatous/flora/backend/internal/changes"
)

func (a *api) changesRoutes(mux *http.ServeMux) {
	review := changes.New(a.settings.Store, nil)
	mux.HandleFunc("GET /api/chats/{id}/pull-comparison", func(w http.ResponseWriter, r *http.Request) {
		number, _ := strconv.Atoi(r.URL.Query().Get("number"))
		data, err := review.PullComparison(r.Context(), r.PathValue("id"), r.URL.Query().Get("repository"), number, false, true, &http.Client{Timeout: 20 * time.Second})
		if err != nil {
			pullComparisonError(w, err)
			return
		}
		jsonResponse(w, 200, data)
	})
	mux.HandleFunc("POST /api/chats/{id}/pull-comparison", func(w http.ResponseWriter, r *http.Request) {
		number, _ := strconv.Atoi(r.URL.Query().Get("number"))
		data, err := review.PullComparison(r.Context(), r.PathValue("id"), r.URL.Query().Get("repository"), number, true, true, &http.Client{Timeout: 20 * time.Second})
		if err != nil {
			pullComparisonError(w, err)
			return
		}
		jsonResponse(w, 200, data)
	})
	mux.HandleFunc("GET /api/chats/{id}/pull-comparison/{file}/diff", func(w http.ResponseWriter, r *http.Request) {
		number, _ := strconv.Atoi(r.URL.Query().Get("number"))
		data, err := review.PullComparison(r.Context(), r.PathValue("id"), r.URL.Query().Get("repository"), number, false, false, &http.Client{})
		if err != nil {
			pullComparisonError(w, err)
			return
		}
		i, err := strconv.Atoi(r.PathValue("file"))
		if err != nil || data.Snapshot == nil || i < 0 || i >= len(data.Snapshot.Files) {
			failure(w, 404, "Saved diff not found.")
			return
		}
		if r.URL.Query().Get("snapshot") != data.Snapshot.ID {
			failure(w, 409, "Comparison refreshed. Reload before downloading.")
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="pull-%d.diff"`, number))
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeContent(w, r, "comparison.diff", time.Time{}, strings.NewReader(data.Snapshot.Files[i].Diff))
	})

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

func pullComparisonError(w http.ResponseWriter, err error) {
	if errors.Is(err, os.ErrNotExist) {
		failure(w, 404, "Verified linked pull request was not found.")
		return
	}
	chatError(w, err)
}
