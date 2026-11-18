package storage

import (
	"errors"
	"strings"
	"sync"
	"testing"
)

func TestChatRequestUpgradeAndReopen(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	p, original := fixture(t, s)
	_, err := s.db.Exec("ALTER TABLE chats DROP COLUMN execution; ALTER TABLE chat_requests DROP COLUMN selection; DROP TABLE attachments; ALTER TABLE chat_requests DROP COLUMN attachments; ALTER TABLE chats DROP COLUMN pinned_at; ALTER TABLE chats DROP COLUMN archived; ALTER TABLE chats DROP COLUMN organization_revision; DROP TABLE subagent_messages; DROP TABLE subagents; DROP TABLE automation_runs; DROP TABLE automations; DROP TABLE context_limits; DROP TABLE usage_steps; DROP TABLE usage_messages; DROP TABLE usage_capture; DROP TABLE installation_settings; DROP TABLE chat_requests; PRAGMA user_version=3")
	must(t, err)
	must(t, s.Close())
	s = openTest(t, root)
	c, err := s.CreateChatRequest(ctx, p.ID, "Chat", image, "1.2.27", "request", "First")
	must(t, err)
	must(t, s.Close())
	s = openTest(t, root)
	retry, err := s.CreateChatRequest(ctx, p.ID, "Chat", image, "1.2.27", "request", "First")
	must(t, err)
	if retry.ID != c.ID {
		t.Fatal("lost creation deduplication")
	}
	if _, err := s.CreateChatRequest(ctx, p.ID, "Chat", image, "1.2.27", "request", "Changed"); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	if _, err := s.Chat(ctx, original.ID); err != nil {
		t.Fatal("migration lost existing chat")
	}
	chats, err := s.Chats(ctx)
	must(t, err)
	if len(chats) != 2 {
		t.Fatal("duplicate chat")
	}
	if _, err := s.CreateChatRequest(ctx, p.ID, "Chat", image, "1.2.27", "too-large", strings.Repeat("🌸", 32769)); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
}

func TestChatOrganizationPersistsWithoutChangingExecution(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	p, c := fixture(t, s)
	original, err := s.CreateChatRequest(ctx, p.ID, "Original", image, "1.2.27", "create", "Prompt")
	must(t, err)
	active, err := s.AcceptMessage(ctx, original.ID, "create", "Prompt")
	must(t, err)
	title, yes, no, revision := "A useful title", true, false, int64(0)
	renamed, err := s.OrganizeChat(ctx, original.ID, ChatOrganization{Title: &title, Pinned: &yes, Revision: &revision})
	must(t, err)
	if renamed.PinnedAt == "" || renamed.Status != Working || renamed.ActiveMessageID != active.Message.ID {
		t.Fatal(renamed)
	}
	// A retried creation must return the renamed chat without replacing its title.
	retry, err := s.CreateChatRequest(ctx, p.ID, "Original", image, "1.2.27", "create", "Prompt")
	must(t, err)
	if retry.Title != title {
		t.Fatal(retry)
	}
	if _, err := s.OrganizeChat(ctx, original.ID, ChatOrganization{Title: &title, Revision: &revision}); !errors.Is(err, ErrStale) {
		t.Fatal(err)
	}
	revision = renamed.OrganizationRevision
	archived, err := s.OrganizeChat(ctx, original.ID, ChatOrganization{Archived: &yes, Revision: &revision})
	must(t, err)
	if !archived.Archived || archived.PinnedAt != "" || archived.Status != Working || archived.ActiveMessageID != active.Message.ID {
		t.Fatal(archived)
	}
	must(t, s.SaveRuntimeMessage(ctx, "runtime-update", Message{ChatID: original.ID, RuntimeMessageID: "assistant", Role: "assistant", Text: "Still working", Payload: []byte(`{"parts":[]}`)}))
	must(t, s.CompleteTurn(ctx, original.ID, active.Message.ID, "Done"))
	must(t, s.Close())
	s = openTest(t, root)
	saved, err := s.Chat(ctx, original.ID)
	must(t, err)
	if saved.Title != title || !saved.Archived || saved.Status != Idle || saved.OrganizationRevision != archived.OrganizationRevision {
		t.Fatal(saved)
	}
	messages, err := s.Messages(ctx, original.ID)
	must(t, err)
	if len(messages) != 2 {
		t.Fatal(messages)
	}
	chats, err := s.Chats(ctx)
	must(t, err)
	if len(chats) != 2 {
		t.Fatal(chats)
	}
	revision = saved.OrganizationRevision
	if _, err := s.OrganizeChat(ctx, original.ID, ChatOrganization{Pinned: &yes, Revision: &revision}); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	restored, err := s.OrganizeChat(ctx, original.ID, ChatOrganization{Archived: &no, Revision: &revision})
	must(t, err)
	if restored.Archived || restored.PinnedAt != "" {
		t.Fatal(restored)
	}
	for _, bad := range []string{"", "  ", strings.Repeat("🌸", 51), string([]byte{255})} {
		revision = restored.OrganizationRevision
		if _, err := s.OrganizeChat(ctx, c.ID, ChatOrganization{Title: &bad, Revision: &revision}); !errors.Is(err, ErrInvalid) {
			t.Fatal(err)
		}
	}
}

func TestArchivedAutomationChatContinues(t *testing.T) {
	s := openTest(t, t.TempDir())
	p, c := fixture(t, s)
	at := instant(t, "2026-11-15T14:00:00Z")
	a, err := s.SaveAutomation(ctx, Automation{AutomationConfig: automationConfig(), ProjectID: p.ID, Enabled: true}, at)
	must(t, err)
	_, run, claimed, err := s.ClaimAutomation(ctx, a.ID, "first", at, false)
	must(t, err)
	if !claimed {
		t.Fatal(run)
	}
	accepted, err := s.AcceptMessage(ctx, c.ID, run.ID, a.Instructions)
	must(t, err)
	must(t, s.BindAutomationChat(ctx, a, c.ID))
	yes, revision := true, int64(0)
	_, err = s.OrganizeChat(ctx, c.ID, ChatOrganization{Archived: &yes, Revision: &revision})
	must(t, err)
	must(t, s.CompleteTurn(ctx, c.ID, accepted.Message.ID, "Done"))
	saved, err := s.Automation(ctx, a.ID)
	must(t, err)
	if !saved.Enabled || saved.ChatID != c.ID || saved.NextRun != a.NextRun {
		t.Fatal(saved)
	}
	nextAutomation, next, claimed, err := s.ClaimAutomation(ctx, a.ID, "next", at, false)
	must(t, err)
	if !claimed || nextAutomation.ChatID != c.ID {
		t.Fatal(next)
	}
	continued, err := s.AcceptMessage(ctx, c.ID, next.ID, a.Instructions)
	must(t, err)
	savedChat, err := s.Chat(ctx, c.ID)
	must(t, err)
	if !savedChat.Archived || savedChat.ActiveMessageID != continued.Message.ID {
		t.Fatal(savedChat)
	}
}

func TestConcurrentChatRenamesRejectStaleEdits(t *testing.T) {
	s := openTest(t, t.TempDir())
	_, c := fixture(t, s)
	var wg sync.WaitGroup
	outcomes := make(chan error, 2)
	for _, name := range []string{"First title", "Second title"} {
		wg.Go(func() {
			revision := int64(0)
			_, err := s.OrganizeChat(ctx, c.ID, ChatOrganization{Title: &name, Revision: &revision})
			outcomes <- err
		})
	}
	wg.Wait()
	close(outcomes)
	successes, conflicts := 0, 0
	for err := range outcomes {
		if err == nil {
			successes++
		} else if errors.Is(err, ErrStale) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("%d successes, %d conflicts", successes, conflicts)
	}
	saved, err := s.Chat(ctx, c.ID)
	must(t, err)
	if saved.OrganizationRevision != 1 {
		t.Fatal(saved)
	}
}
