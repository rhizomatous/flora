package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func chatError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storage.ErrNotFound):
		failure(w, 404, "Chat or project was not found.")
	case errors.Is(err, storage.ErrActive):
		failure(w, 409, "This chat has active work. Follow-ups are not queued.")
	case errors.Is(err, storage.ErrConflict):
		failure(w, 409, "This request identity was already used with different input.")
	case errors.Is(err, storage.ErrStale):
		failure(w, 409, "This runtime question is no longer pending. Refresh the chat.")
	case errors.Is(err, storage.ErrInvalid):
		failure(w, 400, "Provide a request identity and nonempty message of at most 128 KiB UTF-8. Titles must be 1 to 200 bytes.")
	default:
		failure(w, 503, "Chat runtime or storage unavailable. Check runtime configuration, Docker and saved activity.")
	}
}

// Check raw UTF-8 before decoding: encoding/json replaces invalid byte sequences.
// JSON escaping can require six bytes per input byte, so the envelope limit is
// deliberately separate from the decoded message's 128 KiB byte limit.
func decodeChat(w http.ResponseWriter, r *http.Request, v any) bool {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 6*storage.MaxMessageBytes+4096))
	if err != nil || !utf8.Valid(raw) {
		failure(w, 400, "Invalid UTF-8 or oversized chat request.")
		return false
	}
	r.Body = io.NopCloser(bytes.NewReader(raw))
	return decodeLimit(w, r, v, 6*storage.MaxMessageBytes+4096)
}

func (a *api) chatRoutes(mux *http.ServeMux) {
	store := a.settings.Store
	mux.HandleFunc("GET /api/chats", func(w http.ResponseWriter, r *http.Request) {
		list, err := store.Chats(r.Context())
		if err != nil {
			chatError(w, err)
			return
		}
		jsonResponse(w, 200, list)
	})
	mux.HandleFunc("POST /api/projects/{id}/chats", func(w http.ResponseWriter, r *http.Request) {
		if a.chats == nil {
			failure(w, 503, "Chat runtime is not configured. Configure the pinned agent image and private GitHub transport.")
			return
		}
		var in struct {
			Title     string `json:"title"`
			RequestID string `json:"requestID"`
			Text      string `json:"text"`
		}
		if !decodeChat(w, r, &in) {
			return
		}
		c, err := a.chats.Create(r.Context(), r.PathValue("id"), in.Title, in.RequestID, in.Text)
		if err != nil {
			chatError(w, err)
			return
		}
		w.Header().Set("Location", "/api/chats/"+c.ID)
		jsonResponse(w, 202, c)
	})
	mux.HandleFunc("GET /api/chats/{id}", func(w http.ResponseWriter, r *http.Request) {
		c, err := store.Chat(r.Context(), r.PathValue("id"))
		if err != nil {
			chatError(w, err)
			return
		}
		messages, err := store.Messages(r.Context(), c.ID)
		if err != nil {
			chatError(w, err)
			return
		}
		jsonResponse(w, 200, map[string]any{"chat": c, "messages": messages})
	})
	mux.HandleFunc("POST /api/chats/{id}/messages", func(w http.ResponseWriter, r *http.Request) {
		if a.chats == nil {
			failure(w, 503, "Chat runtime is not configured.")
			return
		}
		var in struct {
			RequestID string `json:"requestID"`
			Text      string `json:"text"`
		}
		if !decodeChat(w, r, &in) {
			return
		}
		accepted, err := a.chats.Submit(r.Context(), r.PathValue("id"), in.RequestID, in.Text)
		if err != nil {
			chatError(w, err)
			return
		}
		jsonResponse(w, 202, accepted)
	})
	mux.HandleFunc("GET /api/chats/{id}/questions", func(w http.ResponseWriter, r *http.Request) {
		if a.chats == nil {
			failure(w, 503, "Chat runtime is not configured.")
			return
		}
		list, err := a.chats.Questions(r.Context(), r.PathValue("id"))
		if err != nil {
			chatError(w, err)
			return
		}
		jsonResponse(w, 200, list)
	})
	mux.HandleFunc("POST /api/chats/{id}/questions/{question}/reply", func(w http.ResponseWriter, r *http.Request) {
		if a.chats == nil {
			failure(w, 503, "Chat runtime is not configured.")
			return
		}
		var in struct {
			Answers [][]string `json:"answers"`
		}
		if !decodeChat(w, r, &in) {
			return
		}
		if err := a.chats.Reply(r.Context(), r.PathValue("id"), r.PathValue("question"), in.Answers); err != nil {
			chatError(w, err)
			return
		}
		jsonResponse(w, 200, map[string]bool{"answered": true})
	})
	mux.HandleFunc("GET /api/chats/{id}/events", a.events)
}

// Each connection reads committed rows in sequence, including its live tail.
// A single cursor avoids a replay/subscription race and bounds server buffering.
func (a *api) events(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	chatID := r.PathValue("id")
	if _, err := a.settings.Store.Chat(r.Context(), chatID); err != nil {
		chatError(w, err)
		return
	}
	cursor := r.Header.Get("Last-Event-ID")
	if cursor == "" {
		cursor = r.URL.Query().Get("after")
	}
	var after int64
	if cursor != "" {
		var err error
		after, err = strconv.ParseInt(cursor, 10, 64)
		if err != nil || after < 0 {
			failure(w, 400, "Invalid event cursor.")
			return
		}
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	rc := http.NewResponseController(w)
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	heartbeat := time.NewTicker(10 * time.Second)
	defer heartbeat.Stop()
	for {
		// Sessions are revocable even while a stream is open.
		valid, err := a.auth.Valid(r.Context(), token(r))
		if err != nil || !valid {
			return
		}
		rows, err := a.settings.Store.Activities(r.Context(), chatID, after, 100)
		if err != nil {
			return
		}
		_ = rc.SetWriteDeadline(time.Now().Add(10 * time.Second))
		for _, row := range rows {
			b, _ := json.Marshal(row)
			if _, err := fmt.Fprintf(w, "id: %d\nevent: activity\ndata: %s\n\n", row.Sequence, b); err != nil {
				return
			}
			after = row.Sequence
		}
		if err := rc.Flush(); err != nil {
			return
		}
		if len(rows) == 100 {
			continue
		}
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		case <-heartbeat.C:
			if _, err := io.WriteString(w, ": keep-alive\n\n"); err != nil {
				return
			}
		}
	}
}
