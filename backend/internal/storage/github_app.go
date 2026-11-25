package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// GitHubApp contains host-only credentials. Never serialize it to browser or
// container responses. An inactive App retains its registration but denies access.
type GitHubApp struct {
	ID             int64
	Slug           string
	PrivateKey     string
	ClientSecret   string
	WebhookSecret  string
	InstallationID int64
	Account        string
	Enabled        bool
	Pending        bool
}

func (s *Store) GitHubApp(ctx context.Context) (GitHubApp, error) {
	s.secretMu.Lock()
	defer s.secretMu.Unlock()
	return readGitHubApp(ctx, s.db, s.secrets)
}

func readGitHubApp(ctx context.Context, reader settingsReader, box *secretBox) (GitHubApp, error) {
	var app GitHubApp
	var raw string
	err := reader.QueryRowContext(ctx, "SELECT credentials FROM github_app WHERE id=1").Scan(&raw)
	if err != nil {
		return app, found(err)
	}
	raw, err = box.open(raw, "github_app:1")
	if err == nil {
		err = json.Unmarshal([]byte(raw), &app)
	}
	return app, err
}

func (s *Store) saveGitHubApp(ctx context.Context, tx *sql.Tx, app GitHubApp) error {
	raw, err := json.Marshal(app)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO github_app VALUES(1,?) ON CONFLICT(id) DO UPDATE SET credentials=excluded.credentials`, s.secrets.seal(string(raw), "github_app:1"))
	return err
}

func (s *Store) SaveGitHubApp(ctx context.Context, app GitHubApp) error {
	s.secretMu.Lock()
	defer s.secretMu.Unlock()
	return s.write(ctx, func(tx *sql.Tx) error { return s.saveGitHubApp(ctx, tx, app) })
}

// UnlinkGitHubInstallation clears repository access and pending callbacks together.
// The encrypted App registration remains available for a later reconnection.
func (s *Store) UnlinkGitHubInstallation(ctx context.Context) error {
	s.secretMu.Lock()
	defer s.secretMu.Unlock()
	return s.write(ctx, func(tx *sql.Tx) error {
		app, err := readGitHubApp(ctx, tx, s.secrets)
		if err != nil {
			return err
		}
		app.Enabled, app.Pending = false, false
		app.InstallationID, app.Account = 0, ""
		if err := s.saveGitHubApp(ctx, tx, app); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "DELETE FROM github_setup")
		return err
	})
}

// BeginGitHubSetup replaces the previous attempt. Only digests are persisted;
// callbacks must present both state and the initiating live browser session.
func (s *Store) BeginGitHubSetup(ctx context.Context, state, session, kind string, expires time.Time) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO github_setup VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state_hash=excluded.state_hash,session_hash=excluded.session_hash,kind=excluded.kind,expires_at=excluded.expires_at`, capabilityDigest(state), capabilityDigest(session), kind, expires.Unix())
	return err
}

func validGitHubSetup(ctx context.Context, db settingsReader, state, session, kind string, now time.Time) error {
	var valid bool
	err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM github_setup WHERE state_hash=? AND session_hash=? AND kind=? AND expires_at>?)`, capabilityDigest(state), capabilityDigest(session), kind, now.Unix()).Scan(&valid)
	if err == nil && !valid {
		return ErrNotFound
	}
	return err
}

func (s *Store) CheckGitHubSetup(ctx context.Context, state, session, kind string, now time.Time) error {
	return validGitHubSetup(ctx, s.db, state, session, kind, now)
}

// FinishGitHubSetup commits the converted credentials and consumes the attempt
// together. A replay or a superseded attempt cannot replace a saved app.
func (s *Store) FinishGitHubSetup(ctx context.Context, state, session, kind string, app GitHubApp, now time.Time) error {
	s.secretMu.Lock()
	defer s.secretMu.Unlock()
	return s.write(ctx, func(tx *sql.Tx) error {
		if err := validGitHubSetup(ctx, tx, state, session, kind, now); err != nil {
			return err
		}
		if err := s.saveGitHubApp(ctx, tx, app); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, "DELETE FROM github_setup")
		return err
	})
}

func rotateGitHubApp(ctx context.Context, tx *sql.Tx, old, next *secretBox) error {
	var raw string
	err := tx.QueryRowContext(ctx, "SELECT credentials FROM github_app WHERE id=1").Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	raw, err = old.open(raw, "github_app:1")
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "UPDATE github_app SET credentials=? WHERE id=1", next.seal(raw, "github_app:1"))
	return err
}

func (s *Store) GitHubConfigured(ctx context.Context) (bool, error) {
	app, err := s.GitHubApp(ctx)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return false, err
	}
	if err == nil {
		return app.Enabled && app.InstallationID > 0, nil
	}
	c, err := s.Credentials(ctx)
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	return c.GitHubToken != "", err
}
