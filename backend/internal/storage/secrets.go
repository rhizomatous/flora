package storage

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

var ErrSecrets = errors.New("credential encryption unavailable: restore the matching private key file and intact database; saved credentials were not replaced")

// secretBox encrypts values with a caller-supplied stable record identity. Binding
// that identity prevents moving ciphertext between secret fields or records.
type secretBox struct {
	aead        cipher.AEAD
	fingerprint [32]byte
}

func (b *secretBox) seal(value, identity string) string {
	return "flora:v1:" + base64.StdEncoding.EncodeToString(b.aead.Seal(nil, nil, []byte(value), []byte(identity)))
}
func (b *secretBox) open(value, identity string) (string, error) {
	encoded, ok := strings.CutPrefix(value, "flora:v1:")
	if !ok {
		return "", ErrSecrets
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", ErrSecrets
	}
	plain, err := b.aead.Open(nil, nil, raw, []byte(identity))
	if err != nil {
		return "", ErrSecrets
	}
	return string(plain), nil
}

// keyPath rejects keys within the data tree, including paths through symlinks.
// Its parent must already exist and be controlled by the operator.
func keyPath(root, path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", ErrSecrets
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(absolute))
	if err != nil {
		return "", fmt.Errorf("key directory must already exist: %w", ErrSecrets)
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", ErrSecrets
	}
	absolute = filepath.Join(parent, filepath.Base(absolute))
	relative, err := filepath.Rel(realRoot, absolute)
	if err != nil || relative == "." || relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("key file must be outside -data-dir: %w", ErrSecrets)
	}
	return absolute, nil
}

func loadSecretBox(path string, create bool) (*secretBox, error) {
	if create {
		if _, err := os.Lstat(path); os.IsNotExist(err) {
			key := make([]byte, 32)
			if _, err := rand.Read(key); err != nil {
				return nil, ErrSecrets
			}
			f, err := os.CreateTemp(filepath.Dir(path), ".flora-key-*")
			if err != nil {
				return nil, ErrSecrets
			}
			temporary := f.Name()
			defer os.Remove(temporary)
			n, writeErr := f.Write(key)
			syncErr := f.Sync()
			closeErr := f.Close()
			if n != len(key) || writeErr != nil || syncErr != nil || closeErr != nil {
				return nil, ErrSecrets
			}
			// Link publishes a complete, synced key without replacing an existing
			// destination. A crash before publication leaves SQLite untouched.
			if err := os.Link(temporary, path); err != nil {
				return nil, ErrSecrets
			}

			dir, err := os.Open(filepath.Dir(path))
			if err != nil {
				return nil, ErrSecrets
			}
			err = dir.Sync()
			_ = dir.Close()
			if err != nil {
				return nil, ErrSecrets
			}
		}
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || (info.Mode().Perm() != 0600 && info.Mode().Perm() != 0400) || info.Size() != 32 {
		return nil, ErrSecrets
	}
	owner, ok := info.Sys().(*syscall.Stat_t)
	if !ok || int(owner.Uid) != os.Geteuid() {
		return nil, ErrSecrets
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, ErrSecrets
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return nil, ErrSecrets
	}
	key, err := io.ReadAll(io.LimitReader(f, 33))
	if err != nil || len(key) != 32 {
		return nil, ErrSecrets
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, ErrSecrets
	}
	aead, err := cipher.NewGCMWithRandomNonce(block)
	if err != nil {
		return nil, ErrSecrets
	}
	return &secretBox{aead: aead, fingerprint: sha256.Sum256(key)}, nil
}

func credentialContext(c Credentials, field string) string {
	raw, _ := json.Marshal([]string{"installation_credentials", "1", c.Provider, c.Model, field})
	return string(raw)
}

type credentialReader interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func readCredentials(ctx context.Context, reader credentialReader, box *secretBox) (Credentials, error) {
	var c Credentials
	err := reader.QueryRowContext(ctx, "SELECT provider,model,github_token,provider_key FROM installation_credentials WHERE id=1").Scan(&c.Provider, &c.Model, &c.GitHubToken, &c.ProviderKey)
	if err != nil {
		return Credentials{}, found(err)
	}
	c.GitHubToken, err = box.open(c.GitHubToken, credentialContext(c, "github"))
	if err != nil {
		return Credentials{}, err
	}
	c.ProviderKey, err = box.open(c.ProviderKey, credentialContext(c, "provider"))
	if err != nil {
		return Credentials{}, err
	}
	return c, nil
}

func (s *Store) initializeSecrets(ctx context.Context, file string) error {
	path, err := keyPath(s.root, file)
	if err != nil {
		return err
	}
	var verifier string
	var pending int
	err = s.db.QueryRowContext(ctx, "SELECT verifier,cleanup_pending FROM credential_encryption WHERE id=1").Scan(&verifier, &pending)
	fresh := errors.Is(err, sql.ErrNoRows)
	if err != nil && !fresh {
		return ErrSecrets
	}
	if fresh {
		var exists bool
		if err := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM installation_credentials) OR EXISTS(SELECT 1 FROM environment_variables WHERE secret=1) OR EXISTS(SELECT 1 FROM chat_environment_requests) OR EXISTS(SELECT 1 FROM mcp_servers) OR EXISTS(SELECT 1 FROM model_providers) OR EXISTS(SELECT 1 FROM github_app)").Scan(&exists); err != nil {
			return ErrSecrets
		}
		if exists {
			return errors.New("credentials have no encryption verifier; use a fresh development data directory")
		}
	}
	box, err := loadSecretBox(path, fresh)
	if err != nil {
		return err
	}
	if fresh {
		if _, err := s.db.ExecContext(ctx, "INSERT INTO credential_encryption VALUES(1,?,0)", box.seal("flora-key-check", "key-check")); err != nil {
			return err
		}
	} else {
		check, err := box.open(verifier, "key-check")
		if err != nil || check != "flora-key-check" {
			return ErrSecrets
		}
	}

	s.secrets = box
	if _, err := readCredentials(ctx, s.db, box); err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}
	if err := rotateProviders(ctx, s.db, box, nil); err != nil {
		return err
	}
	if err := s.validateMCPSecrets(ctx); err != nil {
		return err
	}
	if pending != 0 {
		return s.cleanupSecretRemnants(ctx)
	}
	return nil
}

// cleanupSecretRemnants is retried after a committed key rotation. This
// rewrites SQLite's current files, not filesystem snapshots or storage media.
func (s *Store) cleanupSecretRemnants(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, "VACUUM"); err != nil {
		return fmt.Errorf("credential cleanup incomplete; stop other database users and retry startup: %w", err)
	}
	var busy, pages, checkpointed int
	if err := s.db.QueryRowContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)").Scan(&busy, &pages, &checkpointed); err != nil {
		return err
	}
	if busy != 0 {
		return errors.New("credential WAL cleanup blocked; stop other database users and retry startup")
	}
	_, err := s.db.ExecContext(ctx, "UPDATE credential_encryption SET cleanup_pending=0 WHERE id=1")
	return err
}

// RotateCredentialKey requires exclusive offline ownership of this data directory.
// The old key file stays intact. After commit, only the destination key opens the
// current database; retained backups still require their original key.
func (s *Store) RotateCredentialKey(ctx context.Context, destination string) error {
	s.secretMu.Lock()
	defer s.secretMu.Unlock()
	path, err := keyPath(s.root, destination)
	if err != nil {
		return err
	}
	box, err := loadSecretBox(path, true)
	if err != nil {
		return err
	}
	if box.fingerprint == s.secrets.fingerprint {
		return errors.New("rotation destination must use a different key")
	}
	err = s.write(ctx, func(tx *sql.Tx) error {
		c, err := readCredentials(ctx, tx, s.secrets)
		if err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
		if err == nil {
			if _, err := tx.ExecContext(ctx, "UPDATE installation_credentials SET github_token=?,provider_key=? WHERE id=1", box.seal(c.GitHubToken, credentialContext(c, "github")), box.seal(c.ProviderKey, credentialContext(c, "provider"))); err != nil {
				return err
			}
		}
		if err := rotateProviders(ctx, tx, s.secrets, box); err != nil {
			return err
		}
		if err := rotateGitHubApp(ctx, tx, s.secrets, box); err != nil {
			return err
		}
		if err := rotateMCPs(ctx, tx, s.secrets, box); err != nil {
			return err
		}
		if err := rotateEnvironment(ctx, tx, s.secrets, box); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "UPDATE credential_encryption SET verifier=?,cleanup_pending=1 WHERE id=1", box.seal("flora-key-check", "key-check"))
		return err
	})
	if err != nil {
		return err
	}
	s.secrets = box
	return s.cleanupSecretRemnants(ctx)
}
