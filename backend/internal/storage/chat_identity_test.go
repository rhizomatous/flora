package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPublicChatIDsConcurrentCreationAndRetry(t *testing.T) {
	root := t.TempDir()
	first := openTest(t, root)
	p, original := fixture(t, first)
	second := openTest(t, root)
	results := make(chan Chat, 48)
	failures := make(chan error, 48)
	var wg sync.WaitGroup
	for n := range 48 {
		wg.Go(func() {
			store := first
			if n%2 == 0 {
				store = second
			}
			request := fmt.Sprintf("request-%d", n/2)
			c, err := store.CreateChatRequest(ctx, p.ID, "Concurrent", image, "1", request, "Prompt")
			if err != nil {
				failures <- err
				return
			}
			results <- c
		})
	}
	wg.Wait()
	close(results)
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	ids := map[string]string{original.PublicID: original.ID}
	for c := range results {
		if c.PublicID == "" {
			t.Fatal("missing public ID")
		}
		if old, exists := ids[c.PublicID]; exists && old != c.ID {
			t.Fatal("duplicate public ID")
		}
		ids[c.PublicID] = c.ID
		byPublic, err := second.Chat(ctx, c.PublicID)
		must(t, err)
		if byPublic.ID != c.ID {
			t.Fatal("public reference changed internal key")
		}
	}
	if len(ids) != 25 {
		t.Fatalf("got %d identities, want 25", len(ids))
	}
	_, err := first.CreateChatRequest(ctx, p.ID, "Changed", image, "1", "request-0", "Prompt")
	wantError(t, err, ErrConflict)
	otherProject, _ := fixture(t, first)
	crossProject, err := first.CreateChat(ctx, otherProject.ID, "Another project", image, "1")
	must(t, err)
	if _, exists := ids[crossProject.PublicID]; exists {
		t.Fatal("project reused ID")
	}
	_, err = first.db.Exec("UPDATE chat_public_ids SET number=10000 WHERE chat_id=?", original.ID)
	if err == nil {
		t.Fatal("public ID can change")
	}
	_, err = first.db.Exec("DELETE FROM chat_public_ids WHERE chat_id=?", original.ID)
	if err == nil {
		t.Fatal("public ID can be removed")
	}
	must(t, first.Close())
	must(t, second.Close())
	reopened := openTest(t, root)
	for public, internal := range ids {
		c, err := reopened.Chat(ctx, public)
		must(t, err)
		if c.ID != internal || c.PublicID != public {
			t.Fatal("identity changed on reopen")
		}
	}
}

func TestPublicChatIDBackfillPreservesRecordsAndPaths(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	p, _ := fixture(t, s)
	attachment, err := s.PutAttachment(ctx, p.ID, "saved-attachment", "notes.txt", []byte("Saved attachment"))
	must(t, err)
	c, err := s.CreateChatRequest(ctx, p.ID, "Existing", image, "1", "legacy-request", "Original prompt", attachment.ID)
	must(t, err)
	accepted, err := s.AcceptMessage(ctx, c.ID, "legacy-request", "Original prompt", attachment.ID)
	must(t, err)
	must(t, s.BindRuntime(ctx, c.ID, "saved-container", "saved-session"))
	must(t, s.RecordStartingCommit(ctx, c.ID, "flora", strings.Repeat("a", 40)))
	folder, err := s.SaveFolder(ctx, ChatFolder{Name: "Saved folder"})
	must(t, err)
	pin := true
	revision := int64(0)
	c, err = s.OrganizeChat(ctx, c.ID, ChatOrganization{FolderID: &folder.ID, Pinned: &pin, Revision: &revision})
	must(t, err)
	_, err = s.MarkChatsRead(ctx, []ViewedRevision{{ChatID: c.ID, Revision: c.ActivityRevision}})
	must(t, err)
	automation, err := s.SaveAutomation(ctx, Automation{ProjectID: p.ID, AutomationConfig: AutomationConfig{Name: "Saved automation", Instructions: "Review", Mode: "same", Frequency: "daily", Time: "09:00", TimeZone: "UTC"}}, time.Now())
	must(t, err)
	must(t, s.BindAutomationChat(ctx, automation, c.ID))
	_, run, _, err := s.ClaimAutomation(ctx, automation.ID, "saved-run", time.Now(), false)
	must(t, err)
	must(t, s.SetAutomationRun(ctx, run.ID, "complete", "Saved", c.ID))
	must(t, s.Transition(ctx, c.ID, accepted.Message.ID, Idle, "Completed"))
	paths, err := s.Paths(ctx, c.ID)
	must(t, err)
	for _, dir := range []string{paths.Workspace, paths.RuntimeState, paths.Logs, paths.Artifacts} {
		must(t, os.WriteFile(filepath.Join(dir, "saved"), []byte("preserved"), 0600))
	}
	must(t, s.SaveRuntimeMessage(ctx, "saved", Message{ChatID: c.ID, RuntimeMessageID: "saved", Role: "assistant", Text: "History", Payload: json.RawMessage(`{}`)}))
	title := "Renamed chat"
	archived := true
	revision = c.OrganizationRevision
	_, err = s.OrganizeChat(ctx, c.ID, ChatOrganization{Title: &title, Archived: &archived, Revision: &revision})
	must(t, err)
	must(t, s.UpdateProject(ctx, p.ID, "Renamed project", p.Configuration))
	// Remove only the additive identity objects to reproduce the previous schema.
	_, err = s.db.Exec("DROP TRIGGER allocate_chat_public_id; DROP TRIGGER immutable_chat_public_id; DROP TRIGGER retain_chat_public_id; DROP TABLE chat_public_ids; DROP VIEW chat_project_prefixes;")
	must(t, err)
	entries, err := migrations.ReadDir("migrations")
	must(t, err)
	_, err = s.db.Exec(fmt.Sprintf("PRAGMA user_version=%d", len(entries)-1))
	must(t, err)
	before := recordSnapshot(t, s.db)
	must(t, s.Close())
	s = openTest(t, root)
	if after := recordSnapshot(t, s.db); !reflect.DeepEqual(before, after) {
		t.Fatal("backfill changed existing records")
	}
	saved, err := s.Chat(ctx, c.ID)
	must(t, err)
	if saved.PublicID != "RENA-2" || saved.Title != title || !saved.Archived {
		t.Fatalf("incorrect backfill: %+v", saved)
	}
	byPublic, err := s.Chat(ctx, saved.PublicID)
	must(t, err)
	if byPublic.ID != c.ID {
		t.Fatal("backfill rekeyed chat")
	}
	savedPaths, err := s.SavedPaths(ctx, c.ID)
	must(t, err)
	if savedPaths != paths {
		t.Fatal("paths moved")
	}
	for _, dir := range []string{paths.Workspace, paths.RuntimeState, paths.Logs, paths.Artifacts} {
		raw, err := os.ReadFile(filepath.Join(dir, "saved"))
		must(t, err)
		if string(raw) != "preserved" {
			t.Fatal("saved file lost")
		}
	}
	must(t, s.Close())
	s = openTest(t, root)
	retry, err := s.Chat(ctx, saved.PublicID)
	must(t, err)
	if retry.ID != c.ID {
		t.Fatal("backfill changed on second restart")
	}
}

func recordSnapshot(t *testing.T, db *sql.DB) map[string]string {
	t.Helper()
	rows, err := db.Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'chat_public_ids' ORDER BY name")
	must(t, err)
	var names []string
	for rows.Next() {
		var name string
		must(t, rows.Scan(&name))
		names = append(names, name)
	}
	must(t, rows.Err())
	rows.Close()
	result := map[string]string{}
	for _, name := range names {
		rows, err := db.Query(`SELECT * FROM "` + name + `" ORDER BY rowid`)
		must(t, err)
		columns, err := rows.Columns()
		must(t, err)
		records := [][]any{}
		for rows.Next() {
			values := make([]any, len(columns))
			pointers := make([]any, len(columns))
			for i := range values {
				pointers[i] = &values[i]
			}
			must(t, rows.Scan(pointers...))
			records = append(records, values)
		}
		must(t, rows.Err())
		rows.Close()
		raw, err := json.Marshal(records)
		must(t, err)
		result[name] = string(raw)
	}
	return result
}

func TestPublicAndLegacyContextReferences(t *testing.T) {
	s := openTest(t, t.TempDir())
	p, source := fixture(t, s)
	must(t, s.SaveRuntimeMessage(ctx, "source", Message{ChatID: source.ID, RuntimeMessageID: "source", Role: "assistant", Text: "Saved source", Payload: json.RawMessage(`{}`)}))
	for n, reference := range []string{source.ID, source.PublicID} {
		refs := []ContextReference{{Kind: "chat", ChatID: reference, Label: source.PublicID}}
		reader, err := s.CreateChatRequestWithContext(ctx, p.ID, "Reader", image, "1", fmt.Sprintf("reader-%d", n), "Read", nil, nil, refs)
		must(t, err)
		_, err = s.AcceptMessageWithContext(ctx, reader.ID, "read", "Read", nil, refs)
		must(t, err)
		for _, target := range []string{source.ID, source.PublicID} {
			page, err := s.ReadReferencedChat(ctx, reader.ID, target, 0)
			must(t, err)
			if len(page.Messages) != 1 || page.Messages[0].Text != "Saved source" {
				t.Fatal("reference did not resolve source")
			}
		}
		_, err = s.AcceptMessageWithContext(ctx, reader.ID, "self", "Read", nil, []ContextReference{{Kind: "chat", ChatID: reader.PublicID, Label: "Self"}})
		if err == nil {
			t.Fatal("public reference bypassed self-reference check")
		}
	}
}

func TestProjectChatPrefixesRemainStableAndAllowCollisions(t *testing.T) {
	s := openTest(t, t.TempDir())
	config := Configuration{Repositories: []Repository{{Name: "core", URL: "https://github.com/example/core", BaseBranch: "main", Role: "core"}}}
	cases := []struct{ name, prefix string }{
		{"Flora", "FLOR"}, {"Floral tools", "FLOR"}, {"  My website!", "MYWE"},
		{"Go", "GO"}, {"123 日本語 🌱", "CHAT"}, {"a-b.c_d", "ABCD"},
	}
	ids := map[string]bool{}
	for _, example := range cases {
		project, err := s.CreateProject(ctx, example.name, config)
		must(t, err)
		chat, err := s.CreateChat(ctx, project.ID, "First", image, "1")
		must(t, err)
		if !strings.HasPrefix(chat.PublicID, example.prefix+"-") {
			t.Fatalf("%q: got %s, want prefix %s", example.name, chat.PublicID, example.prefix)
		}
		if ids[chat.PublicID] {
			t.Fatal("matching project prefixes produced duplicate IDs")
		}
		ids[chat.PublicID] = true
		must(t, s.UpdateProject(ctx, project.ID, "Renamed project", config))
		later, err := s.CreateChat(ctx, project.ID, "Later", image, "1")
		must(t, err)
		if !strings.HasPrefix(later.PublicID, example.prefix+"-") {
			t.Fatalf("rename changed project prefix: %s", later.PublicID)
		}
		saved, err := s.Chat(ctx, chat.PublicID)
		must(t, err)
		if saved.ID != chat.ID || saved.PublicID != chat.PublicID {
			t.Fatal("rename changed chat ID")
		}
	}
}
