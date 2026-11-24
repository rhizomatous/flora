package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

func (s *Store) AdministratorHash(ctx context.Context) (string, error) {
	var hash string
	err := s.db.QueryRowContext(ctx, "SELECT password_hash FROM administrator WHERE id=1").Scan(&hash)
	return hash, found(err)
}

// Bootstrap saves a trusted host-created administrator and first browser session.
// HTTP callers must use BootstrapWithSetup to verify ownership in this transaction.
func (s *Store) Bootstrap(ctx context.Context, passwordHash, tokenHash string, expires time.Time) error {
	return s.bootstrap(ctx, passwordHash, tokenHash, expires, nil)
}

type setupGrant struct {
	hash string
	at   time.Time
}

// BootstrapWithSetup consumes restricted access and creates the sole account and
// browser session atomically. Replacement and expiry are checked in that transaction.
func (s *Store) BootstrapWithSetup(ctx context.Context, passwordHash, tokenHash string, expires time.Time, setupHash string, at time.Time) error {
	return s.bootstrap(ctx, passwordHash, tokenHash, expires, &setupGrant{setupHash, at})
}

func (s *Store) bootstrap(ctx context.Context, passwordHash, tokenHash string, expires time.Time, setup *setupGrant) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		var admin bool
		if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM administrator)").Scan(&admin); err != nil {
			return err
		}
		if admin {
			return ErrConflict
		}
		if setup != nil {
			var valid bool
			if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM setup_access WHERE session_hash=? AND session_expires>?)", setup.hash, setup.at.Unix()).Scan(&valid); err != nil {
				return err
			}
			if !valid {
				return ErrNotFound
			}
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO administrator VALUES(1,?)", passwordHash); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM setup_access"); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, "INSERT INTO browser_sessions VALUES(?,?)", tokenHash, expires.Unix())
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
	s.secretMu.Lock()
	defer s.secretMu.Unlock()
	return readCredentials(ctx, s.db, s.secrets)
}

// SaveCredentials replaces upstream credentials but never changes an installed model.
func (s *Store) SaveCredentials(ctx context.Context, c Credentials) error {
	return s.SaveInstallation(ctx, c, nil)
}

// SaveInstallation commits validated credentials and optional limits together.
func (s *Store) SaveInstallation(ctx context.Context, c Credentials, p *Preferences) error {
	s.secretMu.Lock()
	defer s.secretMu.Unlock()
	if p != nil {
		if err := p.Validate(); err != nil {
			return err
		}
	}
	unlock, err := s.LockContainerCapacity(ctx)
	if err != nil {
		return err
	}
	defer unlock()
	return s.write(ctx, func(tx *sql.Tx) error {
		saved, err := readCredentials(ctx, tx, s.secrets)
		if err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
		if err == nil && (saved.Provider != c.Provider || saved.Model != c.Model) {
			return ErrConflict
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO installation_credentials VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET github_token=excluded.github_token,provider_key=excluded.provider_key`, c.Provider, c.Model, s.secrets.seal(c.GitHubToken, credentialContext(c, "github")), s.secrets.seal(c.ProviderKey, credentialContext(c, "provider")))
		if err == nil && p != nil {
			raw, e := json.Marshal(p)
			if e != nil {
				return e
			}
			_, err = tx.ExecContext(ctx, `INSERT INTO installation_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET settings=excluded.settings`, string(raw))
		}
		return err
	})
}
