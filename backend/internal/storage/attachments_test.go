package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	stdimage "image"
	"image/png"
	"strings"
	"testing"
	"time"
)

func TestAttachmentValidation(t *testing.T) {
	var pngBytes bytes.Buffer
	if err := png.Encode(&pngBytes, stdimage.NewRGBA(stdimage.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name  string
		data  []byte
		valid bool
	}{
		{"screen.png", pngBytes.Bytes(), true}, {"../screen.png", pngBytes.Bytes(), false}, {"C:\\screen.png", pngBytes.Bytes(), false},
		{"screen.png", []byte("not an image"), false}, {"screen.jpg", pngBytes.Bytes(), false}, {"unsafe.svg", []byte("<svg/>"), false},
		{"spec.pdf", []byte("%PDF-1.7\n"), true}, {"spec.pdf", []byte("<html/>"), false},
		{"notes.md", []byte("# Task\n🌸"), true}, {"notes.txt", []byte{0xff}, false}, {"binary.txt", []byte{0}, false},
		{"empty.txt", nil, false}, {"huge.txt", bytes.Repeat([]byte("x"), 1<<20+1), false}, {"huge.pdf", bytes.Repeat([]byte("x"), MaxAttachmentBytes+1), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := ValidateAttachment(test.name, test.data)
			if (err == nil) != test.valid {
				t.Fatalf("valid=%v: %v", test.valid, err)
			}
		})
	}
}

func TestAttachmentAcceptancePersistenceAndCleanup(t *testing.T) {
	ctx := context.Background()
	directory := t.TempDir()
	s, err := Open(ctx, directory)
	must(t, err)
	project, err := s.CreateProject(ctx, "Project", Configuration{Repositories: []Repository{{Name: "flora", URL: "https://github.com/rhizomatous/flora", BaseBranch: "main", Role: "core"}}})
	must(t, err)
	other, err := s.CreateProject(ctx, "Other", Configuration{Repositories: []Repository{{Name: "flora", URL: "https://github.com/rhizomatous/flora", BaseBranch: "main", Role: "core"}}})
	must(t, err)
	first, err := s.PutAttachment(ctx, project.ID, "attachment-first-0001", "task.md", []byte("details"))
	must(t, err)
	again, err := s.PutAttachment(ctx, project.ID, first.ID, "task.md", []byte("details"))
	must(t, err)
	if first != again {
		t.Fatal("upload retry changed metadata")
	}
	_, err = s.PutAttachment(ctx, project.ID, first.ID, "task.md", []byte("changed"))
	if !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	c, err := s.CreateChatRequest(ctx, project.ID, "Attached files", image, "1.2.27", "creation", "", first.ID)
	must(t, err)
	_, err = s.CreateChatRequest(ctx, project.ID, "Attached files", image, "1.2.27", "creation", "", first.ID, first.ID)
	if !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	accepted, err := s.AcceptMessage(ctx, c.ID, "creation", "", first.ID)
	must(t, err)
	if accepted.Message.Text != "" || !json.Valid(accepted.Message.Payload) || !strings.Contains(string(accepted.Message.Payload), "/api/attachments/") {
		t.Fatalf("missing stable payload: %s", accepted.Message.Payload)
	}
	retry, err := s.AcceptMessage(ctx, c.ID, "creation", "", first.ID)
	must(t, err)
	if !retry.Duplicate || retry.Message.ID != accepted.Message.ID {
		t.Fatal("duplicate accepted")
	}
	_, err = s.AcceptMessage(ctx, c.ID, "creation", "changed", first.ID)
	if !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	must(t, s.Transition(ctx, c.ID, accepted.Message.ID, Stopped, "stopped"))
	_, err = s.AcceptMessage(ctx, c.ID, "reuse", "", first.ID)
	if err == nil {
		t.Fatal("reused accepted attachment")
	}
	foreign, err := s.PutAttachment(ctx, other.ID, "attachment-other-0001", "task.txt", []byte("foreign"))
	must(t, err)
	_, err = s.AcceptMessage(ctx, c.ID, "foreign", "", foreign.ID)
	if err == nil {
		t.Fatal("accepted another project's upload")
	}
	_, err = s.AcceptMessage(ctx, c.ID, "duplicate", "", foreign.ID, foreign.ID)
	if err == nil {
		t.Fatal("accepted duplicate references")
	}
	must(t, s.RemoveAttachment(ctx, first.ID))
	a, data, err := s.Attachment(ctx, first.ID)
	must(t, err)
	if a.Name != "task.md" || string(data) != "details" {
		t.Fatal("removal erased accepted bytes")
	}
	abandoned, err := s.PutAttachment(ctx, project.ID, "attachment-abandoned-1", "draft.txt", []byte("draft"))
	must(t, err)
	reserved, err := s.PutAttachment(ctx, project.ID, "attachment-reserved-1", "draft.txt", []byte("reserved"))
	must(t, err)
	_, err = s.CreateChatRequest(ctx, project.ID, "Reserved", image, "1.2.27", "reserved", "", reserved.ID)
	must(t, err)
	_, err = s.db.Exec("UPDATE attachments SET created_at=?", time.Now().Add(-25*time.Hour).UTC().Format(time.RFC3339Nano))
	must(t, err)
	must(t, s.CleanupAttachments(ctx))
	for _, id := range []string{abandoned.ID, reserved.ID, foreign.ID} {
		_, _, err = s.Attachment(ctx, id)
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("abandoned retained: %v", err)
		}
	}
	must(t, s.Close())
	s, err = Open(ctx, directory)
	must(t, err)
	defer s.Close()
	_, data, err = s.Attachment(ctx, first.ID)
	must(t, err)
	if string(data) != "details" {
		t.Fatal("accepted bytes did not survive reopen")
	}
}

func TestAttachmentMessageLimitsAreAtomic(t *testing.T) {
	s := openTest(t, t.TempDir())
	project, chat := fixture(t, s)
	large := append([]byte("%PDF-1.7\n"), bytes.Repeat([]byte("x"), MaxAttachmentBytes-9)...)
	ids := []string{}
	for i := range 4 {
		file, err := s.PutAttachment(ctx, project.ID, fmt.Sprintf("large-attachment-%04d", i), "large.pdf", large)
		must(t, err)
		ids = append(ids, file.ID)
	}
	extra, err := s.PutAttachment(ctx, project.ID, "extra-attachment-0001", "extra.txt", []byte("x"))
	must(t, err)
	if _, err := s.AcceptMessage(ctx, chat.ID, "too-large", "", append(ids, extra.ID)...); err == nil {
		t.Fatal("accepted more than 20 MiB")
	}
	if _, err := s.AcceptMessage(ctx, chat.ID, "too-many", "", append(ids, extra.ID, extra.ID)...); err == nil {
		t.Fatal("accepted more than 5 files")
	}
	if _, err := s.AcceptMessage(ctx, chat.ID, "duplicates", "", extra.ID, extra.ID); !errors.Is(err, ErrInvalid) {
		t.Fatalf("duplicate IDs accepted: %v", err)
	}
	var bound int
	must(t, s.db.QueryRow("SELECT count(*) FROM attachments WHERE chat_id IS NOT NULL").Scan(&bound))
	if bound != 0 {
		t.Fatal("failed acceptance reserved files")
	}
	accepted, err := s.AcceptMessage(ctx, chat.ID, "exact-limit", "", ids...)
	must(t, err)
	if accepted.Message.ID == "" {
		t.Fatal("20 MiB acceptance failed")
	}
}

func TestAttachmentsUpgradePreservesChatOrganization(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	_, chat := fixture(t, s)
	_, err := s.db.Exec("UPDATE chats SET pinned_at=?,archived=1,organization_revision=3 WHERE id=?", "2026-11-17T00:00:00Z", chat.ID)
	must(t, err)
	_, err = s.db.Exec("DROP TABLE chat_read_state; ALTER TABLE chat_requests DROP COLUMN context_references; ALTER TABLE chat_requests DROP COLUMN branches; ALTER TABLE chats DROP COLUMN execution; ALTER TABLE chat_requests DROP COLUMN selection; DROP TABLE attachments; ALTER TABLE chat_requests DROP COLUMN attachments; PRAGMA user_version=13")
	must(t, err)
	must(t, s.Close())
	s = openTest(t, root)
	saved, err := s.Chat(ctx, chat.ID)
	must(t, err)
	if saved.PinnedAt != "2026-11-17T00:00:00Z" || !saved.Archived || saved.OrganizationRevision != 3 {
		t.Fatalf("upgrade changed organization: %+v", saved)
	}
	file, err := s.PutAttachment(ctx, saved.ProjectID, "upgraded-attachment-001", "task.txt", []byte("new input"))
	must(t, err)
	accepted, err := s.AcceptMessage(ctx, saved.ID, "after-upgrade", "", file.ID)
	must(t, err)
	if accepted.Message.ID == "" {
		t.Fatal("upgraded chat cannot accept attachments")
	}
}
