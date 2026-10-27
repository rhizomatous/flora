package storage

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

func (s *Store) AdministratorHash(ctx context.Context) (string, error) {
	var hash string
	err := s.db.QueryRowContext(ctx, "SELECT password_hash FROM administrator WHERE id=1").Scan(&hash)
	return hash, found(err)
}

// Bootstrap saves the sole administrator and its first session in one transaction.
// Concurrent attempts cannot replace the winner or create a second session.
func (s *Store) Bootstrap(ctx context.Context, passwordHash, tokenHash string, expires time.Time) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, "INSERT INTO administrator VALUES(1,?) ON CONFLICT(id) DO NOTHING", passwordHash)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrConflict
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO browser_sessions VALUES(?,?)", tokenHash, expires.Unix())
		return err
	})
}

func (s *Store) CreateSession(ctx context.Context, tokenHash string, expires time.Time) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, "DELETE FROM browser_sessions WHERE expires_at<=?", time.Now().Unix()); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, "INSERT INTO browser_sessions VALUES(?,?)", tokenHash, expires.Unix())
		return err
	})
}

func (s *Store) SessionValid(ctx context.Context, tokenHash string, at time.Time) (bool, error) {
	var exists bool
	err := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM browser_sessions WHERE token_hash=? AND expires_at>?)", tokenHash, at.Unix()).Scan(&exists)
	return exists, err
}

func (s *Store) RevokeSession(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM browser_sessions WHERE token_hash=?", tokenHash)
	return err
}

// Credentials are backend-only data in the private database. Never mount the
// storage root into an agent, serialize this type to HTTP, or log its values.
type Credentials struct{ Provider, Model, GitHubToken, ProviderKey string }

func (s *Store) Credentials(ctx context.Context) (Credentials, error) {
	var c Credentials
	err := s.db.QueryRowContext(ctx, "SELECT provider,model,github_token,provider_key FROM installation_credentials WHERE id=1").Scan(&c.Provider, &c.Model, &c.GitHubToken, &c.ProviderKey)
	return c, found(err)
}

// SaveCredentials permits key rotation but never changes an installed model.
func (s *Store) SaveCredentials(ctx context.Context, c Credentials) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		var provider, model string
		err := tx.QueryRowContext(ctx, "SELECT provider,model FROM installation_credentials WHERE id=1").Scan(&provider, &model)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if err == nil && (provider != c.Provider || model != c.Model) {
			return ErrConflict
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO installation_credentials VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET github_token=excluded.github_token,provider_key=excluded.provider_key`, c.Provider, c.Model, c.GitHubToken, c.ProviderKey)
		return err
	})
}
