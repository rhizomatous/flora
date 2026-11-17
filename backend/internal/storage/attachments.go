package storage

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	stdimage "image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"path"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const MaxAttachmentBytes = 5 << 20
const MaxAttachmentTotal = 20 << 20
const MaxAttachments = 5
const AttachmentLifetime = 24 * time.Hour

type AttachmentError struct{ Reason string }

func (e *AttachmentError) Error() string  { return e.Reason }
func attachmentError(reason string) error { return &AttachmentError{reason} }

type Attachment struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectID"`
	Name      string `json:"name"`
	MIME      string `json:"mime"`
	Size      int    `json:"size"`
	CreatedAt string `json:"createdAt"`
}

// ValidateAttachment checks the bytes rather than trusting a browser MIME type.
// Names are display-only metadata. Content is stored in SQLite, never at a user path.
func ValidateAttachment(name string, data []byte) (string, error) {
	if name == "" || len(name) > 200 || !utf8.ValidString(name) || strings.ContainsAny(name, "/\\") || strings.IndexFunc(name, unicode.IsControl) >= 0 || name == "." || name == ".." {
		return "", attachmentError("Choose a file with a plain filename of at most 200 bytes.")
	}
	if len(data) == 0 || len(data) > MaxAttachmentBytes {
		return "", attachmentError("Files must be nonempty and at most 5 MiB each.")
	}
	ext := strings.ToLower(path.Ext(name))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif":
		cfg, format, err := stdimage.DecodeConfig(bytes.NewReader(data))
		expected := map[string]string{".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".gif": "gif"}[ext]
		if err != nil || format != expected || cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > 40_000_000 {
			return "", attachmentError("Choose a valid PNG, JPEG, or GIF image of at most 40 megapixels.")
		}
		return "image/" + format, nil
	case ".pdf":
		if !bytes.HasPrefix(data, []byte("%PDF-")) {
			return "", attachmentError("This file is not a PDF document.")
		}
		return "application/pdf", nil
	case ".txt", ".md", ".csv", ".json":
		if len(data) > 1<<20 || !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
			return "", attachmentError("Text documents must be UTF-8 without NUL bytes and at most 1 MiB.")
		}
		return "text/plain", nil
	}
	return "", attachmentError("Supported files: PNG, JPEG, GIF, PDF, TXT, Markdown, CSV, and JSON.")
}

// PutAttachment is idempotent for identical bytes, project and metadata. Drafts
// expire 24 hours after upload; accepted references are retained with the chat.
func (s *Store) PutAttachment(ctx context.Context, project, key, name string, data []byte) (Attachment, error) {
	if len(key) < 16 || len(key) > 100 || strings.IndexFunc(key, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '-' }) >= 0 {
		return Attachment{}, ErrInvalid
	}
	mime, err := ValidateAttachment(name, data)
	if err != nil {
		return Attachment{}, err
	}
	a := Attachment{key, project, name, mime, len(data), now()}
	err = s.write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, "DELETE FROM attachments WHERE message_id IS NULL AND created_at<?", time.Now().Add(-AttachmentLifetime).UTC().Format(time.RFC3339Nano)); err != nil {
			return err
		}
		var old Attachment
		var content []byte
		err := tx.QueryRowContext(ctx, "SELECT id,project_id,name,mime,size,created_at,content FROM attachments WHERE id=?", key).Scan(&old.ID, &old.ProjectID, &old.Name, &old.MIME, &old.Size, &old.CreatedAt, &content)
		if err == nil {
			if old.ProjectID != project || old.Name != name || !bytes.Equal(content, data) {
				return ErrConflict
			}
			a = old
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		var exists int
		if err := tx.QueryRowContext(ctx, "SELECT 1 FROM projects WHERE id=?", project).Scan(&exists); err != nil {
			return found(err)
		}
		var total int
		if err := tx.QueryRowContext(ctx, "SELECT coalesce(sum(size),0) FROM attachments WHERE message_id IS NULL").Scan(&total); err != nil {
			return err
		}
		if total+len(data) > 100<<20 {
			return attachmentError("Draft uploads have reached 100 MiB. Remove unused attachments or wait for their 24-hour expiry.")
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO attachments(id,project_id,name,mime,size,content,created_at) VALUES(?,?,?,?,?,?,?)", key, project, name, mime, len(data), data, a.CreatedAt)
		return err
	})
	return a, err
}

func (s *Store) Attachment(ctx context.Context, key string) (Attachment, []byte, error) {
	var a Attachment
	var content []byte
	err := s.db.QueryRowContext(ctx, "SELECT id,project_id,name,mime,size,created_at,content FROM attachments WHERE id=? AND (message_id IS NOT NULL OR created_at>=?)", key, time.Now().Add(-AttachmentLifetime).UTC().Format(time.RFC3339Nano)).Scan(&a.ID, &a.ProjectID, &a.Name, &a.MIME, &a.Size, &a.CreatedAt, &content)
	return a, content, found(err)
}

// Removing a draft cannot remove bytes already reserved by a chat creation or
// accepted message, including when a browser lost the acceptance response.
func (s *Store) RemoveAttachment(ctx context.Context, key string) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, "DELETE FROM attachments WHERE id=? AND chat_id IS NULL", key)
		return err
	})
}

// CleanupAttachments runs at startup and hourly, even when no new uploads arrive.
func (s *Store) CleanupAttachments(ctx context.Context) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, "DELETE FROM attachments WHERE message_id IS NULL AND created_at<?", time.Now().Add(-AttachmentLifetime).UTC().Format(time.RFC3339Nano))
		return err
	})
}

func attachmentIDs(raw json.RawMessage) []string {
	var payload struct {
		Attachments []Attachment `json:"attachments"`
	}
	_ = json.Unmarshal(raw, &payload)
	ids := make([]string, 0, len(payload.Attachments))
	for _, a := range payload.Attachments {
		ids = append(ids, a.ID)
	}
	return ids
}

func sameAttachmentIDs(a, b []string) bool { return slices.Equal(a, b) }

// reserveAttachments checks scope, expiry, count, and total size in the same
// transaction that reserves a chat or accepts a turn. Order is part of input identity.
func reserveAttachments(ctx context.Context, tx *sql.Tx, project, chat, message string, ids []string) ([]Attachment, error) {
	if len(ids) > MaxAttachments {
		return nil, attachmentError("Use at most 5 attachments per message.")
	}
	result := make([]Attachment, 0, len(ids))
	seen := map[string]bool{}
	total := 0
	for _, key := range ids {
		if seen[key] {
			return nil, ErrInvalid
		}
		seen[key] = true
		var a Attachment
		var boundChat, boundMessage string
		err := tx.QueryRowContext(ctx, "SELECT id,project_id,name,mime,size,created_at,coalesce(chat_id,''),coalesce(message_id,'') FROM attachments WHERE id=?", key).Scan(&a.ID, &a.ProjectID, &a.Name, &a.MIME, &a.Size, &a.CreatedAt, &boundChat, &boundMessage)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, attachmentError("An attachment expired or was removed. Remove it and upload it again.")
			}
			return nil, err
		}
		if a.ProjectID != project || boundChat != "" && boundChat != chat || boundMessage != "" && boundMessage != message {
			return nil, attachmentError("An attachment belongs to another chat or message.")
		}
		if boundMessage == "" {
			created, err := time.Parse(time.RFC3339Nano, a.CreatedAt)
			if err != nil || time.Since(created) > AttachmentLifetime {
				return nil, attachmentError("An attachment expired. Upload it again.")
			}
		}
		total += a.Size
		if total > MaxAttachmentTotal {
			return nil, attachmentError("Attachments must total at most 20 MiB per message.")
		}
		_, err = tx.ExecContext(ctx, "UPDATE attachments SET chat_id=?,message_id=nullif(?,'') WHERE id=?", chat, message, key)
		if err != nil {
			return nil, err
		}
		result = append(result, a)
	}
	return result, nil
}

func attachmentPayload(text string, attachments []Attachment) json.RawMessage {
	parts := []map[string]string{}
	if text != "" {
		parts = append(parts, map[string]string{"type": "text", "text": text})
	}
	for _, a := range attachments {
		parts = append(parts, map[string]string{"type": "file", "filename": a.Name, "mime": a.MIME, "url": fmt.Sprintf("/api/attachments/%s/content", a.ID)})
	}
	raw, _ := json.Marshal(map[string]any{"attachments": attachments, "parts": parts})
	return raw
}

// ChatRequest returns a reserved creation so retries can compare saved input
// without requiring an external model catalog to be reachable again.
func (s *Store) ChatRequest(ctx context.Context, project, request string) (string, error) {
	var chat string
	err := s.db.QueryRowContext(ctx, "SELECT chat_id FROM chat_requests WHERE project_id=? AND request_id=?", project, request).Scan(&chat)
	return chat, found(err)
}

func (s *Store) MessageRequest(ctx context.Context, chat, request string) (Message, error) {
	message, err := scanMessage(s.db.QueryRowContext(ctx, messageSelect+" WHERE chat_id=? AND request_id=?", chat, request))
	return message, found(err)
}
