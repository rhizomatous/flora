package chat

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
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

// Overrides must reach the same acceptance path for scheduled and manual runs.
func TestAutomationExecutionOverrides(t *testing.T) {
	for _, mode := range []string{"new", "same"} {
		t.Run(mode, func(t *testing.T) {
			f := newFixture(t)
			s, _, project := testService(t, f)
			ctx := context.Background()
			s.provisioner.(*testProvisioner).metadata = (&attachmentCatalogTransport{status: 200, body: testModelCatalog}).read
			original := f.server.Config.Handler
			f.server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/provider" {
					io.WriteString(w, testModelCatalog)
					return
				}
				original.ServeHTTP(w, r)
			})
			selected := storage.Execution{Provider: "anthropic", Model: "claude-sonnet-4-6", Variant: "high"}
			if err := s.ValidateAutomationExecution(ctx, &selected); err != nil {
				t.Fatal(err)
			}
			invalid := selected
			invalid.Variant = "unsupported"
			if err := s.ValidateAutomationExecution(ctx, &invalid); err == nil {
				t.Fatal("unsupported reasoning accepted")
			}
			at := time.Now()
			a, err := s.Store.SaveAutomation(ctx, storage.Automation{ProjectID: project.ID, Enabled: true, AutomationConfig: storage.AutomationConfig{
				Name: "Selected model", Instructions: "Check", Mode: mode, Frequency: "daily", Time: "09:00", TimeZone: "UTC", Execution: &selected,
			}}, at)
			if err != nil {
				t.Fatal(err)
			}
			a, err = s.Store.Automation(ctx, a.ID)
			if err != nil || a.Execution == nil || *a.Execution != selected {
				t.Fatalf("saved selection: %+v %v", a, err)
			}
			firstChat := ""
			for _, scheduled := range []bool{false, true} {
				if scheduled {
					selected.Variant = "low"
					a.Execution = &selected
					a, err = s.Store.SaveAutomation(ctx, a, at)
					if err != nil {
						t.Fatal(err)
					}
				}
				due, _ := time.Parse(time.RFC3339, a.NextRun)
				r, err := s.StartAutomation(ctx, a.ID, fmt.Sprint(scheduled), due, scheduled)
				if err != nil || r.Status == "failed" {
					t.Fatalf("start: %+v %v", r, err)
				}
				awaitPrompt(t, f)
				f.release <- false
				waitStatus(t, s, r.ChatID, storage.Idle)
				messages, err := s.Store.Messages(ctx, r.ChatID)
				if err != nil {
					t.Fatal(err)
				}
				matched := false
				for _, m := range messages {
					if m.ID == r.MessageID {
						matched = true
						if storage.MessageExecution(m) != selected {
							t.Fatal("override lost", m)
						}
					}
				}
				if !matched {
					t.Fatal("missing accepted turn")
				}
				if firstChat != "" && (mode == "same") != (firstChat == r.ChatID) {
					t.Fatal("wrong run destination")
				}
				firstChat = r.ChatID
			}
		})
	}
}
