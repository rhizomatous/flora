package storage

import (
	"context"
	"database/sql"
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
