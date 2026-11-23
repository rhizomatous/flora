package chat

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestCommandDeliveryStopResumeAndRetry(t *testing.T) {
	f := newFixture(t)
	s, _, project := testService(t, f)
	ctx := context.Background()
	c, err := s.Create(ctx, project.ID, "Review", "command", "/review main")
	if err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	f.mu.Lock()
	var delivered runtimeMessage
	_ = json.Unmarshal(f.history[0], &delivered)
	f.mu.Unlock()
	if f.commands.Load() != 1 || len(delivered.Parts) != 1 || delivered.Parts[0].Type != "subtask" || !strings.Contains(delivered.Parts[0].Text, "Runtime expanded review: main") {
		t.Fatal(delivered)
	}
	a, err := s.Submit(ctx, c.ID, "command", "/review main")
	if err != nil || !a.Duplicate || f.prompts.Load() != 1 {
		t.Fatal(a, err)
	}
	if _, err := s.Submit(ctx, c.ID, "active", "/init"); !errors.Is(err, storage.ErrActive) {
		t.Fatal(err)
	}
	if err := s.Stop(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, s, c.ID, storage.Stopped)
	retry, err := s.Submit(ctx, c.ID, "command", "/review main")
	if err != nil || !retry.Duplicate || f.prompts.Load() != 1 {
		t.Fatal(retry, err)
	}
	if _, err := s.Submit(ctx, c.ID, "continue", "/init Use go test"); err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	f.release <- false
	waitStatus(t, s, c.ID, storage.Idle)
	if f.prompts.Load() != 2 || f.sessions.Load() != 1 {
		t.Fatal("replayed work or lost session")
	}
}

func TestUncertainCommandDeliveryNeverResends(t *testing.T) {
	f := newFixture(t)
	f.transportLoss = true
	s, _, project := testService(t, f)
	ctx := context.Background()
	c, err := s.Create(ctx, project.ID, "Review", "command", "/review main")
	if err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	f.release <- false
	waitStatus(t, s, c.ID, storage.Waiting)
	a, err := s.Submit(ctx, c.ID, "command", "/review main")
	if err != nil || !a.Duplicate || f.prompts.Load() != 1 {
		t.Fatal("uncertain command resent", a, err)
	}
	if _, err := s.Submit(ctx, c.ID, "next", "/init"); !errors.Is(err, storage.ErrActive) {
		t.Fatal(err)
	}
}

func TestRuntimeRegistryControlsCommandMeaning(t *testing.T) {
	f := newFixture(t)
	s, p, project := testService(t, f)
	ctx := context.Background()
	items, err := s.Commands(ctx, "")
	if err != nil || len(items) != 3 || p.starts.Load() != 0 || f.sessions.Load() != 0 {
		t.Fatal("discovery started chat work", items, err)
	}
	c, err := s.Create(ctx, project.ID, "Custom command", "custom", "/audit main\nextra instructions")
	if err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	f.release <- false
	waitStatus(t, s, c.ID, storage.Idle)
	saved, err := s.Store.MessageRequest(ctx, c.ID, "custom")
	if err != nil {
		t.Fatal(err)
	}
	command := storage.MessageCommand(saved)
	if command == nil || command.Name != "audit" || command.Arguments != "main\nextra instructions" || command.MessageID != saved.RuntimeMessageID {
		t.Fatal(saved)
	}
	f.mu.Lock()
	f.commandRegistry = json.RawMessage(`[]`)
	f.mu.Unlock()
	a, err := s.Submit(ctx, c.ID, "custom", saved.Text)
	if err != nil || !a.Duplicate || f.commands.Load() != 1 {
		t.Fatal("retry rediscovered or resent command", err)
	}
	a, err = s.Submit(ctx, c.ID, "unknown", "/audit now ordinary text")
	if err != nil || storage.MessageCommand(a.Message) != nil {
		t.Fatal("unknown command did not stay literal", err)
	}
	awaitPrompt(t, f)
	f.release <- false
	waitStatus(t, s, c.ID, storage.Idle)
	if f.commands.Load() != 1 || f.prompts.Load() != 2 {
		t.Fatal("unknown input invoked command endpoint")
	}
}
