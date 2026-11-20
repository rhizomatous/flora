package storage

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestReadPositionsSurviveRestartAndBoundConcurrentActivity(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	_, first := fixture(t, s)
	_, second := fixture(t, s)
	before, err := s.Chat(ctx, first.ID)
	must(t, err)
	// Activity arriving after the client snapshot must remain unread.
	must(t, s.AppendActivity(ctx, first.ID, "new", "message.runtime", json.RawMessage(`{}`)))
	_, err = s.MarkChatsRead(ctx, []ViewedRevision{{first.ID, before.ActivityRevision}})
	must(t, err)
	newer, err := s.Chat(ctx, first.ID)
	must(t, err)
	if newer.LastViewedRevision != before.ActivityRevision || newer.ActivityRevision <= newer.LastViewedRevision {
		t.Fatal(newer)
	}
	other, err := s.Chat(ctx, second.ID)
	must(t, err)
	if other.LastViewedRevision != 0 {
		t.Fatal("unselected chat was marked read")
	}
	_, err = s.MarkChatsRead(ctx, []ViewedRevision{{first.ID, newer.ActivityRevision}})
	must(t, err)
	// An older tab retry cannot undo a newer acknowledgement.
	_, err = s.MarkChatsRead(ctx, []ViewedRevision{{first.ID, before.ActivityRevision}})
	must(t, err)
	must(t, s.Close())
	s = openTest(t, root)
	defer s.Close()
	saved, err := s.Chat(ctx, first.ID)
	must(t, err)
	if saved.LastViewedRevision != newer.ActivityRevision || saved.UpdatedAt != newer.UpdatedAt || saved.Status != newer.Status {
		t.Fatal(saved)
	}
	// Positions cannot point to another chat's activity or invented future updates.
	for _, revision := range []int64{other.ActivityRevision, saved.ActivityRevision + 10000, -1} {
		if _, err := s.MarkChatsRead(ctx, []ViewedRevision{{first.ID, revision}}); !errors.Is(err, ErrInvalid) {
			t.Fatal(err)
		}
	}
	// A bad batch rolls back every position.
	if _, err := s.MarkChatsRead(ctx, []ViewedRevision{{second.ID, other.ActivityRevision}, {"missing", 0}}); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	other, err = s.Chat(ctx, second.ID)
	must(t, err)
	if other.LastViewedRevision != 0 {
		t.Fatal("partial transaction")
	}
	// Renaming and archiving never create unread execution activity.
	title, yes, revision := "Renamed", true, saved.OrganizationRevision
	organized, err := s.OrganizeChat(ctx, saved.ID, ChatOrganization{Title: &title, Archived: &yes, Revision: &revision})
	must(t, err)
	if organized.ActivityRevision != saved.ActivityRevision || organized.LastViewedRevision != saved.LastViewedRevision {
		t.Fatal(organized)
	}
}
