package storage

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAuthMigrationFromVersionOne(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "flora.db")
	db, err := sql.Open("sqlite", path)
	must(t, err)
	body, err := migrations.ReadFile("migrations/001_initial.sql")
	must(t, err)
	_, err = db.Exec(string(body) + "; PRAGMA user_version=1")
	must(t, err)
	_, err = db.Exec("INSERT INTO projects VALUES('p','Existing project','{}','earlier')")
	must(t, err)
	must(t, db.Close())
	s, err := Open(context.Background(), root)
	must(t, err)
	var name string
	must(t, s.db.QueryRow("SELECT name FROM projects WHERE id='p'").Scan(&name))
	if name != "Existing project" {
		t.Fatal("migration changed project")
	}
	must(t, s.Bootstrap(ctx, "hash", "token-hash", time.Now().Add(time.Hour)))
	c := Credentials{Provider: "openai", Model: "gpt-test", GitHubToken: "github_pat_secret", ProviderKey: "secret-key"}
	must(t, s.SaveCredentials(ctx, c))
	_, err = s.db.Exec("UPDATE installation_credentials SET model='other'")
	if err == nil {
		t.Fatal("database permitted model change")
	}
	must(t, s.Close())
	s, err = Open(ctx, root)
	must(t, err)
	defer s.Close()
	saved, err := s.Credentials(ctx)
	must(t, err)
	if saved != c {
		t.Fatal("credentials did not persist")
	}
	ok, err := s.SessionValid(ctx, "token-hash", time.Now())
	must(t, err)
	if !ok {
		t.Fatal("session did not persist")
	}
	for _, file := range []string{"flora.db", "flora.db-wal", "flora.db-shm"} {
		info, err := os.Stat(filepath.Join(root, file))
		if os.IsNotExist(err) {
			continue
		}
		must(t, err)
		if info.Mode().Perm()&0077 != 0 {
			t.Fatalf("%s permissions %o", file, info.Mode().Perm())
		}
	}
}

func TestBootstrapRollsBackWhenSessionWriteFails(t *testing.T) {
	s := openTest(t, t.TempDir())
	_, err := s.db.Exec(`CREATE TRIGGER fail_session BEFORE INSERT ON browser_sessions BEGIN SELECT RAISE(ABORT,'injected'); END`)
	must(t, err)
	if err := s.Bootstrap(ctx, "password-hash", "token-hash", time.Now().Add(time.Hour)); err == nil {
		t.Fatal("expected session failure")
	}
	_, err = s.AdministratorHash(ctx)
	wantError(t, err, ErrNotFound)
	_, err = s.db.Exec("DROP TRIGGER fail_session")
	must(t, err)
	must(t, s.Bootstrap(ctx, "password-hash", "token-hash", time.Now().Add(time.Hour)))
}
