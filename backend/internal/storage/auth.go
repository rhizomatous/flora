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
			if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM setup_access WHERE link_hash=? AND link_expires>?)", setup.hash, setup.at.Unix()).Scan(&valid); err != nil {
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
		at := time.Now()
		if setup != nil {
			at = setup.at
		}
		return insertSession(ctx, tx, tokenHash, expires, at)
	})
}

func (s *Store) CreateSession(ctx context.Context, tokenHash string, expires time.Time) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, "DELETE FROM browser_sessions WHERE expires_at<=?", time.Now().Unix()); err != nil {
			return err
		}
		return insertSession(ctx, tx, tokenHash, expires, time.Now())
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

// SaveCredentials replaces the default connection and retains other providers.
func (s *Store) SaveCredentials(ctx context.Context, c Credentials) error {
	return s.SaveInstallation(ctx, c, nil)
}

// SaveInstallation commits validated credentials and optional limits together.
func (s *Store) SaveInstallation(ctx context.Context, c Credentials, p *Preferences) error {
	return s.saveInstallation(ctx, c, p, true)
}

// SaveModelConnection retains the installation default while adding a provider
// or rotating its key. The first model connection also establishes the default.
func (s *Store) SaveModelConnection(ctx context.Context, c Credentials) error {
	return s.saveInstallation(ctx, c, nil, false)
}

func (s *Store) saveInstallation(ctx context.Context, c Credentials, p *Preferences, makeDefault bool) error {
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
		// Freeze legacy chats before replacing the default. Accepted turn snapshots
		// remain unchanged; old turns without a snapshot use the chat's choice.
		if saved.Provider != "" {
			if _, err := tx.ExecContext(ctx, `UPDATE chats SET execution=? WHERE json_extract(execution,'$.model') IS NULL OR json_extract(execution,'$.model')=''`, selectionJSON(&Execution{Provider: saved.Provider, Model: saved.Model})); err != nil {
				return err
			}
			if err := s.saveProvider(ctx, tx, saved); err != nil {
				return err
			}
		}
		if c.Provider != "" {
			if err := s.saveProvider(ctx, tx, c); err != nil {
				return err
			}
		}
		if !makeDefault && saved.Provider != "" {
			key := c.ProviderKey
			provider := c.Provider
			c = saved
			if provider == saved.Provider {
				c.ProviderKey = key
			}
		}
		// Installing the first model after GitHub also reencrypts its token,
		// since both ciphertext identities include the provider and model.
		_, err = tx.ExecContext(ctx, `INSERT INTO installation_credentials VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,model=excluded.model,github_token=excluded.github_token,provider_key=excluded.provider_key`, c.Provider, c.Model, s.secrets.seal(c.GitHubToken, credentialContext(c, "github")), s.secrets.seal(c.ProviderKey, credentialContext(c, "provider")))
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
