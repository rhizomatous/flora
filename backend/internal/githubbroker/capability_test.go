package githubbroker

import (
	"bytes"
	"os"
	"testing"
	"time"
)

// TestStoreMintRevokePersistence checks that capabilities and revocations
// survive a store reload, and that the on-disk file holds only
// container-side capabilities (never the administrator token).
func TestStoreMintRevokePersistence(t *testing.T) {
	path := t.TempDir() + "/capabilities.json"
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	cap, err := store.Mint("chat-9", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if !cap.ValidAt(time.Now()) {
		t.Fatal("fresh capability should be valid")
	}
	// A separately opened broker store observes CLI-style external revocation.
	watcher, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Revoke(cap.ID); err != nil {
		t.Fatal(err)
	}
	if got, ok := watcher.Lookup(cap.ID); !ok || !got.Revoked {
		t.Fatal("running broker did not observe external revocation")
	}
	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := reopened.Lookup(cap.ID)
	if !ok {
		t.Fatal("capability lost across reload")
	}
	if !got.Revoked {
		t.Fatal("revocation lost across reload")
	}
	if got.ValidAt(time.Now()) {
		t.Fatal("revoked capability still valid")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	const adminToken = "admin-fine-grained-token-TESTONLY"
	if bytes.Contains(data, []byte(adminToken)) {
		t.Fatal("capability store must never contain the administrator token")
	}
}

func TestObsoleteScopeSettingsRejected(t *testing.T) {
	path := t.TempDir() + "/capabilities.json"
	if err := os.WriteFile(path, []byte(`{"capabilities":[{"id":"old","repos":["octo/demo"],"write":false}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenStore(path); err == nil {
		t.Fatal("old scope settings silently accepted")
	}
}
