package storage

import (
	"context"
	"database/sql"
	"strings"
	"unicode/utf8"
)

func (s *Store) Chats(ctx context.Context) ([]Chat, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id FROM chats ORDER BY julianday(updated_at) DESC,id")
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	result := []Chat{}
	for _, id := range ids {
		c, err := s.Chat(ctx, id)
		if err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, nil
}

// LinkRuntimeMessage associates an observed OpenCode user record with an accepted
// message. The link does not prove tools completed or authorize resubmission.
func (s *Store) LinkRuntimeMessage(ctx context.Context, chatID, messageID, runtimeID string) error {
	if runtimeID == "" {
		return ErrInvalid
	}
	return s.write(ctx, func(tx *sql.Tx) error {
		var existing string
		if err := tx.QueryRowContext(ctx, "SELECT coalesce(runtime_message_id,'') FROM messages WHERE chat_id=? AND id=? AND role='user'", chatID, messageID).Scan(&existing); err != nil {
			return found(err)
		}
		if existing != "" && existing != runtimeID {
			return ErrConflict
		}
		_, err := tx.ExecContext(ctx, "UPDATE messages SET runtime_message_id=? WHERE id=?", runtimeID, messageID)
		return err
	})
}

// ChatOrganization changes only user-owned navigation metadata. Archiving clears
// the pin, but leaves execution, messages, and automation links untouched. Runtime
// status and history updates never write these fields or the user-owned title.
type ChatOrganization struct {
	Title    *string `json:"title"`
	Pinned   *bool   `json:"pinned"`
	Archived *bool   `json:"archived"`
	Revision *int64  `json:"revision"`
}

func (s *Store) OrganizeChat(ctx context.Context, chatID string, in ChatOrganization) (Chat, error) {
	if in.Revision == nil || *in.Revision < 0 || (in.Title == nil && in.Pinned == nil && in.Archived == nil) {
		return Chat{}, ErrInvalid
	}
	if in.Title != nil && (!utf8.ValidString(*in.Title) || strings.TrimSpace(*in.Title) == "" || len(*in.Title) > 200) {
		return Chat{}, ErrInvalid
	}
	err := s.write(ctx, func(tx *sql.Tx) error {
		var title, pin string
		var archived bool
		var revision int64
		if err := tx.QueryRowContext(ctx, "SELECT title,pinned_at,archived,organization_revision FROM chats WHERE id=?", chatID).Scan(&title, &pin, &archived, &revision); err != nil {
			return found(err)
		}
		if revision != *in.Revision {
			return ErrStale
		}
		if in.Title != nil {
			title = strings.TrimSpace(*in.Title)
		}
		if in.Archived != nil {
			archived = *in.Archived
		}
		if in.Pinned != nil {
			if *in.Pinned {
				if archived {
					return ErrInvalid
				}
				if pin == "" {
					pin = now()
				}
			} else {
				pin = ""
			}
		}
		if archived {
			pin = ""
		}
		if _, err := tx.ExecContext(ctx, "UPDATE chats SET title=?,pinned_at=?,archived=?,organization_revision=organization_revision+1 WHERE id=?", title, pin, archived, chatID); err != nil {
			return err
		}
		return addActivity(ctx, tx, chatID, id(), "organization", []byte(`{}`))
	})
	if err != nil {
		return Chat{}, err
	}
	return s.Chat(ctx, chatID)
}
