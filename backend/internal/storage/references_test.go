package storage

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestReferenceSubmissionUsesExistingMessageIdentity(t *testing.T) {
	ctx := context.Background()
	s, err := Open(ctx, t.TempDir())
	must(t, err)
	defer s.Close()
	p, err := s.CreateProject(ctx, "Project", Configuration{Repositories: []Repository{{Name: "owner/repo", URL: "https://github.com/owner/repo", BaseBranch: "main", Role: "core"}}})
	must(t, err)
	source, err := s.CreateChat(ctx, p.ID, "Source", image, "1")
	must(t, err)
	refs := []ContextReference{{Kind: "chat", Label: source.Title, ChatID: source.ID}, {Kind: "pr", Label: "#42", Repository: "owner/repo", Number: 42}}
	c, err := s.CreateChatRequestWithContext(ctx, p.ID, "References", image, "1", "create", "Review", nil, nil, refs)
	must(t, err)
	a, err := s.AcceptMessageWithContext(ctx, c.ID, "create", "Review", nil, refs)
	must(t, err)
	if !strings.Contains(string(a.Message.Payload), source.ID) || strings.Contains(string(a.Message.Payload), "content") {
		t.Fatal(string(a.Message.Payload))
	}
	again, err := s.AcceptMessageWithContext(ctx, c.ID, "create", "Review", nil, refs)
	must(t, err)
	if !again.Duplicate || again.Message.ID != a.Message.ID {
		t.Fatal("duplicate message")
	}
	changed := append([]ContextReference{}, refs...)
	changed[0].ChatID = "missing"
	_, err = s.AcceptMessageWithContext(ctx, c.ID, "create", "Review", nil, changed)
	if !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	retry, err := s.CreateChatRequestWithContext(ctx, p.ID, "References", image, "1", "create", "Review", nil, nil, refs)
	must(t, err)
	if retry.ID != c.ID {
		t.Fatal("duplicate chat")
	}
	_, err = s.CreateChatRequestWithContext(ctx, p.ID, "References", image, "1", "create", "Review", nil, nil, changed)
	if !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	_, err = s.CreateChatRequestWithContext(ctx, p.ID, "Files", image, "1", "new-file", "Review", nil, nil, []ContextReference{{Kind: "file", Label: "task", Repository: "owner/repo", Path: "task.txt"}})
	if err == nil {
		t.Fatal("new chat accepted unavailable file")
	}
	var payload map[string]any
	must(t, json.Unmarshal(a.Message.Payload, &payload))
	if _, ok := payload["references"]; !ok {
		t.Fatal("missing reference metadata")
	}
}
