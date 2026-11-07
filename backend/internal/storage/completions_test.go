package storage

import (
	"fmt"
	"sync"
	"testing"
)

func TestCompletionFeedIsAtomicAndSkipsHistory(t *testing.T) {
	s := openTest(t, t.TempDir())
	_, c := fixture(t, s)
	events, cursor, err := s.Completions(ctx, nil)
	must(t, err)
	if len(events) != 0 {
		t.Fatal("initial load replayed history")
	}
	for i, status := range []Status{Failed, Idle, Stopped} {
		a, err := s.AcceptMessage(ctx, c.ID, fmt.Sprint(i), "work")
		must(t, err)
		must(t, s.Transition(ctx, c.ID, a.Message.ID, status, "Turn completed; ready for a follow-up"))
	}
	events, _, err = s.Completions(ctx, &cursor)
	must(t, err)
	if len(events) != 0 {
		t.Fatal("status or English reason became a completion")
	}
	a, err := s.AcceptMessage(ctx, c.ID, "success", "work")
	must(t, err)
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			err := s.CompleteTurn(ctx, c.ID, a.Message.ID, "An independently worded success")
			if err != nil && err != ErrStale {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	events, next, err := s.Completions(ctx, &cursor)
	must(t, err)
	if len(events) != 1 || events[0].ChatID != c.ID || events[0].EventID != "completed:"+a.Message.ID || next != events[0].Sequence {
		t.Fatal(events, next)
	}
	saved, err := s.Chat(ctx, c.ID)
	must(t, err)
	if saved.Status != Idle || saved.ActiveMessageID != "" {
		t.Fatal("completion saved without terminal state", saved)
	}
	replay, again, err := s.Completions(ctx, &cursor)
	must(t, err)
	if len(replay) != 1 || again != next {
		t.Fatal("event identity changed on replay")
	}
	events, _, err = s.Completions(ctx, &next)
	must(t, err)
	if len(events) != 0 {
		t.Fatal("cursor repeated completion")
	}
	events, baseline, err := s.Completions(ctx, nil)
	must(t, err)
	if len(events) != 0 || baseline < next {
		t.Fatal("fresh load replayed completion")
	}
}

func TestCompletionFeedPagesMissedTurns(t *testing.T) {
	s := openTest(t, t.TempDir())
	_, c := fixture(t, s)
	after := int64(0)
	for i := range 103 {
		a, err := s.AcceptMessage(ctx, c.ID, fmt.Sprint(i), "work")
		must(t, err)
		must(t, s.CompleteTurn(ctx, c.ID, a.Message.ID, "Done"))
	}
	first, cursor, err := s.Completions(ctx, &after)
	must(t, err)
	second, next, err := s.Completions(ctx, &cursor)
	must(t, err)
	if len(first) != 100 || len(second) != 3 || second[0].Sequence <= cursor || next < second[2].Sequence {
		t.Fatal("missed completions were skipped across pages", len(first), len(second), cursor, next)
	}
	must(t, s.AppendActivity(ctx, c.ID, "later", "runtime", []byte(`{}`)))
	empty, final, err := s.Completions(ctx, &next)
	must(t, err)
	if len(empty) != 0 || final <= next {
		t.Fatal("cursor did not advance past non-completion activity")
	}
}
