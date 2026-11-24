package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"time"
)

type Passkey struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Origin     string `json:"origin"`
	Credential string `json:"-"`
	CreatedAt  int64  `json:"createdAt"`
	LastUsedAt int64  `json:"lastUsedAt"`
}

func (s *Store) PasskeyIdentity(ctx context.Context) ([]byte, error) {
	handle := make([]byte, 32)
	_, _ = rand.Read(handle)
	err := s.write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, "INSERT INTO passkey_identity VALUES(1,?) ON CONFLICT(id) DO NOTHING", handle); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, "SELECT user_handle FROM passkey_identity WHERE id=1").Scan(&handle)
	})
	return handle, err
}

func (s *Store) Passkeys(ctx context.Context) ([]Passkey, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id,name,origin,credential,created_at,last_used_at FROM passkeys ORDER BY created_at,id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []Passkey{}
	for rows.Next() {
		var key Passkey
		if err := rows.Scan(&key.ID, &key.Name, &key.Origin, &key.Credential, &key.CreatedAt, &key.LastUsedAt); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func (s *Store) SaveCeremony(ctx context.Context, hash, purpose, binding, data string, expires, at time.Time) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, "DELETE FROM auth_ceremonies WHERE expires_at<=? OR (purpose=? AND binding=?)", at.Unix(), purpose, binding); err != nil {
			return err
		}
		var count int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM auth_ceremonies").Scan(&count); err != nil {
			return err
		}
		if count >= 100 {
			return ErrConflict
		}
		_, err := tx.ExecContext(ctx, "INSERT INTO auth_ceremonies VALUES(?,?,?,?,?)", hash, purpose, binding, data, expires.Unix())
		return err
	})
}

// TakeCeremony consumes the browser-bound proof before parsing a response. Failed
// verification also consumes it, and concurrent finish requests cannot reuse it.
func (s *Store) TakeCeremony(ctx context.Context, hash, purpose, binding string, at time.Time) (string, error) {
	var data string
	err := s.write(ctx, func(tx *sql.Tx) error {
		err := tx.QueryRowContext(ctx, "SELECT data FROM auth_ceremonies WHERE token_hash=? AND purpose=? AND binding=? AND expires_at>?", hash, purpose, binding, at.Unix()).Scan(&data)
		if err != nil {
			return found(err)
		}
		_, err = tx.ExecContext(ctx, "DELETE FROM auth_ceremonies WHERE token_hash=?", hash)
		return err
	})
	return data, err
}

func (s *Store) RecentSession(ctx context.Context, hash string, at time.Time) (bool, error) {
	var valid bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM browser_sessions s JOIN session_authentication a USING(token_hash) WHERE s.token_hash=? AND s.expires_at>? AND a.authenticated_at>? AND a.authenticated_at<=?)`, hash, at.Unix(), at.Add(-5*time.Minute).Unix(), at.Unix()).Scan(&valid)
	return valid, err
}

func (s *Store) SaveRecoveryLink(ctx context.Context, hash string, expires time.Time) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		var exists bool
		if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM administrator)").Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
		_, err := tx.ExecContext(ctx, "INSERT INTO account_recovery VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at", hash, expires.Unix())
		return err
	})
}
func (s *Store) RecoveryValid(ctx context.Context, hash string, at time.Time) (bool, error) {
	var valid bool
	err := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM account_recovery WHERE token_hash=? AND expires_at>?)", hash, at.Unix()).Scan(&valid)
	return valid, err
}

// checkAccountGrant runs inside the credential write transaction. The binding is
// a hashed session, first-run setup proof, or host-issued recovery proof.
func checkAccountGrant(ctx context.Context, tx *sql.Tx, mode, binding string, at time.Time) error {
	var query string
	switch mode {
	case "setup":
		query = "SELECT EXISTS(SELECT 1 FROM setup_access WHERE link_hash=? AND link_expires>? AND NOT EXISTS(SELECT 1 FROM administrator))"
	case "recovery":
		query = "SELECT EXISTS(SELECT 1 FROM account_recovery WHERE token_hash=? AND expires_at>?)"
	case "session":
		var valid bool
		err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM browser_sessions s JOIN session_authentication a USING(token_hash) WHERE s.token_hash=? AND s.expires_at>? AND a.authenticated_at>?)`, binding, at.Unix(), at.Add(-5*time.Minute).Unix()).Scan(&valid)
		if err != nil {
			return err
		}
		if !valid {
			return ErrNotFound
		}
		return nil
	default:
		return ErrInvalid
	}
	var valid bool
	if err := tx.QueryRowContext(ctx, query, binding, at.Unix()).Scan(&valid); err != nil {
		return err
	}
	if !valid {
		return ErrNotFound
	}
	return nil
}

func insertSession(ctx context.Context, tx *sql.Tx, hash string, expires, at time.Time) error {
	if _, err := tx.ExecContext(ctx, "INSERT INTO browser_sessions VALUES(?,?)", hash, expires.Unix()); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, "INSERT INTO session_authentication VALUES(?,?)", hash, at.Unix())
	return err
}

// RegisterPasskey rechecks ownership and saves the credential atomically. Recovery
// replaces all login methods and sessions while retaining projects and settings.
func (s *Store) RegisterPasskey(ctx context.Context, key Passkey, mode, binding, session string, expires, at time.Time) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		if err := checkAccountGrant(ctx, tx, mode, binding, at); err != nil {
			return err
		}
		if mode == "recovery" {
			for _, query := range []string{"DELETE FROM browser_sessions", "DELETE FROM passkeys", "DELETE FROM auth_ceremonies", "DELETE FROM account_recovery", "UPDATE administrator SET password_hash='' WHERE id=1"} {
				if _, err := tx.ExecContext(ctx, query); err != nil {
					return err
				}
			}
		}
		if mode == "setup" {
			if _, err := tx.ExecContext(ctx, "INSERT INTO administrator VALUES(1,'')"); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "DELETE FROM setup_access"); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO passkeys(id,name,origin,credential,created_at) VALUES(?,?,?,?,?)", key.ID, key.Name, key.Origin, key.Credential, at.Unix()); err != nil {
			return err
		}
		if mode != "session" {
			return insertSession(ctx, tx, session, expires, at)
		}
		return nil
	})
}

// CompletePasskeyLogin updates the verified credential only if it is still
// enrolled. Removal or host recovery racing verification prevents session creation.
func (s *Store) CompletePasskeyLogin(ctx context.Context, id, origin, previous, credential, session string, expires, at time.Time) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, "UPDATE passkeys SET credential=?,last_used_at=? WHERE id=? AND origin=? AND credential=?", credential, at.Unix(), id, origin, previous)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if n != 1 {
			return ErrNotFound
		}
		return insertSession(ctx, tx, session, expires, at)
	})
}

func (s *Store) ChangePasskey(ctx context.Context, id, name string, remove bool, binding, origin string, at time.Time) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		if err := checkAccountGrant(ctx, tx, "session", binding, at); err != nil {
			return err
		}
		if remove {
			var count int
			var password string
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM passkeys WHERE origin=?", origin).Scan(&count); err != nil {
				return err
			}
			if err := tx.QueryRowContext(ctx, "SELECT password_hash FROM administrator WHERE id=1").Scan(&password); err != nil {
				return err
			}
			var keyOrigin string
			if err := tx.QueryRowContext(ctx, "SELECT origin FROM passkeys WHERE id=?", id).Scan(&keyOrigin); err != nil {
				return found(err)
			}
			if count <= 1 && password == "" && keyOrigin == origin {
				return ErrConflict
			}
			result, err := tx.ExecContext(ctx, "DELETE FROM passkeys WHERE id=?", id)
			if err != nil {
				return err
			}
			n, err := result.RowsAffected()
			if err == nil && n == 0 {
				return ErrNotFound
			}
			return err
		}
		result, err := tx.ExecContext(ctx, "UPDATE passkeys SET name=? WHERE id=?", name, id)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		if err == nil && n == 0 {
			return ErrNotFound
		}
		return err
	})
}

func (s *Store) RecoverPassword(ctx context.Context, password, binding, session string, expires, at time.Time) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		if err := checkAccountGrant(ctx, tx, "recovery", binding, at); err != nil {
			return err
		}
		for _, query := range []string{"DELETE FROM browser_sessions", "DELETE FROM passkeys", "DELETE FROM auth_ceremonies", "DELETE FROM account_recovery"} {
			if _, err := tx.ExecContext(ctx, query); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, "UPDATE administrator SET password_hash=? WHERE id=1", password); err != nil {
			return err
		}
		return insertSession(ctx, tx, session, expires, at)
	})
}

// CompletePasswordLogin rechecks the hash verified by the caller, so a host
// recovery that replaces it during password hashing cannot create an old session.
func (s *Store) CompletePasswordLogin(ctx context.Context, expected, session string, expires, at time.Time) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		var hash string
		if err := tx.QueryRowContext(ctx, "SELECT password_hash FROM administrator WHERE id=1").Scan(&hash); err != nil {
			return found(err)
		}
		if hash == "" || hash != expected {
			return ErrNotFound
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM browser_sessions WHERE expires_at<=?", at.Unix()); err != nil {
			return err
		}
		return insertSession(ctx, tx, session, expires, at)
	})
}
