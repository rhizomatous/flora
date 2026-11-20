package storage

import (
	"errors"
	"strings"
	"sync"
	"testing"
)

func TestFoldersPersistAndRemovalPreservesChats(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	p, c := fixture(t, s)
	f, err := s.SaveFolder(ctx, ChatFolder{Name: "  Release  "})
	must(t, err)
	if f.Name != "Release" {
		t.Fatal(f)
	}
	for _, name := range []string{"release", " RELEASE "} {
		if _, err := s.SaveFolder(ctx, ChatFolder{Name: name}); !errors.Is(err, ErrFolderName) {
			t.Fatal(err)
		}
	}
	for _, name := range []string{" ", "two\nlines", strings.Repeat("🌸", 51), string([]byte{255})} {
		if _, err := s.SaveFolder(ctx, ChatFolder{Name: name}); !errors.Is(err, ErrInvalid) {
			t.Fatal(err)
		}
	}
	empty, err := s.SaveFolder(ctx, ChatFolder{Name: "Alpha"})
	must(t, err)
	secondProject, err := s.CreateProject(ctx, "Other project", p.Configuration)
	must(t, err)
	other, err := s.CreateChatRequest(ctx, secondProject.ID, "Archived", image, "1.2.27", "folder-chat", "Keep this message")
	must(t, err)
	accepted, err := s.AcceptMessage(ctx, other.ID, "folder-chat", "Keep this message")
	must(t, err)
	yes := true
	rev := c.OrganizationRevision
	pinned, err := s.OrganizeChat(ctx, c.ID, ChatOrganization{FolderID: &f.ID, Pinned: &yes, Revision: &rev})
	must(t, err)
	rev = other.OrganizationRevision
	archived, err := s.OrganizeChat(ctx, other.ID, ChatOrganization{FolderID: &f.ID, Archived: &yes, Revision: &rev})
	must(t, err)
	if pinned.FolderID != f.ID || archived.FolderID != f.ID || pinned.PinnedAt == "" || !archived.Archived {
		t.Fatal(pinned, archived)
	}
	// Replacing membership cannot put the chat in two folders.
	rev = pinned.OrganizationRevision
	moved, err := s.OrganizeChat(ctx, c.ID, ChatOrganization{FolderID: &empty.ID, Revision: &rev})
	must(t, err)
	if moved.FolderID != empty.ID {
		t.Fatal(moved)
	}
	rev = moved.OrganizationRevision
	moved, err = s.OrganizeChat(ctx, c.ID, ChatOrganization{FolderID: &f.ID, Revision: &rev})
	must(t, err)
	must(t, s.Close())
	s = openTest(t, root)
	folders, err := s.Folders(ctx)
	must(t, err)
	if len(folders) != 2 || folders[0].ID != empty.ID || folders[1].ID != f.ID {
		t.Fatal(folders)
	}
	saved, err := s.Chat(ctx, c.ID)
	must(t, err)
	if saved.FolderID != f.ID {
		t.Fatal(saved)
	}
	removed, err := s.RemoveFolder(ctx, f.ID, f.Revision)
	must(t, err)
	if len(removed) != 2 {
		t.Fatal(removed)
	}
	for _, row := range removed {
		if row.FolderID != "" {
			t.Fatal(row)
		}
	}
	saved, err = s.Chat(ctx, c.ID)
	must(t, err)
	if saved.PinnedAt != pinned.PinnedAt || saved.OrganizationRevision != moved.OrganizationRevision+1 || saved.ActivityRevision != pinned.ActivityRevision {
		t.Fatal(saved)
	}
	saved, err = s.Chat(ctx, other.ID)
	must(t, err)
	if !saved.Archived || saved.Title != "Archived" || saved.ActiveMessageID != accepted.Message.ID {
		t.Fatal(saved)
	}
	messages, err := s.Messages(ctx, other.ID)
	must(t, err)
	if len(messages) != 1 || messages[0].Text != "Keep this message" {
		t.Fatal(messages)
	}
	missing := f.ID
	rev = saved.OrganizationRevision
	if _, err := s.OrganizeChat(ctx, other.ID, ChatOrganization{FolderID: &missing, Revision: &rev}); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	saved, err = s.Chat(ctx, other.ID)
	must(t, err)
	if saved.OrganizationRevision != rev {
		t.Fatal("failed move changed chat", saved)
	}
	noFolder := ""
	_, err = s.OrganizeChat(ctx, other.ID, ChatOrganization{FolderID: &noFolder, Revision: &rev})
	must(t, err)
	if _, err = s.RemoveFolder(ctx, empty.ID, empty.Revision); err != nil {
		t.Fatal(err)
	}
	folders, err = s.Folders(ctx)
	must(t, err)
	if len(folders) != 0 {
		t.Fatal(folders)
	}
}

func TestConcurrentFolderNamesAndStaleEdits(t *testing.T) {
	s := openTest(t, t.TempDir())
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wg.Go(func() { _, err := s.SaveFolder(ctx, ChatFolder{Name: "Release"}); results <- err })
	}
	wg.Wait()
	close(results)
	successes, duplicates := 0, 0
	for err := range results {
		if err == nil {
			successes++
		} else if errors.Is(err, ErrFolderName) {
			duplicates++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || duplicates != 1 {
		t.Fatal(successes, duplicates)
	}
	folders, err := s.Folders(ctx)
	must(t, err)
	original := folders[0]
	edit := original
	edit.Name = "Renamed"
	renamed, err := s.SaveFolder(ctx, edit)
	must(t, err)
	if _, err = s.SaveFolder(ctx, original); !errors.Is(err, ErrStale) {
		t.Fatal(err)
	}
	if _, err = s.RemoveFolder(ctx, original.ID, original.Revision); !errors.Is(err, ErrStale) {
		t.Fatal(err)
	}
	_, err = s.RemoveFolder(ctx, renamed.ID, renamed.Revision)
	must(t, err)
	if _, err = s.SaveFolder(ctx, renamed); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
}

func TestFolderRemovalRacesMembershipChange(t *testing.T) {
	s := openTest(t, t.TempDir())
	_, c := fixture(t, s)
	f, err := s.SaveFolder(ctx, ChatFolder{Name: "Planning"})
	must(t, err)
	results := make(chan error, 2)
	var wg sync.WaitGroup
	wg.Go(func() {
		revision := c.OrganizationRevision
		_, err := s.OrganizeChat(ctx, c.ID, ChatOrganization{FolderID: &f.ID, Revision: &revision})
		results <- err
	})
	wg.Go(func() { _, err := s.RemoveFolder(ctx, f.ID, f.Revision); results <- err })
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil && !errors.Is(err, ErrNotFound) {
			t.Fatal(err)
		}
	}
	saved, err := s.Chat(ctx, c.ID)
	must(t, err)
	if saved.FolderID != "" || saved.Title != c.Title {
		t.Fatal(saved)
	}
	folders, err := s.Folders(ctx)
	must(t, err)
	if len(folders) != 0 {
		t.Fatal(folders)
	}
}
