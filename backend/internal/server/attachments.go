package server

import (
	"bytes"
	"io"
	"mime"
	"net/http"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func (a *api) attachmentRoutes(mux *http.ServeMux) {
	store := a.settings.Store
	mux.HandleFunc("GET /api/attachments/policy", func(w http.ResponseWriter, r *http.Request) {
		if a.chats == nil {
			failure(w, 503, "Chat runtime is not configured.")
			return
		}
		id := r.URL.Query().Get("chat")
		if id != "" {
			if _, err := a.settings.Store.Chat(r.Context(), id); err != nil {
				chatError(w, err)
				return
			}
		}
		jsonResponse(w, 200, a.chats.AttachmentCapabilities(r.Context(), id))
	})
	mux.HandleFunc("PUT /api/projects/{project}/attachments/{attachment}", func(w http.ResponseWriter, r *http.Request) {
		// A raw body avoids multipart temporary files and bounds memory before parsing.
		data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, storage.MaxAttachmentBytes))
		if err != nil {
			failure(w, 413, "Files must be at most 5 MiB each.")
			return
		}
		file, err := store.PutAttachment(r.Context(), r.PathValue("project"), r.PathValue("attachment"), r.URL.Query().Get("name"), data)
		if err != nil {
			chatError(w, err)
			return
		}
		jsonResponse(w, 200, file)
	})
	mux.HandleFunc("GET /api/attachments/{attachment}", func(w http.ResponseWriter, r *http.Request) {
		file, _, err := store.Attachment(r.Context(), r.PathValue("attachment"))
		if err != nil {
			chatError(w, err)
			return
		}
		jsonResponse(w, 200, file)
	})
	mux.HandleFunc("DELETE /api/attachments/{attachment}", func(w http.ResponseWriter, r *http.Request) {
		if err := store.RemoveAttachment(r.Context(), r.PathValue("attachment")); err != nil {
			chatError(w, err)
			return
		}
		jsonResponse(w, 200, map[string]bool{"removed": true})
	})
	mux.HandleFunc("GET /api/attachments/{attachment}/content", func(w http.ResponseWriter, r *http.Request) {
		file, data, err := store.Attachment(r.Context(), r.PathValue("attachment"))
		if err != nil {
			chatError(w, err)
			return
		}
		w.Header().Set("Content-Type", file.MIME)
		disposition := "attachment"
		if file.MIME == "image/png" || file.MIME == "image/jpeg" || file.MIME == "image/gif" {
			disposition = "inline"
		}
		w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": file.Name}))
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
		w.Header().Set("Cache-Control", "no-store")
		created, _ := time.Parse(time.RFC3339Nano, file.CreatedAt)
		http.ServeContent(w, r, file.Name, created, bytes.NewReader(data))
	})
}
