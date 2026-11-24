package storage

import (
	"context"
	"database/sql"
	"time"
)

// SaveSetupLink creates first-run access or explicitly replaces it. Replacement
// clears any redeemed session in the same transaction. An account always wins.
func (s *Store) SaveSetupLink(ctx context.Context, hash string, expires time.Time, replace bool) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		var admin bool
		if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM administrator)").Scan(&admin); err != nil {
			return err
		}
		if admin {
			return ErrConflict
		}
		query := "INSERT INTO setup_access(id,link_hash,link_expires) VALUES(1,?,?) ON CONFLICT(id) DO NOTHING"
		if replace {
			query = "INSERT INTO setup_access(id,link_hash,link_expires) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET link_hash=excluded.link_hash,link_expires=excluded.link_expires,session_hash='',session_expires=0"
		}
		_, err := tx.ExecContext(ctx, query, hash, expires.Unix())
		return err
	})
}

func (s *Store) SetupLinkValid(ctx context.Context, hash string, at time.Time) (bool, error) {
	var valid bool
	err := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM setup_access WHERE link_hash=? AND link_expires>? AND NOT EXISTS(SELECT 1 FROM administrator))", hash, at.Unix()).Scan(&valid)
	return valid, err
}

// RedeemSetup consumes the link and saves only a digest of the restricted cookie.
// The conditional update permits exactly one winner across connections/processes.
func (s *Store) RedeemSetup(ctx context.Context, link, session string, at, expires time.Time) error {
	result, err := s.db.ExecContext(ctx, "UPDATE setup_access SET link_hash='',session_hash=?,session_expires=? WHERE id=1 AND link_hash=? AND link_expires>? AND NOT EXISTS(SELECT 1 FROM administrator)", session, expires.Unix(), link, at.Unix())
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n != 1 {
		return ErrNotFound
	}
	return err
}

func (s *Store) SetupSessionValid(ctx context.Context, hash string, at time.Time) (bool, error) {
	var valid bool
	err := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM setup_access WHERE session_hash=? AND session_expires>? AND NOT EXISTS(SELECT 1 FROM administrator))", hash, at.Unix()).Scan(&valid)
	return valid, err
}
