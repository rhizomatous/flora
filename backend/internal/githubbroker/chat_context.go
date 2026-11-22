package githubbroker

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/rhizomatous/flora/backend/internal/redaction"
)

// readChat uses the agent's existing revocable credential. Authorization comes from
// accepted user references in its own conversation; no browser credential enters the container.
func (b *Broker) readChat(w http.ResponseWriter, r *http.Request, reader, credential string) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	target := strings.TrimPrefix(r.URL.Path, "/api/v3/flora/chats/")
	if target == "" || strings.ContainsAny(target, "/\\\x00") {
		http.NotFound(w, r)
		return
	}
	before := int64(0)
	if raw := r.URL.Query().Get("before"); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 1 {
			http.Error(w, "Invalid message cursor", 400)
			return
		}
		before = n
	}
	page, err := b.store.ReadReferencedChat(r.Context(), reader, target, before)
	if err != nil {
		http.Error(w, "Chat is missing or was not referenced in this conversation", 404)
		return
	}
	secrets := redaction.Values(r.Context(), b.store, reader, credential)
	secrets = append(secrets, redaction.Values(r.Context(), b.store, target)...)
	raw, err := json.Marshal(page)
	if err != nil {
		http.Error(w, "Could not read chat", 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(redaction.JSON(raw, secrets...))
}
