package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"
)

const MaxReferences = 5
const MaxReferenceBytes = 32 << 10

type ContextReference struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Label      string `json:"label"`
	Source     string `json:"source"`
	Version    string `json:"version"`
	CapturedAt string `json:"capturedAt"`
	Content    string `json:"content"`
}

// PutContextReference saves server-resolved text and provenance, never caller-supplied content.
// Draft snapshots expire after a day; accepted messages keep their own complete copy.
func (s *Store) PutContextReference(ctx context.Context, project string, ref ContextReference) (ContextReference, error) {
	if len(ref.Content) > MaxReferenceBytes || len(ref.Label) > 500 || len(ref.Source) > 2048 || len(ref.Version) > 500 {
		return ref, &AttachmentError{Reason: "Context exceeds 32 KiB. Choose a smaller source."}
	}
	ref.ID, ref.CapturedAt = id(), now()
	raw, err := json.Marshal(ref)
	if err != nil {
		return ref, err
	}
	err = s.write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, "DELETE FROM context_references WHERE created_at<? AND id NOT IN (SELECT value FROM request_context, json_each(request_context.refs))", time.Now().Add(-24*time.Hour).UTC().Format(time.RFC3339Nano)); err != nil {
			return err
		}
		var total int
		if err := tx.QueryRowContext(ctx, "SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM context_references WHERE id NOT IN (SELECT value FROM request_context,json_each(request_context.refs))").Scan(&total); err != nil {
			return err
		}
		if total > 100<<20 {
			return &AttachmentError{Reason: "Draft context has reached 100 MiB. Try again after unused snapshots expire within 24 hours."}
		}
		_, err := tx.ExecContext(ctx, "INSERT INTO context_references(id,project_id,payload,created_at) VALUES(?,?,?,?)", ref.ID, project, string(raw), ref.CapturedAt)
		return err
	})
	return ref, err
}

// reserveContext records ordered snapshot identities in the same transaction as the request.
// A retry compares identities and uses the frozen text, without reading any live source.
func reserveContext(ctx context.Context, tx *sql.Tx, scope, request, project string, ids []string) ([]ContextReference, error) {
	if len(ids) > MaxReferences {
		return nil, &AttachmentError{Reason: "Use at most 5 context references."}
	}
	encoded, _ := json.Marshal(append([]string{}, ids...))
	var old string
	err := tx.QueryRowContext(ctx, "SELECT refs FROM request_context WHERE scope=? AND request_id=?", scope, request).Scan(&old)
	reserved := err == nil
	if err == nil && old != string(encoded) {
		return nil, ErrConflict
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	refs := []ContextReference{}
	for i, key := range ids {
		if slices.Contains(ids[:i], key) {
			return nil, ErrInvalid
		}
		var raw string
		if err := tx.QueryRowContext(ctx, "SELECT payload FROM context_references WHERE id=? AND project_id=?", key, project).Scan(&raw); err != nil {
			return nil, &AttachmentError{Reason: "A context snapshot expired or belongs to another project. Remove it and select the source again."}
		}
		var ref ContextReference
		if err := json.Unmarshal([]byte(raw), &ref); err != nil {
			return nil, err
		}
		stamp, e := time.Parse(time.RFC3339Nano, ref.CapturedAt)
		if !reserved && (e != nil || time.Since(stamp) > 24*time.Hour) {
			var pinned int
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM request_context,json_each(request_context.refs) WHERE value=?", key).Scan(&pinned); err != nil {
				return nil, err
			}
			if pinned == 0 {
				return nil, &AttachmentError{Reason: "A context snapshot expired. Remove it and select the source again."}
			}
		}
		refs = append(refs, ref)
	}
	_, err = tx.ExecContext(ctx, "INSERT OR IGNORE INTO request_context(scope,request_id,refs) VALUES(?,?,?)", scope, request, string(encoded))
	return refs, err
}
func referenceIDs(raw json.RawMessage) []string {
	var payload struct {
		References []ContextReference `json:"references"`
	}
	_ = json.Unmarshal(raw, &payload)
	ids := []string{}
	for _, r := range payload.References {
		ids = append(ids, r.ID)
	}
	return ids
}

// ContextMessages selects the latest twenty user and assistant text records only.
// Tool payloads, runtime configuration, and nested context are deliberately excluded.
func (s *Store) ContextMessages(ctx context.Context, chat string) (string, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT role,substr(text,1,32769) FROM messages WHERE chat_id=? AND role IN ('user','assistant') ORDER BY sequence DESC LIMIT 20", chat)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var parts []string
	total := 0
	for rows.Next() {
		var role, text string
		if err := rows.Scan(&role, &text); err != nil {
			return "", err
		}
		total += len(role) + len(text) + 4
		if total > MaxReferenceBytes {
			return "", &AttachmentError{Reason: "The latest 20 messages exceed 32 KiB. Copy a smaller excerpt instead."}
		}
		parts = append(parts, role+":\n"+text)
	}
	slices.Reverse(parts)
	return strings.Join(parts, "\n\n"), rows.Err()
}
