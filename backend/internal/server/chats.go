package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/rhizomatous/flora/backend/internal/agentfiles"
	"github.com/rhizomatous/flora/backend/internal/changes"
	"github.com/rhizomatous/flora/backend/internal/chat"
	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func chatError(w http.ResponseWriter, err error) {
	var capacity *provisioning.CapacityError
	var control *chat.ControlError
	var attachment *storage.AttachmentError
	switch {
	case errors.As(err, &capacity):
		failure(w, 409, capacity.Error())
	case errors.As(err, &attachment):
		failure(w, 400, attachment.Reason)
	case errors.As(err, &control):
		failure(w, http.StatusConflict, control.Reason)
	case errors.Is(err, storage.ErrNotFound):
		failure(w, 404, "Chat or project was not found.")
	case errors.Is(err, storage.ErrActive):
		failure(w, 409, "This chat has active work. Follow-ups are not queued.")
	case errors.Is(err, storage.ErrConflict):
		failure(w, 409, "This request identity was already used with different input.")
	case errors.Is(err, storage.ErrStale):
		failure(w, 409, "This chat or question has changed. Refresh the chat before continuing.")
	case errors.Is(err, storage.ErrInvalid):
		failure(w, 400, "Provide a request identity and nonempty UTF-8 message within the configured message limit in installation settings. Titles must be 1 to 200 bytes.")
	default:
		failure(w, 503, "Chat runtime or storage unavailable. Check runtime configuration, Docker and saved activity.")
	}
}

// Check raw UTF-8 before decoding: encoding/json replaces invalid byte sequences.
// JSON escaping can require six bytes per input byte, so the envelope limit is
// deliberately separate from the decoded message's configured byte limit.
func decodeChat(w http.ResponseWriter, r *http.Request, v any) bool {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 6*storage.MaxAllowedMessageBytes+4096))
	if err != nil || !utf8.Valid(raw) {
		failure(w, 400, "Invalid UTF-8 or oversized chat request.")
		return false
	}
	r.Body = io.NopCloser(bytes.NewReader(raw))
	return decodeLimit(w, r, v, 6*storage.MaxAllowedMessageBytes+4096)
}

type chatView struct {
	storage.Chat
	Pulls     changes.PullSummary `json:"pulls"`
	Subagents []subagentSummary   `json:"subagents"`
}

type subagentSummary struct {
	ID     string `json:"id"`
	Number int    `json:"number"`
	Title  string `json:"title"`
}

func (a *api) chatView(ctx context.Context, c storage.Chat) chatView {
	agents, _ := a.settings.Store.Subagents(ctx, c.ID)
	summaries := make([]subagentSummary, 0, len(agents))
	for _, agent := range agents {
		summaries = append(summaries, subagentSummary{ID: agent.ID, Number: agent.Number, Title: agent.Title})
	}
	return chatView{Chat: c, Pulls: changes.New(a.settings.Store, nil).ReadPulls(ctx, c.ID), Subagents: summaries}
}

func (a *api) chatViews(ctx context.Context, chats []storage.Chat) []chatView {
	result := make([]chatView, 0, len(chats))
	for _, c := range chats {
		result = append(result, a.chatView(ctx, c))
	}
	return result
}

func (a *api) chatRoutes(mux *http.ServeMux) {
	store := a.settings.Store
	a.folderRoutes(mux)
	mux.HandleFunc("POST /api/chats/read", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Observed []storage.ViewedRevision `json:"observed"`
		}
		if !decodeLimit(w, r, &in, 256*1024) {
			return
		}
		saved, err := store.MarkChatsRead(r.Context(), in.Observed)
		if errors.Is(err, storage.ErrInvalid) {
			failure(w, 400, "Provide up to 1000 observed chat revisions.")
			return
		}
		if err != nil {
			chatError(w, err)
			return
		}
		jsonResponse(w, 200, saved)
	})
	mux.HandleFunc("GET /api/models", func(w http.ResponseWriter, r *http.Request) {
		if a.chats == nil {
			failure(w, 503, "Chat runtime is not configured.")
			return
		}
		id := r.URL.Query().Get("chat")
		if id != "" {
			if _, err := store.Chat(r.Context(), id); err != nil {
				chatError(w, err)
				return
			}
		}
		jsonResponse(w, 200, a.chats.Models(r.Context(), id))
	})
	mux.HandleFunc("PATCH /api/chats/{id}", func(w http.ResponseWriter, r *http.Request) {
		var in storage.ChatOrganization
		if !decodeChat(w, r, &in) {
			return
		}
		c, err := store.OrganizeChat(r.Context(), r.PathValue("id"), in)
		if err != nil {
			chatError(w, err)
			return
		}
		jsonResponse(w, 200, a.chatView(r.Context(), c))
	})
	mux.HandleFunc("GET /api/notifications", func(w http.ResponseWriter, r *http.Request) {
		var after *int64
		if r.URL.Query().Has("after") {
			cursor, err := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
			if err != nil || cursor < 0 {
				failure(w, 400, "Invalid notification cursor.")
				return
			}
			after = &cursor
		}
		events, cursor, err := store.Completions(r.Context(), after)
		if err != nil {
			chatError(w, err)
			return
		}
		chats, err := store.Chats(r.Context())
		if err != nil {
			chatError(w, err)
			return
		}
		jsonResponse(w, 200, map[string]any{"chats": a.chatViews(r.Context(), chats), "completions": events, "cursor": cursor})
	})
	mux.HandleFunc("GET /api/chats/{id}/runtime", func(w http.ResponseWriter, r *http.Request) {
		if a.chats == nil {
			failure(w, 503, "Chat runtime is not configured.")
			return
		}
		state, err := a.chats.Runtime(r.Context(), r.PathValue("id"))
		if err != nil {
			chatError(w, err)
			return
		}
		jsonResponse(w, 200, state)
	})
	mux.HandleFunc("POST /api/chats/{id}/keep-awake", func(w http.ResponseWriter, r *http.Request) {
		if a.chats == nil {
			failure(w, 503, "Chat runtime is not configured.")
			return
		}
		var body struct {
			Seconds *int `json:"seconds"`
		}
		if !decodeLimit(w, r, &body, 1024) {
			return
		}
		if body.Seconds == nil || (*body.Seconds != 0 && *body.Seconds != 1800 && *body.Seconds != 3600 && *body.Seconds != 14400) {
			failure(w, 400, "Choose a keep-awake duration.")
			return
		}
		if err := a.chats.KeepAwake(r.Context(), r.PathValue("id"), *body.Seconds); err != nil {
			chatError(w, err)
			return
		}
		jsonResponse(w, 200, map[string]bool{"ok": true})
	})
	for _, action := range []string{"interrupt", "stop", "wake"} {
		mux.HandleFunc("POST /api/chats/{id}/"+action, func(w http.ResponseWriter, r *http.Request) {
			if a.chats == nil {
				failure(w, 503, "Chat runtime is not configured.")
				return
			}
			var err error
			if action == "wake" {
				err = a.chats.Wake(r.Context(), r.PathValue("id"))
			} else if action == "stop" {
				err = a.chats.Stop(r.Context(), r.PathValue("id"))
			} else {
				err = a.chats.Interrupt(r.Context(), r.PathValue("id"))
			}
			if err != nil {
				chatError(w, err)
				return
			}
			c, err := store.Chat(r.Context(), r.PathValue("id"))
			if err != nil {
				chatError(w, err)
				return
			}
			jsonResponse(w, 200, c)
		})
	}
	mux.HandleFunc("GET /api/chats/{id}/setup-log", func(w http.ResponseWriter, r *http.Request) {
		paths, err := store.Paths(r.Context(), r.PathValue("id"))
		if err != nil {
			chatError(w, err)
			return
		}
		root, err := os.OpenRoot(paths.Logs)
		if err != nil {
			chatError(w, err)
			return
		}
		defer root.Close()
		file, err := agentfiles.Open(root, "setup.log")
		if err != nil {
			failure(w, 404, "Full setup log is not available yet. Check the final setup activity for capture errors.")
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			chatError(w, err)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="setup.log"`)
		w.Header().Set("Cache-Control", "no-store")
		http.ServeContent(w, r, "setup.log", info.ModTime(), file)
	})
	mux.HandleFunc("GET /api/chats", func(w http.ResponseWriter, r *http.Request) {
		list, err := store.Chats(r.Context())
		if err != nil {
			chatError(w, err)
			return
		}
		jsonResponse(w, 200, a.chatViews(r.Context(), list))
	})
	mux.HandleFunc("POST /api/projects/{id}/chats", func(w http.ResponseWriter, r *http.Request) {
		if a.chats == nil {
			failure(w, 503, "Chat runtime is not configured. Configure the pinned agent image and private GitHub transport.")
			return
		}
		var in struct {
			Branches    map[string]string  `json:"branches"`
			Execution   *storage.Execution `json:"execution"`
			Title       string             `json:"title"`
			RequestID   string             `json:"requestID"`
			Text        string             `json:"text"`
			Attachments []string           `json:"attachments"`
		}
		if !decodeChat(w, r, &in) {
			return
		}
		// Reserved requests use their frozen configuration even if the branch is
		// later deleted or GitHub is unavailable.
		if in.Branches != nil {
			if _, err := store.ChatRequest(r.Context(), r.PathValue("id"), in.RequestID); errors.Is(err, storage.ErrNotFound) {
				if err := a.projects.ValidateBranches(r.Context(), r.PathValue("id"), in.Branches); err != nil {
					projectError(w, err)
					return
				}
			} else if err != nil {
				chatError(w, err)
				return
			}
		}
		c, err := a.chats.CreateWithBranches(r.Context(), r.PathValue("id"), in.Title, in.RequestID, in.Text, in.Execution, in.Branches, in.Attachments...)
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
		blocked := ""
		if a.chats != nil {
			blocked = a.chats.ContinuationBlock(r.Context(), c)
		}
		if blocked != "" {
			c.Status, c.StatusReason = storage.Failed, blocked
		}
		usage, err := store.ChatUsage(r.Context(), c.ID)
		if err != nil {
			chatError(w, err)
			return
		}
		contextUsage, err := store.ChatContext(r.Context(), c.ID)
		if err != nil {
			chatError(w, err)
			return
		}
		runs, err := store.ChatAutomationRuns(r.Context(), c.ID)
		if err != nil {
			chatError(w, err)
			return
		}
		subagents, err := store.Subagents(r.Context(), c.ID)
		if err != nil {
			chatError(w, err)
			return
		}
		jsonResponse(w, 200, map[string]any{"chat": a.chatView(r.Context(), c), "messages": messages, "subagents": subagents, "automationRuns": runs, "continuationBlockedReason": blocked, "usage": usage, "contextUsage": contextUsage})
	})
	mux.HandleFunc("GET /api/chats/{id}/subagents/{session}", func(w http.ResponseWriter, r *http.Request) {
		messages, err := store.SubagentMessages(r.Context(), r.PathValue("id"), r.PathValue("session"))
		if err != nil {
			chatError(w, err)
			return
		}
		jsonResponse(w, 200, map[string]any{"messages": messages})
	})
	mux.HandleFunc("POST /api/chats/{id}/messages", func(w http.ResponseWriter, r *http.Request) {
		if a.chats == nil {
			failure(w, 503, "Chat runtime is not configured.")
			return
		}
		var in struct {
			Execution   *storage.Execution `json:"execution"`
			RequestID   string             `json:"requestID"`
			Text        string             `json:"text"`
			Attachments []string           `json:"attachments"`
		}
		if !decodeChat(w, r, &in) {
			return
		}
		accepted, err := a.chats.SubmitWithExecution(r.Context(), r.PathValue("id"), in.RequestID, in.Text, in.Execution, in.Attachments...)
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
