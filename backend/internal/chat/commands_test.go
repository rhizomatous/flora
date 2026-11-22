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
	if len(delivered.Parts) != 1 || !strings.Contains(delivered.Parts[0].Text, "Review target: main") {
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
