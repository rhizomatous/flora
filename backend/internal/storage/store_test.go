package storage

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

var ctx = context.Background()

const image = "ghcr.io/rhizomatous/flora@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func openTest(t *testing.T, root string) *Store {
	t.Helper()
	s, err := Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func fixture(t *testing.T, s *Store) (Project, Chat) {
	t.Helper()
	p, err := s.CreateProject(ctx, "Flora", Configuration{Repositories: []Repository{{Name: "flora", URL: "https://github.com/rhizomatous/flora", BaseBranch: "main", Role: "core"}}, SetupCommand: "make deps"})
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.CreateChat(ctx, p.ID, "Fix storage", image, "opencode/1.2.27")
	if err != nil {
		t.Fatal(err)
	}
	return p, c
}
func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func wantError(t *testing.T, err, want error) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Fatalf("error = %v, want %v", err, want)
	}
}

func TestDurableRecordsAndImmutableSnapshot(t *testing.T) {
	root := filepath.Join(t.TempDir(), "private ? storage")
	s := openTest(t, root)
	p, c := fixture(t, s)
	paths, err := s.Paths(ctx, c.ID)
	must(t, err)
	for _, path := range []string{paths.Workspace, paths.RuntimeState, paths.Logs, paths.Artifacts} {
		info, err := os.Stat(path)
		must(t, err)
		if info.Mode().Perm() != 0700 {
			t.Fatalf("directory mode %o", info.Mode().Perm())
		}
		must(t, os.WriteFile(filepath.Join(path, "saved-context"), []byte("preserved"), 0600))
	}
	// Distinct chats have independent writable locations.
	other, err := s.CreateChat(ctx, p.ID, "Other", image, "opencode/1.2.27")
	must(t, err)
	otherPaths, err := s.Paths(ctx, other.ID)
	must(t, err)
	if paths == otherPaths {
		t.Fatal("shared chat paths")
	}
	updated := p.Configuration
	updated.Repositories = append([]Repository(nil), updated.Repositories...)
	updated.Repositories[0].BaseBranch = "next"
	updated.SetupCommand = "different setup"
	must(t, s.UpdateProject(ctx, p.ID, "Renamed", updated))
	later, err := s.CreateChat(ctx, p.ID, "Later", image, "opencode/1.2.27")
	must(t, err)
	if later.Configuration.Repositories[0].BaseBranch != "next" {
		t.Fatal("new chat did not snapshot new settings")
	}
	must(t, s.BindRuntime(ctx, c.ID, "container-1", ""))
	preSession, err := s.Chat(ctx, c.ID)
	must(t, err)
	if preSession.ContainerID != "container-1" || preSession.SessionID != "" {
		t.Fatal("container identity cannot be saved before runtime startup")
	}
	must(t, s.BindRuntime(ctx, c.ID, "container-1", "session-1"))
	must(t, s.BindRuntime(ctx, c.ID, "container-1", "session-1"))
	must(t, s.BindRuntime(ctx, c.ID, "container-1", "")) // cannot erase a bound session
	wantError(t, s.BindRuntime(ctx, c.ID, "container-2", "session-1"), ErrConflict)
	wantError(t, s.BindRuntime(ctx, c.ID, "container-1", "session-2"), ErrConflict)
	sha := strings.Repeat("b", 40)
	must(t, s.RecordStartingCommit(ctx, c.ID, "flora", sha))
	must(t, s.RecordStartingCommit(ctx, c.ID, "flora", sha))
	wantError(t, s.RecordStartingCommit(ctx, c.ID, "flora", strings.Repeat("c", 40)), ErrConflict)
	wantError(t, s.RecordStartingCommit(ctx, c.ID, "unknown", sha), ErrInvalid)
	accepted, err := s.AcceptMessage(ctx, c.ID, "request-1", "Please fix this ✿")
	must(t, err)
	runtime := Message{ChatID: c.ID, RuntimeMessageID: "runtime-message-1", Role: "assistant", Text: "Done", Provider: "anthropic", Model: "claude-sonnet-4-6", Payload: json.RawMessage(`{"parts":[{"type":"tool","output":"full output"}]}`)}
	must(t, s.SaveRuntimeMessage(ctx, "runtime-event-1", runtime))
	must(t, s.AppendActivity(ctx, c.ID, "question-1", "question", json.RawMessage(`{"request_id":"question-local-only"}`)))
	must(t, s.Transition(ctx, c.ID, accepted.Message.ID, Waiting, "Runtime requested input"))
	// Closing storage must not infer success, resume, or erase process-local state.
	before, err := s.Activities(ctx, c.ID, 0, 1000)
	must(t, err)
	must(t, s.Close())
	s = openTest(t, root)
	saved, err := s.Chat(ctx, c.ID)
	must(t, err)
	if !reflect.DeepEqual(saved.Configuration, p.Configuration) || saved.StartingCommits["flora"] != sha || saved.ImageDigest != image || saved.HarnessVersion != "opencode/1.2.27" || saved.ContainerID != "container-1" || saved.SessionID != "session-1" || saved.Status != Waiting || saved.ActiveMessageID != accepted.Message.ID {
		t.Fatalf("bad saved snapshot: %+v", saved)
	}
	savedProject, err := s.Project(ctx, p.ID)
	must(t, err)
	if !reflect.DeepEqual(savedProject.Configuration, updated) {
		t.Fatal("project update was lost")
	}
	after, err := s.Activities(ctx, c.ID, 0, 1000)
	must(t, err)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("activity changed across reopen")
	}
	messages, err := s.Messages(ctx, c.ID)
	must(t, err)
	if len(messages) != 2 || messages[0].ID != accepted.Message.ID || messages[1].Provider != runtime.Provider || string(messages[1].Payload) != string(runtime.Payload) {
		t.Fatalf("bad messages: %+v", messages)
	}
	replay, err := s.AcceptMessage(ctx, c.ID, "request-1", "Please fix this ✿")
	must(t, err)
	if !replay.Duplicate || replay.Message.ID != accepted.Message.ID {
		t.Fatal("accepted retry did not survive reopen")
	}
	savedPaths, err := s.Paths(ctx, c.ID)
	must(t, err)
	if savedPaths != paths {
		t.Fatal("paths changed across reopen")
	}
	for _, path := range []string{savedPaths.Workspace, savedPaths.RuntimeState, savedPaths.Logs, savedPaths.Artifacts} {
		data, err := os.ReadFile(filepath.Join(path, "saved-context"))
		must(t, err)
		if string(data) != "preserved" {
			t.Fatal("saved files changed across reopen")
		}
	}
	// SQL also protects the immutable snapshot from accidental future updates.
	_, err = s.db.ExecContext(ctx, "UPDATE chats SET config='{}' WHERE id=?", c.ID)
	if err == nil {
		t.Fatal("schema allowed snapshot mutation")
	}
}

func TestLegacyProjectConfigurationJSON(t *testing.T) {
	s := openTest(t, t.TempDir())
	p, _ := fixture(t, s)
	legacy := `{"Repositories":[{"Name":"flora","URL":"https://github.com/rhizomatous/flora","BaseBranch":"main","Role":"core"}],"SetupCommand":"make deps"}`
	_, err := s.db.ExecContext(ctx, "UPDATE projects SET config=? WHERE id=?", legacy, p.ID)
	must(t, err)
	projects, err := s.Projects(ctx)
	must(t, err)
	if len(projects) != 1 || !reflect.DeepEqual(projects[0].Configuration, p.Configuration) {
		t.Fatal("legacy configuration changed")
	}
	chat, err := s.CreateChat(ctx, p.ID, "Legacy", image, "opencode/1")
	must(t, err)
	if !reflect.DeepEqual(chat.Configuration, p.Configuration) {
		t.Fatal("legacy snapshot changed")
	}
}

func TestAcceptanceRollbackAndTurnOwnership(t *testing.T) {
	s := openTest(t, t.TempDir())
	_, c := fixture(t, s)
	before, err := s.Activities(ctx, c.ID, 0, 1000)
	must(t, err)
	// Force the LAST insert in message acceptance to fail. Earlier message,
	// active owner, and first activity insert must all roll back.
	_, err = s.db.ExecContext(ctx, `CREATE TRIGGER fail_status BEFORE INSERT ON activity WHEN NEW.kind='status' BEGIN SELECT RAISE(ABORT,'injected disk write failure'); END`)
	must(t, err)
	_, err = s.AcceptMessage(ctx, c.ID, "retryable", "hello")
	if err == nil {
		t.Fatal("expected write failure")
	}
	messages, err := s.Messages(ctx, c.ID)
	must(t, err)
	if len(messages) != 0 {
		t.Fatal("message survived rollback")
	}
	saved, err := s.Chat(ctx, c.ID)
	must(t, err)
	if saved.ActiveMessageID != "" || saved.Status != Stopped {
		t.Fatal("turn survived rollback")
	}
	after, err := s.Activities(ctx, c.ID, 0, 1000)
	must(t, err)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("partial activity survived rollback")
	}
	_, err = s.db.ExecContext(ctx, "DROP TRIGGER fail_status")
	must(t, err)
	a, err := s.AcceptMessage(ctx, c.ID, "retryable", "hello")
	must(t, err)
	if a.Duplicate {
		t.Fatal("rolled-back identity was consumed")
	}
	_, err = s.AcceptMessage(ctx, c.ID, "next", "follow-up")
	wantError(t, err, ErrActive)
	_, err = s.AcceptMessage(ctx, c.ID, "retryable", "changed")
	wantError(t, err, ErrConflict)
	must(t, s.Transition(ctx, c.ID, a.Message.ID, Waiting, "Question"))
	_, err = s.AcceptMessage(ctx, c.ID, "next", "follow-up")
	wantError(t, err, ErrActive)
	must(t, s.Transition(ctx, c.ID, a.Message.ID, Idle, "Completed"))
	duplicate, err := s.AcceptMessage(ctx, c.ID, "retryable", "hello")
	must(t, err)
	if !duplicate.Duplicate {
		t.Fatal("completed request was accepted twice")
	}
	b, err := s.AcceptMessage(ctx, c.ID, "next", "follow-up")
	must(t, err)
	wantError(t, s.Transition(ctx, c.ID, a.Message.ID, Idle, "Stale completion"), ErrStale)
	saved, err = s.Chat(ctx, c.ID)
	must(t, err)
	if saved.ActiveMessageID != b.Message.ID {
		t.Fatal("stale completion cleared newer turn")
	}
	must(t, s.Transition(ctx, c.ID, b.Message.ID, Failed, "Runtime died; effects uncertain"))
	next, err := s.AcceptMessage(ctx, c.ID, "explicit-new-input", "Continue from saved context")
	must(t, err)
	must(t, s.Transition(ctx, c.ID, next.Message.ID, Stopped, "Stop confirmed"))
}

func TestMessageByteLimitBeforeSaving(t *testing.T) {
	s := openTest(t, t.TempDir())
	_, c := fixture(t, s)
	for _, text := range []string{strings.Repeat("x", MaxMessageBytes+1), strings.Repeat("✿", MaxMessageBytes/3+1), string([]byte{0xff})} {
		_, err := s.AcceptMessage(ctx, c.ID, "invalid", text)
		wantError(t, err, ErrInvalid)
	}
	messages, err := s.Messages(ctx, c.ID)
	must(t, err)
	if len(messages) != 0 {
		t.Fatal("invalid text was saved")
	}
	_, err = s.AcceptMessage(ctx, c.ID, "max", strings.Repeat("é", MaxMessageBytes/2))
	must(t, err)
}

func TestConcurrentAcceptanceAcrossConnections(t *testing.T) {
	for _, sameRequest := range []bool{true, false} {
		t.Run(map[bool]string{true: "same request", false: "different requests"}[sameRequest], func(t *testing.T) {
			root := t.TempDir()
			one := openTest(t, root)
			_, c := fixture(t, one)
			two := openTest(t, root)
			const n = 20
			results := make(chan Acceptance, n)
			errs := make(chan error, n)
			start := make(chan struct{})
			var wg sync.WaitGroup
			for i := 0; i < n; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					<-start
					request := "same"
					if !sameRequest {
						request = id()
					}
					s := one
					if i%2 == 0 {
						s = two
					}
					a, err := s.AcceptMessage(ctx, c.ID, request, "hello")
					results <- a
					errs <- err
				}(i)
			}
			close(start)
			wg.Wait()
			close(results)
			close(errs)
			newCount, duplicateCount, activeCount := 0, 0, 0
			acceptedID := ""
			for err := range errs {
				if errors.Is(err, ErrActive) {
					activeCount++
				} else {
					must(t, err)
				}
			}
			for a := range results {
				if a.Message.ID == "" {
					continue
				}
				if acceptedID != "" && a.Message.ID != acceptedID {
					t.Fatal("multiple message identities accepted")
				}
				acceptedID = a.Message.ID
				if a.Duplicate {
					duplicateCount++
				} else {
					newCount++
				}
			}
			if newCount != 1 || (sameRequest && duplicateCount != n-1) || (!sameRequest && activeCount != n-1) {
				t.Fatalf("new=%d duplicate=%d active=%d", newCount, duplicateCount, activeCount)
			}
			messages, err := one.Messages(ctx, c.ID)
			must(t, err)
			if len(messages) != 1 {
				t.Fatal("concurrent submissions persisted multiple turns")
			}
		})
	}
}

func TestActivityPagingAndRuntimeUpdates(t *testing.T) {
	s := openTest(t, t.TempDir())
	_, c := fixture(t, s)
	m := Message{ChatID: c.ID, RuntimeMessageID: "message-1", Role: "assistant", Text: "partial", Provider: "provider", Model: "model", Payload: json.RawMessage(`{"parts":[]}`)}
	must(t, s.SaveRuntimeMessage(ctx, "update-1", m))
	must(t, s.SaveRuntimeMessage(ctx, "update-1", m))
	m.Text = "complete"
	m.Payload = json.RawMessage(`{"parts":[{"output":"complete tool output"}]}`)
	must(t, s.SaveRuntimeMessage(ctx, "update-2", m))
	old := m
	old.Text = "partial"
	old.Payload = json.RawMessage(`{"parts":[]}`)
	must(t, s.SaveRuntimeMessage(ctx, "update-1", old)) // must not restore stale snapshot
	wantError(t, s.SaveRuntimeMessage(ctx, "update-2", old), ErrConflict)
	messages, err := s.Messages(ctx, c.ID)
	must(t, err)
	if len(messages) != 1 || messages[0].Text != "complete" {
		t.Fatal("runtime update lost or duplicated")
	}
	payload := json.RawMessage(`{"output":"all command output"}`)
	must(t, s.AppendActivity(ctx, c.ID, "command-1", "command", payload))
	must(t, s.AppendActivity(ctx, c.ID, "command-1", "command", payload))
	wantError(t, s.AppendActivity(ctx, c.ID, "command-1", "command", json.RawMessage(`{}`)), ErrConflict)
	var cursor int64
	var collected []Activity
	for {
		page, err := s.Activities(ctx, c.ID, cursor, 1)
		must(t, err)
		if len(page) == 0 {
			break
		}
		if page[0].Sequence <= cursor {
			t.Fatal("unstable ordering")
		}
		cursor = page[0].Sequence
		collected = append(collected, page...)
	}
	all, err := s.Activities(ctx, c.ID, 0, 1000)
	must(t, err)
	if len(all) != 4 || !reflect.DeepEqual(collected, all) {
		t.Fatalf("bad paging: %+v", all)
	}
	// Failed runtime persistence must not publish activity or partial text.
	_, err = s.db.ExecContext(ctx, `CREATE TRIGGER fail_runtime BEFORE INSERT ON activity WHEN NEW.kind='message.runtime' BEGIN SELECT RAISE(ABORT,'injected'); END`)
	must(t, err)
	m.Text = "should roll back"
	if err := s.SaveRuntimeMessage(ctx, "update-3", m); err == nil {
		t.Fatal("expected injected failure")
	}
	messages, err = s.Messages(ctx, c.ID)
	must(t, err)
	if messages[0].Text != "complete" {
		t.Fatal("runtime message survived failed activity write")
	}
}

func TestMigrationSafety(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	var version int
	must(t, s.db.QueryRow("PRAGMA user_version").Scan(&version))
	entries, err := migrations.ReadDir("migrations")
	must(t, err)
	if version != len(entries) {
		t.Fatalf("schema version %d", version)
	}
	// Simulate an uninitialized database with a conflicting preexisting object.
	// Migration must roll back preceding DDL and leave its version untouched.
	must(t, s.Close())
	brokenRoot := t.TempDir()
	broken := openTest(t, brokenRoot)
	_, err = broken.db.Exec("DROP TABLE browser_sessions; DROP TABLE administrator; DROP TABLE installation_credentials; DROP TRIGGER immutable_chat_config; DROP TABLE starting_commits; DROP TABLE activity; DROP TABLE chats; DROP TABLE messages; DROP TABLE projects; CREATE TABLE chats (conflict TEXT); PRAGMA user_version=0")
	must(t, err)
	if err := broken.migrate(ctx); err == nil {
		t.Fatal("expected migration conflict")
	}
	must(t, broken.db.QueryRow("PRAGMA user_version").Scan(&version))
	if version != 0 {
		t.Fatal("failed migration advanced version")
	}
	var count int
	must(t, broken.db.QueryRow("SELECT count(*) FROM sqlite_master WHERE name='projects'").Scan(&count))
	if count != 0 {
		t.Fatal("partial migration DDL survived")
	}
	_, err = broken.db.Exec("DROP TABLE chats")
	must(t, err)
	must(t, broken.migrate(ctx))
	must(t, broken.migrate(ctx))
	_, err = broken.db.Exec("PRAGMA user_version=999")
	must(t, err)
	must(t, broken.Close())
	newer, err := Open(ctx, brokenRoot)
	if err == nil {
		newer.Close()
		t.Fatal("opened unsupported newer schema")
	}
}

func TestUnwritableAndUnsafeStorage(t *testing.T) {
	if s, err := Open(ctx, ""); err == nil {
		s.Close()
		t.Fatal("accepted empty storage root")
	}
	root := t.TempDir()
	must(t, os.WriteFile(filepath.Join(root, "not-directory"), []byte("x"), 0600))
	if s, err := Open(ctx, filepath.Join(root, "not-directory", "child")); err == nil {
		s.Close()
		t.Fatal("accepted file parent")
	}
	target := t.TempDir()
	must(t, os.Symlink(target, filepath.Join(root, "workspaces")))
	if s, err := Open(ctx, root); err == nil {
		s.Close()
		t.Fatal("accepted symlink storage directory")
	}
}

func TestChatScopedRequestsAndLifecycleWork(t *testing.T) {
	s := openTest(t, t.TempDir())
	p, one := fixture(t, s)
	two, err := s.CreateChat(ctx, p.ID, "Independent chat", image, "opencode/1.2.27")
	must(t, err)
	a, err := s.AcceptMessage(ctx, one.ID, "request-1", "hello")
	must(t, err)
	b, err := s.AcceptMessage(ctx, two.ID, "request-1", "hello")
	must(t, err)
	if a.Duplicate || b.Duplicate || a.Message.ID == b.Message.ID {
		t.Fatal("requests were deduplicated across independent chats")
	}
	// The database itself must reject assigning another chat's turn.
	_, err = s.db.ExecContext(ctx, "UPDATE chats SET active_message_id=? WHERE id=?", b.Message.ID, one.ID)
	if err == nil {
		t.Fatal("cross-chat active message reference was allowed")
	}
	must(t, s.Transition(ctx, one.ID, a.Message.ID, Idle, "Complete"))
	must(t, s.Transition(ctx, one.ID, "", Working, "Stopping container"))
	_, err = s.AcceptMessage(ctx, one.ID, "request-2", "follow-up")
	wantError(t, err, ErrActive)
	must(t, s.Transition(ctx, one.ID, "", Stopped, "Stop confirmed"))
	_, err = s.AcceptMessage(ctx, one.ID, "request-2", "follow-up")
	must(t, err)
}

func TestCanceledAcceptanceDoesNotConsumeIdentity(t *testing.T) {
	s := openTest(t, t.TempDir())
	_, c := fixture(t, s)
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	_, err := s.AcceptMessage(canceled, c.ID, "request", "hello")
	wantError(t, err, context.Canceled)
	a, err := s.AcceptMessage(ctx, c.ID, "request", "hello")
	must(t, err)
	if a.Duplicate {
		t.Fatal("canceled acceptance consumed identity")
	}
}

func TestInvalidPinnedIdentityAndCredentialURL(t *testing.T) {
	s := openTest(t, t.TempDir())
	p, _ := fixture(t, s)
	for _, digest := range []string{"image:latest", "image@sha256:", "@sha256:" + strings.Repeat("a", 64), "image@sha256:" + strings.Repeat("z", 64)} {
		_, err := s.CreateChat(ctx, p.ID, "Invalid image", digest, "opencode/1.2.27")
		wantError(t, err, ErrInvalid)
	}
	for _, repoURL := range []string{"https://user:password@github.com/owner/repo", "https://github.com/owner/repo?token=example", "https://github.com/owner/repo#credential", "https://elsewhere.example/owner/repo"} {
		config := Configuration{Repositories: []Repository{{Name: "repo", URL: repoURL, BaseBranch: "main", Role: "core"}}}
		_, err := s.CreateProject(ctx, "Invalid repository", config)
		wantError(t, err, ErrInvalid)
	}
}
