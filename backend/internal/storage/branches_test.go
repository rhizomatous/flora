package storage

import (
	"errors"
	"testing"
)

func TestChatBranchesFreezeAndRetry(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	p, existing := fixture(t, s)
	original := p.Configuration.Repositories[0]
	p.Configuration.Repositories = append(p.Configuration.Repositories, Repository{Name: "owner/extra", URL: "https://github.com/owner/extra.git", BaseBranch: "main", Role: "extra"})
	must(t, s.UpdateProject(ctx, p.ID, p.Name, p.Configuration))
	branches := map[string]string{original.Name: "release/stable", "owner/extra": "next"}
	c, err := s.CreateChatRequestWithBranches(ctx, p.ID, "Release", image, "1", "release", "Fix it", nil, branches)
	must(t, err)
	if c.Configuration.Repositories[0].BaseBranch != "release/stable" || c.Configuration.Repositories[1].BaseBranch != "next" {
		t.Fatal(c.Configuration)
	}
	saved, err := s.Project(ctx, p.ID)
	must(t, err)
	if saved.Configuration.Repositories[0].BaseBranch != original.BaseBranch || saved.Configuration.Repositories[1].BaseBranch != "main" {
		t.Fatal("changed project defaults")
	}
	old, err := s.Chat(ctx, existing.ID)
	must(t, err)
	if old.Configuration.Repositories[0].BaseBranch != original.BaseBranch {
		t.Fatal("changed existing chat")
	}
	p.Configuration.Repositories[0].BaseBranch = "new-default"
	must(t, s.UpdateProject(ctx, p.ID, p.Name, p.Configuration))
	defaults, err := s.CreateChatRequest(ctx, p.ID, "Scheduled", image, "1", "schedule", "Work")
	must(t, err)
	if defaults.Configuration.Repositories[0].BaseBranch != "new-default" || defaults.Configuration.Repositories[1].BaseBranch != "main" {
		t.Fatal(defaults.Configuration)
	}
	must(t, s.Close())
	s = openTest(t, root)
	retry, err := s.CreateChatRequestWithBranches(ctx, p.ID, "Release", image, "1", "release", "Fix it", nil, branches)
	must(t, err)
	if retry.ID != c.ID || retry.Configuration.Repositories[0].BaseBranch != "release/stable" {
		t.Fatal(retry)
	}
	for _, changed := range []map[string]string{nil, {original.Name: "different"}, {original.Name: "release/stable"}} {
		if _, err := s.CreateChatRequestWithBranches(ctx, p.ID, "Release", image, "1", "release", "Fix it", nil, changed); !errors.Is(err, ErrConflict) {
			t.Fatal("changed retry accepted", err)
		}
	}
	if _, err := s.CreateChatRequestWithBranches(ctx, p.ID, "Unknown", image, "1", "unknown", "Fix", nil, map[string]string{"unknown/repo": "main"}); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
}

func TestBranchMigrationPreservesCreationIdentityAndReadState(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	p, _ := fixture(t, s)
	c, err := s.CreateChatRequest(ctx, p.ID, "Legacy", image, "1", "old", "Prompt")
	must(t, err)
	_, err = s.MarkChatsRead(ctx, []ViewedRevision{{c.ID, c.ActivityRevision}})
	must(t, err)
	_, err = s.db.Exec(`ALTER TABLE chat_requests DROP COLUMN context_references; ALTER TABLE chat_requests DROP COLUMN branches; PRAGMA user_version=17`)
	must(t, err)
	must(t, s.Close())
	s = openTest(t, root)
	retry, err := s.CreateChatRequestWithBranches(ctx, p.ID, "Legacy", image, "1", "old", "Prompt", nil, map[string]string{})
	must(t, err)
	if retry.ID != c.ID {
		t.Fatal("migration lost old retry identity")
	}
	if retry.LastViewedRevision != c.ActivityRevision {
		t.Fatal("migration lost the saved read position")
	}
}
