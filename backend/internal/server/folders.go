package server

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"unicode/utf8"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func decodeFolder(w http.ResponseWriter, r *http.Request, in any) bool {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4096))
	if err != nil || !utf8.Valid(raw) {
		failure(w, 400, "Invalid UTF-8 or oversized folder request.")
		return false
	}
	r.Body = io.NopCloser(bytes.NewReader(raw))
	return decodeLimit(w, r, in, 4096)
}

func folderError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storage.ErrFolderName):
		failure(w, 409, "A folder with this name already exists. Choose another name.")
	case errors.Is(err, storage.ErrStale):
		failure(w, 409, "This folder changed elsewhere. Review it and try again.")
	case errors.Is(err, storage.ErrNotFound):
		failure(w, 404, "This folder no longer exists.")
	case errors.Is(err, storage.ErrInvalid):
		failure(w, 400, "Enter a folder name of 1 to 200 bytes on one line.")
	default:
		chatError(w, err)
	}
}

func (a *api) folderRoutes(mux *http.ServeMux) {
	store := a.settings.Store
	mux.HandleFunc("GET /api/folders", func(w http.ResponseWriter, r *http.Request) {
		rows, err := store.Folders(r.Context())
		if err != nil {
			folderError(w, err)
			return
		}
		jsonResponse(w, 200, rows)
	})
	for _, pattern := range []string{"POST /api/folders", "PATCH /api/folders/{id}"} {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Name     string `json:"name"`
				Revision *int64 `json:"revision"`
			}
			if !decodeFolder(w, r, &in) {
				return
			}
			f := storage.ChatFolder{ID: r.PathValue("id"), Name: in.Name}
			if f.ID != "" {
				if in.Revision == nil {
					folderError(w, storage.ErrInvalid)
					return
				}
				f.Revision = *in.Revision
			}
			saved, err := store.SaveFolder(r.Context(), f)
			if err != nil {
				folderError(w, err)
				return
			}
			jsonResponse(w, 200, saved)
		})
	}
	mux.HandleFunc("DELETE /api/folders/{id}", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Revision *int64 `json:"revision"`
		}
		if !decodeLimit(w, r, &in, 1024) {
			return
		}
		if in.Revision == nil || *in.Revision < 0 {
			folderError(w, storage.ErrInvalid)
			return
		}
		chats, err := store.RemoveFolder(r.Context(), r.PathValue("id"), *in.Revision)
		if err != nil {
			folderError(w, err)
			return
		}
		jsonResponse(w, 200, a.chatViews(r.Context(), chats))
	})
}
