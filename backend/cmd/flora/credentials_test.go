//go:build linux

package main

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestCredentialMaintenanceUsesDeploymentLock(t *testing.T) {
	root := filepath.Join(t.TempDir(), "data")
	ctx := context.Background()
	store, unlock, err := openCredentialStore(ctx, root, root+".key")
	if err != nil {
		t.Fatal(err)
	}
	c := storage.Credentials{Provider: "anthropic", Model: "fixture", GitHubToken: "github_pat_fixture", ProviderKey: "fixture-provider-key"}
	if err := store.SaveCredentials(ctx, c); err != nil {
		t.Fatal(err)
	}
	other, release, err := openCredentialStore(ctx, root, root+".key")
	if err == nil {
		other.Close()
		release()
		t.Fatal("second process opened storage during maintenance")
	}
	if err := store.RotateCredentialKey(ctx, root+".key"); err == nil {
		t.Fatal("rotation accepted the source key")
	}
	next := filepath.Join(filepath.Dir(root), "next.key")
	if err := store.RotateCredentialKey(ctx, next); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	unlock()
	store, unlock, err = openCredentialStore(ctx, root, next)
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	defer store.Close()
	saved, err := store.Credentials(ctx)
	if err != nil || saved != c {
		t.Fatal("rotated fixture credentials did not reopen")
	}
}
