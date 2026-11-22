package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"io/fs"
	"regexp"
	"slices"
	"strings"
)

const MaxReferences = 5

// ContextReference identifies a source. Its contents are read by the agent when needed.
type ContextReference struct {
	Kind       string `json:"kind"`
	Label      string `json:"label"`
	Repository string `json:"repository,omitempty"`
	Path       string `json:"path,omitempty"`
	ChatID     string `json:"chatID,omitempty"`
	Number     int    `json:"number,omitempty"`
	Status     string `json:"status,omitempty"`
}

var contextChatID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func ContextPathAllowed(name string) bool {
	if !fs.ValidPath(name) || name == "." || strings.ContainsAny(name, "\\\x00") {
		return false
	}
	for _, part := range strings.Split(strings.ToLower(name), "/") {
		if strings.HasPrefix(part, ".env") || strings.Contains(part, "credential") || strings.Contains(part, "secret") || slices.Contains([]string{".git", ".ssh", ".aws", ".docker", ".kube", ".gnupg", "auth.json", ".config", ".netrc", ".npmrc", ".pypirc"}, part) || strings.HasSuffix(part, ".pem") || strings.HasSuffix(part, ".key") || strings.HasPrefix(part, "id_rsa") || strings.HasPrefix(part, "id_ed25519") {
			return false
		}
	}
	return true
}

func References(raw json.RawMessage) []ContextReference {
	var payload struct {
		References []ContextReference `json:"references"`
	}
	_ = json.Unmarshal(raw, &payload)
	return payload.References
}
func ReferencesJSON(refs []ContextReference) string {
	raw, _ := json.Marshal(append([]ContextReference{}, refs...))
	return string(raw)
}

// validateReferences checks identifiers against the destination's saved repository configuration.
// It saves no source content and grants access only to chats explicitly named in the message.
func validateReferences(ctx context.Context, tx *sql.Tx, config Configuration, chat string, refs []ContextReference) error {
	if len(refs) > MaxReferences {
		return &AttachmentError{Reason: "Use at most 5 context references."}
	}
	for i, ref := range refs {
		if len(ref.Label) == 0 || len(ref.Label) > 500 || len(ref.Path) > 2048 || slices.Contains(refs[:i], ref) {
			return ErrInvalid
		}
		switch ref.Kind {
		case "file", "pr":
			known := false
			for _, repo := range config.Repositories {
				if repo.Name == ref.Repository {
					known = true
				}
			}
			if !known || ref.ChatID != "" {
				return ErrInvalid
			}
			if ref.Kind == "file" && (chat == "" || !ContextPathAllowed(ref.Path) || ref.Number != 0) {
				return &AttachmentError{Reason: "Select an available workspace file. Credential paths cannot be referenced."}
			}
			if ref.Kind == "pr" && (ref.Number < 1 || ref.Path != "" || !slices.Contains([]string{"", "open", "draft", "closed", "merged", "unknown"}, ref.Status)) {
				return ErrInvalid
			}
		case "chat":
			if !contextChatID.MatchString(ref.ChatID) || ref.ChatID == chat || ref.Repository != "" || ref.Path != "" || ref.Number != 0 {
				return ErrInvalid
			}
			var exists int
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM chats WHERE id=?", ref.ChatID).Scan(&exists); err != nil {
				return err
			}
			if exists == 0 {
				return &AttachmentError{Reason: "The referenced chat is missing. Remove it or choose another chat."}
			}
		default:
			return ErrInvalid
		}
	}
	return nil
}

type ContextMessage struct {
	Sequence  int64  `json:"sequence"`
	Role      string `json:"role"`
	Text      string `json:"text"`
	CreatedAt string `json:"createdAt"`
	Truncated bool   `json:"truncated,omitempty"`
}
type ChatContextPage struct {
	Messages []ContextMessage `json:"messages"`
	Before   int64            `json:"before,omitempty"`
}

// ReadReferencedChat reads current user and assistant text, excluding tool payloads and configuration.
// A chat's agent can read only chats named by accepted user references in that conversation.
// Pages run newest first; before retrieves older messages. A single long message is marked truncated.
func (s *Store) ReadReferencedChat(ctx context.Context, reader, target string, before int64) (ChatContextPage, error) {
	page := ChatContextPage{Messages: []ContextMessage{}}
	var allowed int
	err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM messages,json_each(messages.payload,'$.references') WHERE chat_id=? AND role='user' AND json_extract(value,'$.kind')='chat' AND json_extract(value,'$.chatID')=? AND EXISTS(SELECT 1 FROM chats WHERE id=?)`, reader, target, target).Scan(&allowed)
	if err != nil {
		return page, err
	}
	if allowed == 0 {
		return page, ErrNotFound
	}
	rows, err := s.db.QueryContext(ctx, `SELECT sequence,role,substr(text,1,32769),created_at FROM messages WHERE chat_id=? AND role IN ('user','assistant') AND (?=0 OR sequence<?) ORDER BY sequence DESC LIMIT 21`, target, before, before)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	remaining := 32 << 10
	for rows.Next() {
		var m ContextMessage
		if err := rows.Scan(&m.Sequence, &m.Role, &m.Text, &m.CreatedAt); err != nil {
			return page, err
		}
		if len(page.Messages) == 20 || (len(m.Text) > remaining && len(page.Messages) > 0) {
			page.Before = page.Messages[len(page.Messages)-1].Sequence
			break
		}
		if len(m.Text) > remaining {
			m.Text = strings.ToValidUTF8(m.Text[:remaining], "")
			m.Truncated = true
		}
		remaining -= len(m.Text)
		page.Messages = append(page.Messages, m)
	}
	return page, rows.Err()
}
