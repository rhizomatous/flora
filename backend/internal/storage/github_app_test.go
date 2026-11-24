package storage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGitHubAppEncryptionAndCallbackTransactions(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	s, err := Open(ctx, root)
	must(t, err)
	app := GitHubApp{ID: 12, Slug: "flora", PrivateKey: "private-key-fixture", ClientSecret: "client-secret-fixture", WebhookSecret: "webhook-secret-fixture"}
	must(t, s.BeginGitHubSetup(ctx, "state-fixture", "session-fixture", "manifest", time.Now().Add(time.Hour)))
	if err := s.FinishGitHubSetup(ctx, "state-fixture", "wrong-session", "manifest", app, time.Now()); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := s.GitHubApp(ctx); !errors.Is(err, ErrNotFound) {
		t.Fatal("unbound callback saved app")
	}
	must(t, s.FinishGitHubSetup(ctx, "state-fixture", "session-fixture", "manifest", app, time.Now()))
	if err := s.FinishGitHubSetup(ctx, "state-fixture", "session-fixture", "manifest", app, time.Now()); !errors.Is(err, ErrNotFound) {
		t.Fatal("replayed attempt", err)
	}
	var raw string
	must(t, s.db.QueryRow("SELECT credentials FROM github_app").Scan(&raw))
	if !strings.HasPrefix(raw, "flora:v1:") {
		t.Fatal("unencrypted record")
	}
	for _, secret := range []string{app.PrivateKey, app.ClientSecret, app.WebhookSecret} {
		if strings.Contains(raw, secret) {
			t.Fatal("plaintext secret")
		}
	}
	must(t, s.SaveCredentials(ctx, Credentials{GitHubToken: "github_pat_fixture", Provider: "openai", Model: "model", ProviderKey: "provider-fixture"}))
	destination := filepath.Join(t.TempDir(), "rotated.key")
	must(t, s.RotateCredentialKey(ctx, destination))
	must(t, s.Close())
	s, err = OpenWithKeyFile(ctx, root, destination)
	must(t, err)
	defer s.Close()
	saved, err := s.GitHubApp(ctx)
	must(t, err)
	if saved != app {
		t.Fatal("app lost across rotation/restart")
	}
	rawDB, err := os.ReadFile(filepath.Join(root, "flora.db"))
	must(t, err)
	for _, secret := range []string{app.PrivateKey, app.ClientSecret, app.WebhookSecret} {
		if strings.Contains(string(rawDB), secret) {
			t.Fatal("database contains plaintext app credential")
		}
	}
}
