package storage

import (
	"context"
	"database/sql"
)

// CompactionThreshold is scoped to the chat and model, independent of reported usage.
// A nil threshold inherits the runtime default.
func (s *Store) CompactionThreshold(ctx context.Context, chatID string, e Execution) (*int64, error) {
	var n int64
	err := s.db.QueryRowContext(ctx, `SELECT threshold FROM compaction_choices WHERE chat_id=? AND provider=? AND model=?`, chatID, e.Provider, e.Model).Scan(&n)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// SetCompactionThreshold rejects a choice for a model that is no longer selected.
// Changing the preference never modifies accepted work or wakes a runtime.
func (s *Store) SetCompactionThreshold(ctx context.Context, chatID string, e Execution, threshold *int64) error {
	if !e.Valid() || threshold != nil && (*threshold < 1 || *threshold > 1e12) {
		return ErrInvalid
	}
	return s.write(ctx, func(tx *sql.Tx) error {
		selected, err := resolveExecution(ctx, tx, chatID, nil)
		if err != nil {
			return err
		}
		if selected.Provider != e.Provider || selected.Model != e.Model {
			return ErrStale
		}
		if threshold == nil {
			_, err = tx.ExecContext(ctx, `DELETE FROM compaction_choices WHERE chat_id=? AND provider=? AND model=?`, chatID, e.Provider, e.Model)
		} else {
			_, err = tx.ExecContext(ctx, `INSERT INTO compaction_choices VALUES(?,?,?,?) ON CONFLICT(chat_id,provider,model) DO UPDATE SET threshold=excluded.threshold`, chatID, e.Provider, e.Model, *threshold)
		}
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO activity(chat_id,event_id,kind,payload,created_at) VALUES(?,?,?,?,?)`, chatID, id(), "compaction.choice", "{}", now())
		return err
	})
}
