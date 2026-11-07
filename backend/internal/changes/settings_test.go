package changes

import (
	"context"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"strings"
	"testing"
)

func TestInlineThresholdChangesViewWithoutChangingSnapshot(t *testing.T) {
	ctx := context.Background()
	s, c, e := fixture(t)
	write(t, e.dir, "threshold", strings.Repeat("new line\n", 200))
	if err := s.Refresh(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	full, err := s.Read(ctx, c.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	p := storage.DefaultPreferences()
	p.InlineDiffBytes = 1024
	if err := s.Store.SavePreferences(ctx, p); err != nil {
		t.Fatal(err)
	}
	inline, err := s.Read(ctx, c.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, f := range inline.Snapshot.Files {
		if f.Path == "threshold" {
			found = true
			if !f.Truncated || f.Diff != "" || f.Bytes <= 1024 {
				t.Fatal("saved inline limit ignored")
			}
		}
	}
	if !found {
		t.Fatal("missing fixture diff")
	}
	saved, err := s.Read(ctx, c.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Snapshot.ID != full.Snapshot.ID {
		t.Fatal("threshold changed snapshot identity")
	}
	for i, f := range saved.Snapshot.Files {
		if f.Diff != full.Snapshot.Files[i].Diff {
			t.Fatal("view threshold changed stored full diff")
		}
	}
	p.InlineDiffBytes = 1 << 20
	if err := s.Store.SavePreferences(ctx, p); err != nil {
		t.Fatal(err)
	}
	expanded, err := s.Read(ctx, c.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range expanded.Snapshot.Files {
		if f.Path == "threshold" && (f.Truncated || f.Diff == "") {
			t.Fatal("raised threshold did not restore inline diff")
		}
	}
}
