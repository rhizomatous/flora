package storage

import (
	"context"
	"database/sql"
	"time"
)

// SaveSetupLink creates first-run access or explicitly replaces it. Browser setup
// cookies use the same proof, so replacing the link invalidates them too.
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
			query = "INSERT INTO setup_access(id,link_hash,link_expires) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET link_hash=excluded.link_hash,link_expires=excluded.link_expires"
		}
		_, err := tx.ExecContext(ctx, query, hash, expires.Unix())
		return err
	})
}

// SetupLinkExpiry returns the original deadline without consuming or extending
// access. The same proof permits setup in any browser until completion or expiry.
func (s *Store) SetupLinkExpiry(ctx context.Context, hash string, at time.Time) (time.Time, error) {
	var expires int64
	err := s.db.QueryRowContext(ctx, "SELECT link_expires FROM setup_access WHERE link_hash=? AND link_expires>? AND NOT EXISTS(SELECT 1 FROM administrator)", hash, at.Unix()).Scan(&expires)
	return time.Unix(expires, 0), found(err)
}

func (s *Store) SetupLinkValid(ctx context.Context, hash string, at time.Time) (bool, error) {
	var valid bool
	err := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM setup_access WHERE link_hash=? AND link_expires>? AND NOT EXISTS(SELECT 1 FROM administrator))", hash, at.Unix()).Scan(&valid)
	return valid, err
}
