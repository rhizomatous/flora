package storage

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestContextSnapshotAcceptanceAndCreationRetry(t *testing.T) {
	ctx := context.Background()
	s, err := Open(ctx, t.TempDir())
	must(t, err)
	defer func() { s.Close() }()
	p, err := s.CreateProject(ctx, "Project", Configuration{Repositories: []Repository{{Name: "flora", URL: "https://github.com/rhizomatous/flora", BaseBranch: "main", Role: "core"}}})
	must(t, err)
	other, err := s.CreateProject(ctx, "Other", Configuration{Repositories: []Repository{{Name: "flora", URL: "https://github.com/rhizomatous/flora", BaseBranch: "main", Role: "core"}}})
	must(t, err)
	ref, err := s.PutContextReference(ctx, p.ID, ContextReference{Kind: "file", Label: "main.go", Source: "owner/repo/main.go", Version: "original", Content: "accepted bytes"})
	must(t, err)
	c, err := s.CreateChatRequestWithContext(ctx, p.ID, "Context", image, "1", "create", "", nil, nil, []string{ref.ID})
	must(t, err)
	a, err := s.AcceptMessageWithContext(ctx, c.ID, "create", "", nil, []string{ref.ID})
	must(t, err)
	var payload struct {
		References []ContextReference `json:"references"`
	}
	must(t, json.Unmarshal(a.Message.Payload, &payload))
	if len(payload.References) != 1 || payload.References[0].Content != "accepted bytes" {
		t.Fatal(string(a.Message.Payload))
	}
	must(t, s.Transition(ctx, c.ID, a.Message.ID, Idle, "Done"))
	must(t, s.Close())
	s, err = Open(ctx, s.root)
	must(t, err)
	again, err := s.AcceptMessageWithContext(ctx, c.ID, "create", "", nil, []string{ref.ID})
	must(t, err)
	if !again.Duplicate || string(a.Message.Payload) != string(again.Message.Payload) {
		t.Fatal("retry changed snapshot")
	}
	_, err = s.AcceptMessageWithContext(ctx, c.ID, "create", "", nil, nil)
	if !errors.Is(err, ErrInvalid) && !errors.Is(err, ErrConflict) {
		t.Fatal("removed references accepted on retry", err)
	}
	_, err = s.CreateChatRequestWithContext(ctx, p.ID, "Context", image, "1", "create", "", nil, nil, nil)
	if !errors.Is(err, ErrInvalid) && !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	_, err = s.CreateChatRequestWithContext(ctx, other.ID, "Wrong project", image, "1", "other", "hello", nil, nil, []string{ref.ID})
	if err == nil {
		t.Fatal("cross-project reference accepted")
	}
	_, err = s.AcceptMessageWithContext(ctx, c.ID, "many", "hello", nil, []string{ref.ID, ref.ID})
	if err == nil {
		t.Fatal("duplicate reference accepted")
	}
	_, err = s.PutContextReference(ctx, p.ID, ContextReference{Content: strings.Repeat("x", MaxReferenceBytes+1)})
	if err == nil {
		t.Fatal("oversized snapshot saved")
	}
}
