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

func legacySecrets(t *testing.T) (string, *sql.DB) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "data")
	must(t, os.Mkdir(root, 0700))
	db, err := sql.Open("sqlite", filepath.Join(root, "flora.db"))
	must(t, err)
	entries, err := migrations.ReadDir("migrations")
	must(t, err)
	for _, entry := range entries[:len(entries)-1] {
		body, err := migrations.ReadFile("migrations/" + entry.Name())
		must(t, err)
		_, err = db.Exec(string(body))
		must(t, err)
	}
	// Use the actual preceding version as duplicate numeric migration prefixes
	// are ordered by filename, just as they are in the storage opener.
	_, err = db.Exec("PRAGMA user_version=" + fmt.Sprint(len(entries)-1))
	must(t, err)
	c := fixtureCredentials
	_, err = db.Exec("INSERT INTO installation_credentials VALUES(1,?,?,?,?)", c.Provider, c.Model, c.GitHubToken, c.ProviderKey)
	must(t, err)
	return root, db
}

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

func TestCredentialMigrationRetryAndRemnants(t *testing.T) {
	root, db := legacySecrets(t)
	_, err := db.Exec("PRAGMA secure_delete=OFF; CREATE TABLE discarded(value TEXT)")
	must(t, err)
	_, err = db.Exec("INSERT INTO discarded VALUES(?)", strings.Repeat(fixtureCredentials.ProviderKey, 4096))
	must(t, err)
	_, err = db.Exec("DROP TABLE discarded")
	must(t, err)
	var free int
	must(t, db.QueryRow("PRAGMA freelist_count").Scan(&free))
	if free == 0 {
		t.Fatal("fixture did not leave free pages")
	}
	// Fail after the credential UPDATE, before the marker commits.
	_, err = db.Exec("CREATE TABLE credential_encryption(id INTEGER PRIMARY KEY,verifier TEXT NOT NULL,cleanup_pending INTEGER NOT NULL); CREATE TRIGGER fail_encryption BEFORE INSERT ON credential_encryption BEGIN SELECT RAISE(ABORT,'injected interruption'); END")
	must(t, err)
	must(t, db.Close())
	s, err := Open(ctx, root)
	if err == nil {
		s.Close()
		t.Fatal("migration should fail")
	}
	db, err = sql.Open("sqlite", filepath.Join(root, "flora.db"))
	must(t, err)
	var saved string
	must(t, db.QueryRow("SELECT github_token FROM installation_credentials").Scan(&saved))
	if saved != fixtureCredentials.GitHubToken {
		t.Fatal("failed conversion lost original")
	}
	var count int
	must(t, db.QueryRow("SELECT count(*) FROM credential_encryption").Scan(&count))
	if count != 0 {
		t.Fatal("failed conversion advanced marker")
	}
	_, err = db.Exec("DROP TRIGGER fail_encryption")
	must(t, err)
	must(t, db.Close())
	s, err = Open(ctx, root)
	must(t, err)
	assertFixtureCredentials(t, s)
	assertEncryptedRecords(t, s)
	must(t, s.db.QueryRow("PRAGMA freelist_count").Scan(&free))
	if free != 0 {
		t.Fatal("migration did not compact free pages")
	}
	// A committed conversion with unfinished cleanup is safe to repeat on reopen.
	_, err = s.db.Exec("UPDATE credential_encryption SET cleanup_pending=1")
	must(t, err)
	must(t, s.Close())
	s, err = Open(ctx, root)
	must(t, err)
	assertFixtureCredentials(t, s)
	var pending int
	must(t, s.db.QueryRow("SELECT cleanup_pending FROM credential_encryption").Scan(&pending))
	if pending != 0 {
		t.Fatal("cleanup was not retried")
	}
	must(t, s.Close())
	for _, name := range []string{"flora.db", "flora.db-wal", "flora.db-journal"} {
		raw, err := os.ReadFile(filepath.Join(root, name))
		if os.IsNotExist(err) {
			continue
		}
		must(t, err)
		if bytes.Contains(raw, []byte(fixtureCredentials.GitHubToken)) || bytes.Contains(raw, []byte(fixtureCredentials.ProviderKey)) {
			t.Fatalf("fixture plaintext remains in %s", name)
		}
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

func TestCredentialCleanupFailureAfterCommit(t *testing.T) {
	root, db := legacySecrets(t)
	_, err := db.Exec("CREATE TABLE credential_encryption(id INTEGER PRIMARY KEY,verifier TEXT NOT NULL,cleanup_pending INTEGER NOT NULL); CREATE TRIGGER interrupt_cleanup BEFORE UPDATE OF cleanup_pending ON credential_encryption WHEN NEW.cleanup_pending=0 BEGIN SELECT RAISE(ABORT,'interrupted cleanup'); END")
	must(t, err)
	must(t, db.Close())
	failed, err := Open(ctx, root)
	if err == nil {
		failed.Close()
		t.Fatal("cleanup failure should prevent startup")
	}
	db, err = sql.Open("sqlite", filepath.Join(root, "flora.db"))
	must(t, err)
	var token string
	var pending int
	must(t, db.QueryRow("SELECT github_token FROM installation_credentials").Scan(&token))
	must(t, db.QueryRow("SELECT cleanup_pending FROM credential_encryption").Scan(&pending))
	if !strings.HasPrefix(token, "flora:v1:") || pending != 1 {
		t.Fatal("committed encryption was not retained for cleanup retry")
	}
	_, err = db.Exec("DROP TRIGGER interrupt_cleanup")
	must(t, err)
	must(t, db.Close())
	s, err := Open(ctx, root)
	must(t, err)
	defer s.Close()
	assertFixtureCredentials(t, s)
	must(t, s.db.QueryRow("SELECT cleanup_pending FROM credential_encryption").Scan(&pending))
	if pending != 0 {
		t.Fatal("cleanup did not finish")
	}
}
