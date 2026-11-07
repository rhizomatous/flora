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

func TestJSONPreservesLargeMetadataNumbers(t *testing.T) {
	input := json.RawMessage(`{"identifier":9007199254740993,"value":"secret-value"}`)
	clean := JSON(input, "secret-value")
	if !strings.Contains(string(clean), "9007199254740993") {
		t.Fatal("metadata lost numeric precision")
	}
}

func TestTailMasksBothCutBoundariesBeforeAndAfterShrinkage(t *testing.T) {
	secret := "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabc"
	if len(secret) != 39 {
		t.Fatal("invalid fixture length")
	}
	for _, form := range []string{secret, base64.StdEncoding.EncodeToString([]byte("opencode:" + secret))} {
		t.Run(form[:4], func(t *testing.T) {
			// A raw window starts inside a credential. Redacting subsequent full
			// copies shrinks it enough that final trimming alone cannot hide it.
			window := form[19:] + strings.Repeat(form+"\n", 800) + "ordinary ending\n" + form[:20]
			got := Tail(window, 32<<10, secret)
			want := "[redacted]" + strings.Repeat("[redacted]\n", 800) + "ordinary ending\n[redacted]"
			if got != want || len(got) > 32<<10 {
				t.Fatal("cut-boundary credential survived shrinking replacements")
			}
			// Final trimming can also expose an internal credential suffix that
			// was not at either boundary of the original window.
			input := "ordinary beginning\n" + form[19:] + " visible"
			got = Tail(input, len(form)-19+len(" visible"), secret)
			if got != "[redacted] visible" {
				t.Fatal("final trim introduced an unmasked credential suffix")
			}
		})
	}
}

func TestTailPreservesOrdinaryTextAndByteBound(t *testing.T) {
	secret := "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabc"
	for n := 1; n < len(secret); n++ {
		for _, fragment := range []string{secret[:n], secret[len(secret)-n:]} {
			got := Tail(fragment, len(fragment), secret)
			if len(got) > len(fragment) {
				t.Fatal("boundary masking expanded a bounded window")
			}
			if n >= 8 && got == fragment {
				t.Fatal("substantial boundary fragment was not hidden")
			}
			if n < 8 && got != fragment {
				t.Fatal("short coincidental text was removed")
			}
		}
	}
	text := "plain text with a newline\n"
	if got := Tail(text, 17, secret); got != text[len(text)-17:] {
		t.Fatal("ordinary output changed")
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
