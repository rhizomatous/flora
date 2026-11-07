package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestPreferencesDefaultsAndBounds(t *testing.T) {
	p := DefaultPreferences()
	if p.MaxRunning != 10 || p.SetupSeconds != 600 || p.ActivitySeconds != 3600 || p.CPUs != 2 || p.MemoryBytes != 8<<30 || p.PidsLimit != 512 || p.InlineDiffBytes != 1<<20 || p.MessageBytes != 128<<10 || p.SessionSeconds != 604800 || p.AuthorName != "Flora" || p.AuthorEmail != "flora@rhizomato.us" {
		t.Fatalf("unexpected defaults: %+v", p)
	}
	must(t, p.Validate())
	for name, edit := range map[string]func(*Preferences){
		"cap zero": func(p *Preferences) { p.MaxRunning = 0 }, "cap high": func(p *Preferences) { p.MaxRunning = 1001 },
		"CPU NaN": func(p *Preferences) { p.CPUs = math.NaN() }, "CPU low": func(p *Preferences) { p.CPUs = .01 }, "CPU high": func(p *Preferences) { p.CPUs = 257 },
		"memory low": func(p *Preferences) { p.MemoryBytes = 1 }, "memory high": func(p *Preferences) { p.MemoryBytes = 1 << 41 },
		"pids zero": func(p *Preferences) { p.PidsLimit = 0 }, "pids high": func(p *Preferences) { p.PidsLimit = 65537 },
		"setup zero": func(p *Preferences) { p.SetupSeconds = 0 }, "setup high": func(p *Preferences) { p.SetupSeconds = 86401 },
		"activity negative": func(p *Preferences) { p.ActivitySeconds = -1 }, "activity high": func(p *Preferences) { p.ActivitySeconds = 604801 },
		"diff low": func(p *Preferences) { p.InlineDiffBytes = 1 }, "diff high": func(p *Preferences) { p.InlineDiffBytes = 17 << 20 },
		"message low": func(p *Preferences) { p.MessageBytes = 1 }, "message high": func(p *Preferences) { p.MessageBytes = MaxAllowedMessageBytes + 1 },
		"session low": func(p *Preferences) { p.SessionSeconds = 299 }, "session high": func(p *Preferences) { p.SessionSeconds = 31536001 },
		"name blank": func(p *Preferences) { p.AuthorName = " " }, "name injection": func(p *Preferences) { p.AuthorName = "Flora\nextra" },
		"email injection": func(p *Preferences) { p.AuthorEmail = "a@b.test\nextra" }, "email display": func(p *Preferences) { p.AuthorEmail = "Flora <flora@example.test>" },
	} {
		t.Run(name, func(t *testing.T) {
			v := p
			edit(&v)
			if v.Validate() == nil {
				t.Fatal("accepted invalid preference")
			}
			s := openTest(t, t.TempDir())
			if s.SavePreferences(ctx, v) == nil {
				t.Fatal("storage accepted invalid preference")
			}
		})
	}
}

func TestPreferencesReopenSnapshotsAndMessageLimits(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	project, old := fixture(t, s)
	p := DefaultPreferences()
	p.CPUs = 3
	p.MemoryBytes = 2 << 30
	p.PidsLimit = 256
	p.SetupSeconds = 90
	p.AuthorName = "Test Author"
	p.AuthorEmail = "author@example.test"
	p.MessageBytes = 1024
	p.Sound = false
	p.SessionSeconds = 3600
	must(t, s.SavePreferences(ctx, p))
	fresh, err := s.CreateChatRequest(ctx, project.ID, "New", image, "1.2.27", "new", strings.Repeat("é", 512))
	must(t, err)
	if fresh.Configuration.RuntimeDefaults() != p.RuntimeDefaults || old.Configuration.RuntimeDefaults() == p.RuntimeDefaults {
		t.Fatal("new-chat runtime snapshot not preserved")
	}
	if _, err := s.CreateChatRequest(ctx, project.ID, "Too big", image, "1.2.27", "big", strings.Repeat("é", 513)); err != ErrInvalid {
		t.Fatal("creation ignored byte limit", err)
	}
	if _, err := s.AcceptMessage(ctx, old.ID, "big", strings.Repeat("é", 513)); err != ErrInvalid {
		t.Fatal("follow-up ignored limit", err)
	}
	accepted, err := s.AcceptMessage(ctx, old.ID, "boundary", strings.Repeat("é", 512))
	must(t, err)
	must(t, s.Transition(ctx, old.ID, accepted.Message.ID, Idle, "Done"))
	p.MessageBytes = 2048
	must(t, s.SavePreferences(ctx, p))
	if _, err := s.AcceptMessage(ctx, old.ID, "bigger", strings.Repeat("é", 1024)); err != nil {
		t.Fatal("raised limit not applied", err)
	}
	must(t, s.Close())
	s = openTest(t, root)
	saved, err := s.Preferences(ctx)
	must(t, err)
	if saved != p {
		t.Fatal("preferences lost on reopen")
	}
	savedChat, err := s.Chat(ctx, old.ID)
	must(t, err)
	if !reflect.DeepEqual(savedChat.Configuration, old.Configuration) {
		t.Fatal("existing snapshot changed")
	}
	savedChat, err = s.Chat(ctx, fresh.ID)
	must(t, err)
	if !reflect.DeepEqual(savedChat.Configuration, fresh.Configuration) {
		t.Fatal("new snapshot changed on reopen")
	}
}

func TestSettingsMigrationFromFourPreservesRawChatConfig(t *testing.T) {
	root := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(root, "flora.db"))
	must(t, err)
	for _, name := range []string{"001_initial.sql", "002_auth.sql", "003_github_capabilities.sql", "004_chat_requests.sql"} {
		body, err := migrations.ReadFile("migrations/" + name)
		must(t, err)
		_, err = db.Exec(string(body))
		must(t, err)
	}
	raw := `{"repositories":[{"name":"core","url":"https://github.com/example/core","baseBranch":"main","role":"core"}],"setupCommand":"printf hello"}`
	_, err = db.Exec(`INSERT INTO projects VALUES('project','Old',?,'2026-01-01T00:00:00Z'); INSERT INTO chats(id,project_id,title,config,image_digest,harness_version,status,status_reason,created_at,updated_at) VALUES('chat','project','Old chat',?,'image','1','stopped','Not started','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); PRAGMA user_version=4`, raw, raw)
	must(t, err)
	must(t, db.Close())
	s := openTest(t, root)
	p, err := s.Preferences(ctx)
	must(t, err)
	if p != DefaultPreferences() {
		t.Fatal("upgrade defaults differ")
	}
	c, err := s.Chat(ctx, "chat")
	must(t, err)
	if c.Configuration.Runtime != nil || c.Configuration.RuntimeDefaults() != DefaultPreferences().RuntimeDefaults {
		t.Fatal("legacy defaults changed")
	}
	var saved string
	must(t, s.db.QueryRow("SELECT config FROM chats WHERE id='chat'").Scan(&saved))
	if saved != raw {
		t.Fatal("migration rewrote immutable config")
	}
}

func TestInstallationSettingsRollbackTogether(t *testing.T) {
	s := openTest(t, t.TempDir())
	original := Credentials{"openai", "model", "github_pat_fixture", "provider-fixture"}
	must(t, s.SaveCredentials(ctx, original))
	_, err := s.db.Exec(`CREATE TRIGGER fail_settings BEFORE INSERT ON installation_settings BEGIN SELECT RAISE(ABORT,'injected'); END`)
	must(t, err)
	changed := original
	changed.ProviderKey = "new-provider-fixture"
	p := DefaultPreferences()
	p.MaxRunning = 2
	if s.SaveInstallation(ctx, changed, &p) == nil {
		t.Fatal("expected failure")
	}
	saved, err := s.Credentials(ctx)
	must(t, err)
	if saved != original {
		t.Fatal("credential changed despite settings failure")
	}
	b, err := json.Marshal(p)
	must(t, err)
	if strings.Contains(string(b), "fixture") {
		t.Fatal("preference record contains credentials")
	}
}

func TestSettingsWritesSerializeWithContainerAdmission(t *testing.T) {
	s := openTest(t, t.TempDir())
	release, err := s.LockContainerCapacity(ctx)
	must(t, err)
	short, cancel := context.WithTimeout(ctx, 30*time.Millisecond)
	defer cancel()
	p := DefaultPreferences()
	p.MaxRunning = 1
	if err := s.SavePreferences(short, p); err != context.DeadlineExceeded {
		t.Fatal("settings changed during admission", err)
	}
	release()
	must(t, s.SavePreferences(ctx, p))
	saved, err := s.Preferences(ctx)
	must(t, err)
	if saved.MaxRunning != 1 {
		t.Fatal("lower cap not saved after admission")
	}
}

func TestAcceptedMessageRetrySurvivesLowerLimit(t *testing.T) {
	s := openTest(t, t.TempDir())
	project, c := fixture(t, s)
	text := strings.Repeat("é", 1024)
	created, err := s.CreateChatRequest(ctx, project.ID, "Retry", image, "1", "creation", text)
	must(t, err)
	accepted, err := s.AcceptMessage(ctx, c.ID, "message", text)
	must(t, err)
	p := DefaultPreferences()
	p.MessageBytes = 1024
	must(t, s.SavePreferences(ctx, p))
	retry, err := s.CreateChatRequest(ctx, project.ID, "Retry", image, "1", "creation", text)
	must(t, err)
	if retry.ID != created.ID {
		t.Fatal("creation retry changed identity")
	}
	a, err := s.AcceptMessage(ctx, c.ID, "message", text)
	must(t, err)
	if !a.Duplicate || a.Message.ID != accepted.Message.ID {
		t.Fatal("lower limit changed accepted retry")
	}
}

func TestWritableProbeDetectsMissingStorageDirectory(t *testing.T) {
	s := openTest(t, t.TempDir())
	must(t, s.CheckWritable(ctx))
	must(t, os.Rename(filepath.Join(s.root, "logs"), filepath.Join(s.root, "logs-hidden")))
	if s.CheckWritable(ctx) == nil {
		t.Fatal("unwritable logs not detected")
	}
}
