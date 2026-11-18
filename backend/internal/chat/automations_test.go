package chat

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestAutomationReleasesCompletedChatAndResumes(t *testing.T) {
	f := newFixture(t)
	s, p, project := testService(t, f)
	ctx := context.Background()
	a, err := s.Store.SaveAutomation(ctx, storage.Automation{ProjectID: project.ID, Enabled: false, AutomationConfig: storage.AutomationConfig{Name: "Daily check", Instructions: "Check the repository", Mode: "same", Frequency: "daily", Time: "09:00", TimeZone: "UTC"}}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.StartAutomation(ctx, a.ID, "first", time.Now(), false)
	if err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	overlap, err := s.StartAutomation(ctx, a.ID, "overlap", time.Now(), false)
	if err != nil || overlap.Status != "skipped" {
		t.Fatalf("overlap: %+v %v", overlap, err)
	}
	f.release <- false
	waitStatus(t, s, r.ChatID, storage.Idle)
	// A live lease defers cleanup, including saving the completed workspace.
	until := time.Now().Add(time.Hour)
	if err := s.Store.SetRuntimeLease(ctx, r.ChatID, until); err != nil {
		t.Fatal(err)
	}
	saved := false
	s.AutomationBeforeStop = func(context.Context, string) error { saved = true; return nil }
	if err := s.TickAutomations(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	if saved {
		t.Fatal("automation cleanup ignored keep-awake")
	}
	if err := s.Store.SetRuntimeLease(ctx, r.ChatID, time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := s.enforceLeases(ctx); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, s, r.ChatID, storage.Idle)
	// A failed diff capture must retain the container for a later attempt.
	s.AutomationBeforeStop = func(context.Context, string) error { return errors.New("capture failed") }
	if err := s.TickAutomations(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, s, r.ChatID, storage.Idle)
	captured := false
	s.AutomationBeforeStop = func(context.Context, string) error { captured = true; return nil }
	if err := s.TickAutomations(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	if !captured {
		t.Fatal("did not save changes")
	}
	waitStatus(t, s, r.ChatID, storage.Stopped)
	next, err := s.StartAutomation(ctx, a.ID, "second", time.Now(), false)
	if err != nil {
		t.Fatal(err)
	}
	if next.ChatID != r.ChatID {
		t.Fatal("lost standing chat")
	}
	awaitPrompt(t, f)
	f.release <- false
	waitStatus(t, s, r.ChatID, storage.Idle)
	if p.starts.Load() != 2 {
		t.Fatal("did not resume stopped container")
	}
	// A user follow-up arriving before cleanup must keep its container available.
	if _, err := s.Submit(ctx, r.ChatID, "followup", "Explain the result"); err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	f.release <- false
	waitStatus(t, s, r.ChatID, storage.Idle)
	captured = false
	if err := s.TickAutomations(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	if captured {
		t.Fatal("cleanup adopted user work")
	}
	waitStatus(t, s, r.ChatID, storage.Idle)
}

func TestScheduledAutomationStartsOnce(t *testing.T) {
	f := newFixture(t)
	s, _, project := testService(t, f)
	ctx := context.Background()
	at := time.Date(2026, 11, 15, 9, 0, 0, 0, time.UTC)
	a, err := s.Store.SaveAutomation(ctx, storage.Automation{ProjectID: project.ID, Enabled: true, AutomationConfig: storage.AutomationConfig{Name: "Scheduled check", Instructions: "Check the repository", Mode: "new", Frequency: "daily", Time: "09:00", TimeZone: "UTC"}}, at)
	if err != nil {
		t.Fatal(err)
	}
	due, err := time.Parse(time.RFC3339, a.NextRun)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.TickAutomations(ctx, due); err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	if err := s.TickAutomations(ctx, due); err != nil {
		t.Fatal(err)
	}
	runs, err := s.Store.AutomationRuns(ctx, a.ID)
	if err != nil || len(runs) != 1 || runs[0].ChatID == "" {
		t.Fatalf("runs: %+v %v", runs, err)
	}
	f.release <- false
	waitStatus(t, s, runs[0].ChatID, storage.Idle)
}
