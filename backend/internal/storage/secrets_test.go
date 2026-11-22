package storage

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var fixtureCredentials = Credentials{Provider: "anthropic", Model: "fixture-model", GitHubToken: "github_pat_fixture_only_31817", ProviderKey: "sk_fixture_only_67182"}

func assertFixtureCredentials(t *testing.T, s *Store) {
	t.Helper()
	c, err := s.Credentials(ctx)
	must(t, err)
	if c != fixtureCredentials {
		t.Fatal("fixture credentials changed")
	}
}

func assertEncryptedRecords(t *testing.T, s *Store) {
	t.Helper()
	var github, provider string
	must(t, s.db.QueryRow("SELECT github_token,provider_key FROM installation_credentials").Scan(&github, &provider))
	for _, value := range []string{github, provider} {
		if !strings.HasPrefix(value, "flora:v1:") || strings.Contains(value, fixtureCredentials.GitHubToken) || strings.Contains(value, fixtureCredentials.ProviderKey) {
			t.Fatal("plaintext logical credential")
		}
	}
}

func TestCredentialsEncryptedFromFirstSave(t *testing.T) {
	root := filepath.Join(t.TempDir(), "data")
	s, err := Open(ctx, root)
	must(t, err)
	must(t, s.SaveCredentials(ctx, fixtureCredentials))
	assertEncryptedRecords(t, s)
	assertFixtureCredentials(t, s)
	for _, name := range []string{"flora.db", "flora.db-wal", "flora.db-journal"} {
		raw, err := os.ReadFile(filepath.Join(root, name))
		if os.IsNotExist(err) {
			continue
		}
		must(t, err)
		if bytes.Contains(raw, []byte(fixtureCredentials.GitHubToken)) || bytes.Contains(raw, []byte(fixtureCredentials.ProviderKey)) {
			t.Fatalf("fixture plaintext in %s", name)
		}
	}
	must(t, s.Close())
	must(t, os.Chmod(root+".key", 0400))
	s, err = Open(ctx, root)
	must(t, err)
	defer s.Close()
	assertFixtureCredentials(t, s)
	must(t, s.SaveCredentials(ctx, fixtureCredentials))
	info, err := os.Stat(root + ".key")
	must(t, err)
	if info.Mode().Perm() != 0400 {
		t.Fatal("opening storage changed the read-only key permissions")
	}
}

func TestPlaintextCredentialsRequireFreshStorage(t *testing.T) {
	for _, missingKey := range []bool{false, true} {
		t.Run(fmt.Sprint("missing-key-", missingKey), func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "data")
			s, err := Open(ctx, root)
			must(t, err)
			c := fixtureCredentials
			_, err = s.db.Exec("DELETE FROM credential_encryption; INSERT INTO installation_credentials VALUES(1,?,?,?,?)", c.Provider, c.Model, c.GitHubToken, c.ProviderKey)
			must(t, err)
			must(t, s.Close())
			key, err := os.ReadFile(root + ".key")
			must(t, err)
			if missingKey {
				must(t, os.Remove(root+".key"))
			}
			s, err = Open(ctx, root)
			if err == nil {
				s.Close()
				t.Fatal("plaintext credentials were accepted")
			}
			if !strings.Contains(err.Error(), "fresh development data directory") {
				t.Fatal("missing fresh-storage instruction")
			}
			db, err := sql.Open("sqlite", filepath.Join(root, "flora.db"))
			must(t, err)
			defer db.Close()
			var github, provider string
			must(t, db.QueryRow("SELECT github_token,provider_key FROM installation_credentials").Scan(&github, &provider))
			if github != c.GitHubToken || provider != c.ProviderKey {
				t.Fatal("unsupported credentials were rewritten")
			}
			savedKey, err := os.ReadFile(root + ".key")
			if missingKey {
				if !os.IsNotExist(err) {
					t.Fatal("key generated for unsupported credential storage")
				}
			} else {
				must(t, err)
				if !bytes.Equal(savedKey, key) {
					t.Fatal("saved key was replaced")
				}
			}
		})
	}
}

func TestEncryptedCredentialsFailClosed(t *testing.T) {
	for _, mode := range []string{"missing-key", "wrong-key", "bad-format", "tamper", "swap", "missing-marker", "missing-marker-and-key", "short-ciphertext", "unknown-version", "metadata"} {
		t.Run(mode, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "data")
			s, err := Open(ctx, root)
			must(t, err)
			must(t, s.SaveCredentials(ctx, fixtureCredentials))
			must(t, s.Bootstrap(ctx, "password-hash-unchanged", "session-hash-unchanged", time.Now().Add(time.Hour)))
			key, err := os.ReadFile(root + ".key")
			must(t, err)
			if mode == "missing-key" || mode == "missing-marker-and-key" {
				must(t, os.Remove(root+".key"))
			}
			if mode == "wrong-key" {
				must(t, os.WriteFile(root+".key", bytes.Repeat([]byte{9}, 32), 0600))
			}
			if mode == "bad-format" {
				_, err = s.db.Exec("UPDATE installation_credentials SET github_token='plaintext-replacement'")
				must(t, err)
			}
			if mode == "tamper" {
				_, err = s.db.Exec("UPDATE installation_credentials SET github_token=substr(github_token,1,length(github_token)-5)||'AAAAA'")
				must(t, err)
			}
			if mode == "swap" {
				_, err = s.db.Exec("UPDATE installation_credentials SET github_token=provider_key,provider_key=github_token")
				must(t, err)
			}
			if mode == "short-ciphertext" {
				_, err = s.db.Exec("UPDATE installation_credentials SET github_token='flora:v1:'")
				must(t, err)
			}
			if mode == "unknown-version" {
				_, err = s.db.Exec("UPDATE installation_credentials SET github_token=replace(github_token,'flora:v1:','flora:v2:')")
				must(t, err)
			}
			if mode == "metadata" {
				_, err = s.db.Exec("DROP TRIGGER immutable_installation_model; UPDATE installation_credentials SET provider='openai'")
				must(t, err)
			}
			if mode == "missing-marker" || mode == "missing-marker-and-key" {
				_, err = s.db.Exec("DELETE FROM credential_encryption")
				must(t, err)
			}
			var before string
			must(t, s.db.QueryRow("SELECT github_token FROM installation_credentials").Scan(&before))
			if mode == "bad-format" || mode == "tamper" || mode == "swap" {
				c, err := s.Credentials(ctx)
				if !errors.Is(err, ErrSecrets) || c != (Credentials{}) {
					t.Fatal("invalid ciphertext exposed credential data")
				}
				if !errors.Is(s.SaveCredentials(ctx, fixtureCredentials), ErrSecrets) {
					t.Fatal("invalid ciphertext overwritten")
				}
			}
			must(t, s.Close())
			reopened, err := Open(ctx, root)
			if err == nil {
				reopened.Close()
				t.Fatal("opened invalid secrets")
			}
			if strings.Contains(err.Error(), fixtureCredentials.GitHubToken) || strings.Contains(err.Error(), fixtureCredentials.ProviderKey) {
				t.Fatal("secret in error")
			}
			db, err := sql.Open("sqlite", filepath.Join(root, "flora.db"))
			must(t, err)
			var after, hash string
			must(t, db.QueryRow("SELECT github_token FROM installation_credentials").Scan(&after))
			must(t, db.QueryRow("SELECT password_hash FROM administrator").Scan(&hash))
			if before != after || hash != "password-hash-unchanged" {
				t.Fatal("failed open changed saved records")
			}
			must(t, db.Close())
			if mode == "missing-key" || mode == "missing-marker-and-key" {
				if _, err := os.Stat(root + ".key"); !os.IsNotExist(err) {
					t.Fatal("missing key regenerated")
				}
			}
			must(t, os.WriteFile(root+".key", key, 0600))
		})
	}
}

func TestCredentialRotationAndBackupRestore(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "data")
	oldKey := root + ".key"
	newKey := filepath.Join(base, "rotated.key")
	s, err := Open(ctx, root)
	must(t, err)
	must(t, s.SaveCredentials(ctx, fixtureCredentials))
	must(t, s.Close())
	backup, err := os.ReadFile(filepath.Join(root, "flora.db"))
	must(t, err)
	keyBackup, err := os.ReadFile(oldKey)
	must(t, err)
	s, err = Open(ctx, root)
	must(t, err)
	_, err = s.db.Exec("CREATE TRIGGER fail_rotation BEFORE UPDATE OF verifier ON credential_encryption BEGIN SELECT RAISE(ABORT,'interrupted'); END")
	must(t, err)
	if s.RotateCredentialKey(ctx, newKey) == nil {
		t.Fatal("rotation should roll back")
	}
	assertFixtureCredentials(t, s)
	_, err = s.db.Exec("DROP TRIGGER fail_rotation")
	must(t, err)
	must(t, s.Close())
	s, err = Open(ctx, root)
	must(t, err)
	must(t, s.RotateCredentialKey(ctx, newKey))
	assertFixtureCredentials(t, s)
	assertEncryptedRecords(t, s)
	must(t, s.Close())
	wrong, err := Open(ctx, root)
	if err == nil {
		wrong.Close()
		t.Fatal("old key opens rotated database")
	}
	s, err = OpenWithKeyFile(ctx, root, newKey)
	must(t, err)
	assertFixtureCredentials(t, s)
	must(t, s.Close())
	// Restore the cold backup into a separate directory with its matching old key.
	restored := filepath.Join(base, "restored")
	must(t, os.Mkdir(restored, 0700))
	must(t, os.WriteFile(filepath.Join(restored, "flora.db"), backup, 0600))
	must(t, os.WriteFile(restored+".key", keyBackup, 0600))
	s, err = Open(ctx, restored)
	must(t, err)
	assertFixtureCredentials(t, s)
	must(t, s.Close())
	s, err = OpenWithKeyFile(ctx, restored, newKey)
	if err == nil {
		s.Close()
		t.Fatal("new key opened old backup")
	}
	unchanged, err := os.ReadFile(oldKey)
	must(t, err)
	if !bytes.Equal(unchanged, keyBackup) {
		t.Fatal("rotation replaced old backup key")
	}
}

func TestCredentialKeyLocationAndPermissions(t *testing.T) {
	root := filepath.Join(t.TempDir(), "data")
	s, err := Open(ctx, root)
	must(t, err)
	must(t, s.Close())
	for _, kind := range []string{"inside", "symlink", "permissions", "short"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(filepath.Dir(root), kind+".key")
			switch kind {
			case "inside":
				path = filepath.Join(root, "key")
			case "symlink":
				must(t, os.Symlink(root+".key", path))
			case "permissions":
				must(t, os.WriteFile(path, make([]byte, 32), 0644))
			case "short":
				must(t, os.WriteFile(path, []byte("short"), 0600))
			}
			s, err := OpenWithKeyFile(context.Background(), root, path)
			if err == nil {
				s.Close()
				t.Fatal("unsafe key accepted")
			}
		})
	}
}

func TestCredentialRotationCleanupRetry(t *testing.T) {
	root := filepath.Join(t.TempDir(), "data")
	next := root + "-next.key"
	s, err := Open(ctx, root)
	must(t, err)
	must(t, s.SaveCredentials(ctx, fixtureCredentials))
	_, err = s.db.Exec("CREATE TRIGGER interrupt_cleanup BEFORE UPDATE OF cleanup_pending ON credential_encryption WHEN NEW.cleanup_pending=0 BEGIN SELECT RAISE(ABORT,'interrupted cleanup'); END")
	must(t, err)
	if err := s.RotateCredentialKey(ctx, next); err == nil {
		t.Fatal("cleanup should fail")
	}
	assertFixtureCredentials(t, s)
	var pending int
	must(t, s.db.QueryRow("SELECT cleanup_pending FROM credential_encryption").Scan(&pending))
	if pending != 1 {
		t.Fatal("rotation cleanup was not marked pending")
	}
	must(t, s.Close())
	failed, err := Open(ctx, root)
	if err == nil {
		failed.Close()
		t.Fatal("source key opened rotated storage")
	}
	failed, err = OpenWithKeyFile(ctx, root, next)
	if err == nil {
		failed.Close()
		t.Fatal("unfinished cleanup should prevent startup")
	}
	db, err := sql.Open("sqlite", filepath.Join(root, "flora.db"))
	must(t, err)
	_, err = db.Exec("DROP TRIGGER interrupt_cleanup")
	must(t, err)
	must(t, db.Close())
	s, err = OpenWithKeyFile(ctx, root, next)
	must(t, err)
	defer s.Close()
	assertFixtureCredentials(t, s)
	must(t, s.db.QueryRow("SELECT cleanup_pending FROM credential_encryption").Scan(&pending))
	if pending != 0 {
		t.Fatal("rotation cleanup did not finish")
	}
}
