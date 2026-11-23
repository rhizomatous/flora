package chat

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestAutomationEnvironmentAndSetupRedaction(t *testing.T) {
	f := newFixture(t)
	s, _, project := testService(t, f)
	ctx := context.Background()
	const secret = "fixture_automation_environment_124"
	if err := s.Store.SaveEnvironment(ctx, "installation", "", []storage.EnvironmentChange{{Name: "SERVICE_TOKEN", Action: "replace", Value: secret, Secret: true}, {Name: "REGION", Action: "set", Value: "installation"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.Store.SaveEnvironment(ctx, "project", project.ID, []storage.EnvironmentChange{{Name: "REGION", Action: "set", Value: "project"}}); err != nil {
		t.Fatal(err)
	}
	a, err := s.Store.SaveAutomation(ctx, storage.Automation{ProjectID: project.ID, Enabled: false, AutomationConfig: storage.AutomationConfig{Name: "Environment", Instructions: "Check", Mode: "same", Frequency: "daily", Time: "09:00", TimeZone: "UTC"}}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.StartAutomation(ctx, a.ID, "environment-first", time.Now(), false)
	if err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	f.release <- false
	waitStatus(t, s, run.ChatID, storage.Idle)
	env, _, err := s.Store.RuntimeEnvironment(ctx, run.ChatID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(env, "\n") != "REGION=project\nSERVICE_TOKEN="+secret {
		t.Fatal("automation missed effective defaults")
	}
	paths, err := s.Store.Paths(ctx, run.ChatID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(paths.RuntimeState, "setup"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(paths.RuntimeState, "setup", "output.log"), []byte("setup "+secret+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(paths.RuntimeState, "setup", "exit-status"), []byte("23"), 0600); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(paths.RuntimeState)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	capture := setupCapture{store: s.Store, chatID: run.ChatID, root: root, paths: paths, remaining: setupProgressBudget}
	if err := capture.save(ctx, true); err != nil {
		t.Fatal(err)
	}
	log, err := os.ReadFile(filepath.Join(paths.Logs, "setup.log"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(log), secret) || !strings.Contains(string(log), "[redacted]") {
		t.Fatal("complete setup log exposed environment secret")
	}
	rows, err := s.Store.Activities(ctx, run.ChatID, 0, 1000)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if strings.Contains(string(row.Payload), secret) {
			t.Fatal("setup preview exposed environment secret")
		}
	}
	if err := s.Store.SaveEnvironment(ctx, "installation", "", []storage.EnvironmentChange{{Name: "SERVICE_TOKEN", Action: "remove", Secret: true}}); err != nil {
		t.Fatal(err)
	}
	next, err := s.StartAutomation(ctx, a.ID, "environment-second", time.Now(), false)
	if err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	f.release <- false
	waitStatus(t, s, next.ChatID, storage.Idle)
	if next.ChatID != run.ChatID {
		t.Fatal("same-chat automation lost snapshot")
	}
	_, secrets, err := s.Store.RuntimeEnvironment(ctx, next.ChatID)
	if err != nil || len(secrets) != 1 || secrets[0] != secret {
		t.Fatal("automation reused changed defaults")
	}
	a.Mode = "new"
	a.ID = ""
	a.ChatID = ""
	a, err = s.Store.SaveAutomation(ctx, a, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	fresh, err := s.StartAutomation(ctx, a.ID, "environment-new", time.Now(), false)
	if err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	f.release <- false
	waitStatus(t, s, fresh.ChatID, storage.Idle)
	_, secrets, err = s.Store.RuntimeEnvironment(ctx, fresh.ChatID)
	if err != nil || len(secrets) != 0 {
		t.Fatal("new-chat automation missed changed defaults")
	}
}
