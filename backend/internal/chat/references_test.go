package chat

import (
	"context"
	"encoding/json"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"strings"
	"testing"
)

func TestRuntimeReferencesContainPointersOnly(t *testing.T) {
	refs := []storage.ContextReference{{Kind: "file", Label: "main.go", Repository: "owner/repo", Path: "main.go"}, {Kind: "chat", Label: "Source", ChatID: "source-chat"}, {Kind: "pr", Label: "#42", Repository: "owner/repo", Number: 42}}
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	project, err := store.CreateProject(ctx, "Project", storage.Configuration{Repositories: []storage.Repository{{Name: "owner/repo", URL: "https://github.com/owner/repo", Role: "core", BaseBranch: "main"}}})
	if err != nil {
		t.Fatal(err)
	}
	c, err := store.CreateChat(ctx, project.ID, "Chat", "flora@sha256:"+strings.Repeat("a", 64), "1")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{"references": refs})
	parts, err := (&Service{Store: store}).runtimeParts(context.Background(), nil, storage.Message{ChatID: c.ID, Text: "Review", Payload: raw}, storage.Credentials{})
	if err != nil || len(parts) != 4 {
		t.Fatal(parts, err)
	}
	if !strings.Contains(parts[1]["text"], "/workspace/main.go") || !strings.Contains(parts[2]["text"], "gh api /flora/chats/source-chat") || !strings.Contains(parts[3]["text"], "https://github.com/owner/repo/pull/42") {
		t.Fatal(parts)
	}
}
