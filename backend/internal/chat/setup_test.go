package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSetupCaptureGrowthIsBoundedAndFullLogRetained(t *testing.T) {
	f := newFixture(t)
	s, _, p := testService(t, f)
	ctx := context.Background()
	chat, err := s.Store.CreateChat(ctx, p.ID, "Setup", testImage, "1.2.27")
	if err != nil {
		t.Fatal(err)
	}
	paths, err := s.Store.Paths(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(paths.RuntimeState, "setup"), 0700); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(filepath.Join(paths.RuntimeState, "setup", "output.log"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	root, err := os.OpenRoot(paths.RuntimeState)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	capture := setupCapture{store: s.Store, chatID: chat.ID, root: root, paths: paths, remaining: setupProgressBudget}
	var original strings.Builder
	for i := range 80 {
		chunk := fmt.Sprintf("batch %d\n", i) + strings.Repeat("x", 64<<10) + "provider_SECRET\n"
		original.WriteString(chunk)
		if _, err := file.WriteString(chunk); err != nil {
			t.Fatal(err)
		}
		if err := capture.save(ctx, false); err != nil {
			t.Fatal(err)
		}
	}
	if capture.remaining > 0 {
		t.Fatal("growing logs did not exhaust the bounded progress budget")
	}
	if err := os.WriteFile(filepath.Join(paths.RuntimeState, "setup", "exit-status"), []byte("0\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := capture.save(ctx, true); err != nil {
		t.Fatal(err)
	}
	rows, err := s.Store.Activities(ctx, chat.ID, 0, 1000)
	if err != nil {
		t.Fatal(err)
	}
	total, foundFinal := 0, false
	for _, row := range rows {
		if row.Kind != "setup.output" {
			continue
		}
		total += len(row.Payload)
		if len(row.Payload) > 6*setupPreviewBytes+4096 {
			t.Fatal("unbounded preview event")
		}
		if strings.Contains(string(row.Payload), "provider_SECRET") {
			t.Fatal("secret in setup preview")
		}
		var payload struct {
			Final     bool   `json:"final"`
			Available bool   `json:"full_log_available"`
			Omitted   int64  `json:"omitted_bytes"`
			Exit      string `json:"exit_status"`
		}
		if err := json.Unmarshal(row.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if payload.Final {
			foundFinal = payload.Available && payload.Omitted > 0 && payload.Exit == "0"
		}
	}
	if !foundFinal || total > setupProgressBudget+6*setupPreviewBytes+8192 {
		t.Fatalf("capture bounds or final log failed: %d bytes", total)
	}
	full, err := os.ReadFile(filepath.Join(paths.Logs, "setup.log"))
	if err != nil {
		t.Fatal(err)
	}
	if string(full) != strings.ReplaceAll(original.String(), "provider_SECRET", "[redacted]") {
		t.Fatal("full setup output was lost or not redacted")
	}
	if err := os.Remove(filepath.Join(paths.Logs, "setup.log")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(paths.Logs, "setup.log"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := capture.save(ctx, true); err != nil {
		t.Fatal(err)
	}
	rows, _ = s.Store.Activities(ctx, chat.ID, 0, 1000)
	last := string(rows[len(rows)-1].Payload)
	if !strings.Contains(last, `"full_log_available":false`) || !strings.Contains(last, `"log_error"`) {
		t.Fatal("failed full capture silently omitted output")
	}
}
