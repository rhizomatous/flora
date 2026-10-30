package redaction

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestJSONRedactsEscapesAndCredentialRepresentations(t *testing.T) {
	secret := "sk-secret-123456"
	input, _ := json.Marshal(map[string]any{secret: []any{"line\n" + secret, base64.StdEncoding.EncodeToString([]byte("opencode:" + secret)), "partial: " + secret[:12]}})
	input = []byte(strings.ReplaceAll(string(input), "sk-secret", `sk\u002dsecret`))
	clean := JSON(input, secret)
	if !json.Valid(clean) || strings.Contains(string(clean), "secret") || strings.Contains(string(clean), "123456") || !strings.Contains(string(clean), "[redacted]") {
		t.Fatalf("unsafe JSON %s", clean)
	}
}

func TestCapabilityFileCannotEscapeRuntimeRoot(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	p, err := store.CreateProject(ctx, "Test", storage.Configuration{Repositories: []storage.Repository{{Name: "core", URL: "https://github.com/example/core", BaseBranch: "main", Role: "core"}}})
	if err != nil {
		t.Fatal(err)
	}
	c, err := store.CreateChat(ctx, p.ID, "Test", "flora@sha256:"+strings.Repeat("a", 64), "1.2.27")
	if err != nil {
		t.Fatal(err)
	}
	paths, _ := store.Paths(ctx, c.ID)
	if err := os.MkdirAll(filepath.Join(paths.RuntimeState, ".config", "gh"), 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(paths.RuntimeState, ".config", "gh", "hosts.yml")
	if err := os.WriteFile(file, []byte("private.test:\n  oauth_token: capability-test-secret\n"), 0600); err != nil {
		t.Fatal(err)
	}
	values := Values(ctx, store, c.ID)
	if len(values) != 1 || values[0] != "capability-test-secret" {
		t.Fatal("missing known capability")
	}
	outside := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(outside, []byte("private.test:\n  oauth_token: outside-secret\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, file); err != nil {
		t.Fatal(err)
	}
	if len(Values(ctx, store, c.ID)) != 0 {
		t.Fatal("followed an agent symlink outside its root")
	}
}
