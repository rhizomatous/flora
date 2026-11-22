package storage

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestExecutionSnapshotsAndRetryAcrossRestart(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	project, legacy := fixture(t, s)
	must(t, s.SaveCredentials(ctx, Credentials{Provider: "anthropic", Model: "default", ProviderKey: "key", GitHubToken: "github"}))
	selected := Execution{Provider: "anthropic", Model: "claude-sonnet-4-6", Variant: "high"}
	c, err := s.CreateChatRequestWithExecution(ctx, project.ID, "Selected", image, "1.2.27", "create", "First", &selected)
	must(t, err)
	first, err := s.AcceptMessageWithExecution(ctx, c.ID, "create", "First", &selected)
	must(t, err)
	if MessageExecution(first.Message) != selected {
		t.Fatal(first)
	}
	changed := selected
	changed.Variant = "low"
	if _, err := s.AcceptMessageWithExecution(ctx, c.ID, "create", "First", &changed); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	if _, err := s.AcceptMessageWithExecution(ctx, c.ID, "active", "Second", &changed); !errors.Is(err, ErrActive) {
		t.Fatal(err)
	}
	must(t, s.CompleteTurn(ctx, c.ID, first.Message.ID, "Done"))
	second, err := s.AcceptMessageWithExecution(ctx, c.ID, "second", "Second", &changed)
	must(t, err)
	must(t, s.CompleteTurn(ctx, c.ID, second.Message.ID, "Done"))
	must(t, s.Close())
	s = openTest(t, root)
	retry, err := s.AcceptMessageWithExecution(ctx, c.ID, "create", "First", &selected)
	must(t, err)
	if !retry.Duplicate || MessageExecution(retry.Message) != selected {
		t.Fatal(retry)
	}
	saved, err := s.Chat(ctx, c.ID)
	must(t, err)
	if saved.Execution != changed {
		t.Fatal(saved.Execution)
	}
	inherited, err := s.AcceptMessage(ctx, c.ID, "inherit", "Third")
	must(t, err)
	if MessageExecution(inherited.Message) != changed {
		t.Fatal(inherited)
	}
	// Old records have no selection and keep their original duplicate semantics.
	old, err := s.AcceptMessage(ctx, legacy.ID, "legacy", "Legacy")
	must(t, err)
	if MessageExecution(old.Message).Model != "default" {
		t.Fatal(old)
	}
	var payload map[string]json.RawMessage
	must(t, json.Unmarshal(old.Message.Payload, &payload))
	delete(payload, "selection")
	delete(payload, "execution")
	raw, _ := json.Marshal(payload)
	_, err = s.db.Exec("UPDATE messages SET payload=? WHERE id=?", string(raw), old.Message.ID)
	must(t, err)
	duplicate, err := s.AcceptMessage(ctx, legacy.ID, "legacy", "Legacy")
	must(t, err)
	if !duplicate.Duplicate {
		t.Fatal(duplicate)
	}
	reported := json.RawMessage(fmt.Sprintf(`{"info":{"id":"reported","role":"assistant","providerID":"anthropic","modelID":"reported-model","time":{"created":%d,"completed":1}},"parts":[{"id":"step","type":"step-finish","cost":0.01,"tokens":{"input":10,"output":5}}]}`, time.Now().UnixMilli()))
	must(t, s.SaveUsageMessage(ctx, c.ID, "runtime", "", first.Message.ID, reported))
	report, err := s.UsageReport(ctx, time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	must(t, err)
	if len(report.Models) != 1 || report.Models[0].ID != "anthropic/reported-model" {
		t.Fatal(report.Models)
	}
	if _, err := s.CreateChatRequestWithExecution(ctx, project.ID, "Selected", image, "1.2.27", "create", "First", &changed); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
}

func TestExecutionUpgradePreservesLegacyRequests(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	project, _ := fixture(t, s)
	must(t, s.SaveCredentials(ctx, Credentials{Provider: "anthropic", Model: "default", ProviderKey: "key", GitHubToken: "github"}))
	c, err := s.CreateChatRequest(ctx, project.ID, "Old chat", image, "1.2.27", "old-create", "Old prompt")
	must(t, err)
	first, err := s.AcceptMessage(ctx, c.ID, "old-create", "Old prompt")
	must(t, err)
	must(t, s.CompleteTurn(ctx, c.ID, first.Message.ID, "Done"))
	_, err = s.db.Exec(`UPDATE messages SET payload='{}' WHERE id=?; DROP TABLE chat_read_state; ALTER TABLE chat_requests DROP COLUMN context_references; ALTER TABLE chat_requests DROP COLUMN branches; ALTER TABLE chats DROP COLUMN execution; ALTER TABLE chat_requests DROP COLUMN selection; PRAGMA user_version=14`, first.Message.ID)
	must(t, err)
	must(t, s.Close())
	s = openTest(t, root)
	defer s.Close()
	retried, err := s.CreateChatRequest(ctx, project.ID, "Old chat", image, "1.2.27", "old-create", "Old prompt")
	must(t, err)
	if retried.ID != c.ID {
		t.Fatal(retried)
	}
	duplicate, err := s.AcceptMessage(ctx, c.ID, "old-create", "Old prompt")
	must(t, err)
	if !duplicate.Duplicate || string(duplicate.Message.Payload) != "{}" {
		t.Fatal(duplicate)
	}
	next, err := s.AcceptMessage(ctx, c.ID, "next", "Next prompt")
	must(t, err)
	if MessageExecution(next.Message).Model != "default" {
		t.Fatal(next)
	}
}
