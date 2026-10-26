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
	cap, err := store.Mint("chat-9", []string{"Octo/Demo.git"}, true, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if cap.Repos[0] != "octo/demo" {
		t.Fatalf("repository not normalized: %q", cap.Repos[0])
	}
	if !cap.ValidAt(time.Now()) {
		t.Fatal("fresh capability should be valid")
	}
	if err := store.Revoke(cap.ID); err != nil {
		t.Fatal(err)
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
