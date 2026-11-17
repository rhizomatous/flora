package storage

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// RuntimeLease returns an absolute deadline. Expiration requests idle cleanup;
// it never authorizes interrupting active work.
func (s *Store) RuntimeLease(ctx context.Context, id string) (time.Time, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, "SELECT expires_at FROM runtime_leases WHERE chat_id = ?", id).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, nil
	}
	if err != nil {
		return time.Time{}, err
	}
	return time.Parse(time.RFC3339Nano, raw)
}
func (s *Store) SetRuntimeLease(ctx context.Context, id string, until time.Time) error {
	if until.IsZero() {
		_, err := s.db.ExecContext(ctx, "DELETE FROM runtime_leases WHERE chat_id = ?", id)
		return err
	}
	_, err := s.db.ExecContext(ctx, "INSERT INTO runtime_leases(chat_id, expires_at) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET expires_at = excluded.expires_at", id, until.UTC().Format(time.RFC3339Nano))
	return err
}
