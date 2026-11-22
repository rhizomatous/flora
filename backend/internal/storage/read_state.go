package storage

import (
	"context"
	"database/sql"
)

// ViewedRevision identifies activity already delivered to a client. Revisions are
// per-chat activity sequences, excluding user-owned organization changes.
type ViewedRevision struct {
	ChatID   string `json:"chatID"`
	Revision int64  `json:"revision"`
}

// MarkChatsRead advances durable read positions only through observed activity.
// It never changes execution or activity timestamps. Late retries cannot move a
// position backwards, and activity committed after the observation stays unread.
func (s *Store) MarkChatsRead(ctx context.Context, observed []ViewedRevision) ([]ViewedRevision, error) {
	if len(observed) == 0 || len(observed) > 1000 {
		return nil, ErrInvalid
	}
	result := make([]ViewedRevision, 0, len(observed))
	err := s.write(ctx, func(tx *sql.Tx) error {
		for _, item := range observed {
			if item.ChatID == "" || item.Revision < 0 {
				return ErrInvalid
			}
			var exists bool
			if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM chats WHERE id=?)", item.ChatID).Scan(&exists); err != nil {
				return err
			}
			if !exists {
				return ErrNotFound
			}
			if item.Revision > 0 {
				if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM activity WHERE chat_id=? AND sequence=? AND kind NOT IN ('organization','model.choice'))", item.ChatID, item.Revision).Scan(&exists); err != nil {
					return err
				}
				if !exists {
					return ErrInvalid
				}
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO chat_read_state(chat_id,revision) VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET revision=max(revision,excluded.revision)`, item.ChatID, item.Revision); err != nil {
				return err
			}
			var saved int64
			if err := tx.QueryRowContext(ctx, "SELECT revision FROM chat_read_state WHERE chat_id=?", item.ChatID).Scan(&saved); err != nil {
				return err
			}
			result = append(result, ViewedRevision{ChatID: item.ChatID, Revision: saved})
		}
		return nil
	})
	return result, err
}
