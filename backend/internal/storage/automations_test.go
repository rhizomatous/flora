package storage

import (
	"sync"
	"testing"
	"time"
)

func automationConfig() AutomationConfig {
	return AutomationConfig{Name: "Dependencies", Instructions: "Check dependencies", Mode: "same", Frequency: "daily", Days: []int{1}, Time: "09:00", TimeZone: "America/New_York"}
}
func instant(t *testing.T, v string) time.Time {
	t.Helper()
	at, err := time.Parse(time.RFC3339, v)
	must(t, err)
	return at
}
func TestAutomationWallClock(t *testing.T) {
	for _, tt := range []struct{ name, at, clock, frequency, want string }{
		{"spring offset", "2026-03-07T15:00:00Z", "09:00", "daily", "2026-03-08T13:00:00Z"},
		{"nonexistent hour", "2026-03-07T15:00:00Z", "02:30", "daily", "2026-03-09T06:30:00Z"},
		{"fall repeated hour once", "2026-11-01T05:30:00Z", "01:30", "daily", "2026-11-02T06:30:00Z"},
		{"weekend", "2026-11-13T14:00:00Z", "09:00", "weekdays", "2026-11-16T14:00:00Z"},
		{"weekly", "2026-11-16T14:00:00Z", "09:00", "weekly", "2026-11-23T14:00:00Z"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			c := automationConfig()
			c.Time = tt.clock
			c.Frequency = tt.frequency
			got, err := c.Next(instant(t, tt.at))
			must(t, err)
			if !got.Equal(instant(t, tt.want)) {
				t.Fatalf("got %s want %s", got, tt.want)
			}
		})
	}
}
func TestAutomationClaimHistoryAndRecovery(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	p, c := fixture(t, s)
	at := instant(t, "2026-11-15T14:00:00Z")
	a, err := s.SaveAutomation(ctx, Automation{AutomationConfig: automationConfig(), ProjectID: p.ID, Enabled: true}, at)
	must(t, err)
	due := instant(t, a.NextRun)
	var wg sync.WaitGroup
	claims := make(chan bool, 8)
	for range 8 {
		wg.Go(func() {
			_, _, claimed, err := s.ClaimAutomation(ctx, a.ID, "", due, true)
			if err != nil {
				t.Error(err)
			}
			claims <- claimed
		})
	}
	wg.Wait()
	close(claims)
	count := 0
	for claim := range claims {
		if claim {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("claimed %d times", count)
	}
	runs, err := s.AutomationRuns(ctx, a.ID)
	must(t, err)
	if len(runs) != 1 {
		t.Fatal(runs)
	}
	r := runs[0]
	accepted, err := s.AcceptMessage(ctx, c.ID, r.ID, a.Instructions)
	must(t, err)
	must(t, s.Transition(ctx, c.ID, accepted.Message.ID, Waiting, "Needs an answer"))
	_, skipped, claimed, err := s.ClaimAutomation(ctx, a.ID, "blocked", due, false)
	must(t, err)
	if claimed || skipped.Status != "skipped" {
		t.Fatal(skipped)
	}
	must(t, s.CompleteTurn(ctx, c.ID, accepted.Message.ID, "Done"))
	// An ordinary follow-up must not rewrite the completed automation result.
	followup, err := s.AcceptMessage(ctx, c.ID, "user-followup", "Please explain")
	must(t, err)
	must(t, s.Transition(ctx, c.ID, followup.Message.ID, Failed, "Unrelated failure"))
	runs, err = s.AutomationRuns(ctx, a.ID)
	must(t, err)
	if runs[1].Status != "completed" {
		t.Fatal(runs)
	}
	_, manual, claimed, err := s.ClaimAutomation(ctx, a.ID, "manual", due, false)
	must(t, err)
	if !claimed {
		t.Fatal(manual)
	}
	_, duplicate, claimed, err := s.ClaimAutomation(ctx, a.ID, "manual", due, false)
	must(t, err)
	if claimed || duplicate.ID != manual.ID {
		t.Fatal(duplicate)
	}
	reserved, err := s.CreateChatRequest(ctx, p.ID, a.Name, image, "1.2.27", manual.ID, a.Instructions)
	must(t, err)
	must(t, s.Close())
	s = openTest(t, root)
	must(t, s.RecoverAutomationRuns(ctx))
	runs, err = s.AutomationRuns(ctx, a.ID)
	must(t, err)
	if runs[0].Status != "failed" || runs[0].ChatID != reserved.ID {
		t.Fatal(runs)
	}
	saved, err := s.Automation(ctx, a.ID)
	must(t, err)
	if saved.ChatID != reserved.ID {
		t.Fatal(saved)
	}
	saved.Mode = "new"
	saved, err = s.SaveAutomation(ctx, saved, due)
	must(t, err)
	saved.Mode = "same"
	saved, err = s.SaveAutomation(ctx, saved, due)
	must(t, err)
	must(t, s.RecoverAutomationRuns(ctx))
	saved, err = s.Automation(ctx, a.ID)
	must(t, err)
	if saved.ChatID != "" {
		t.Fatal("recovery undid a destination change")
	}
	messages, err := s.Messages(ctx, reserved.ID)
	must(t, err)
	if len(messages) != 0 {
		t.Fatal("recovery submitted a message")
	}
}
func TestAutomationEditsPauseAndMissedRuns(t *testing.T) {
	s := openTest(t, t.TempDir())
	p, _ := fixture(t, s)
	at := instant(t, "2026-11-15T14:00:00Z")
	a, err := s.SaveAutomation(ctx, Automation{AutomationConfig: automationConfig(), ProjectID: p.ID, Enabled: true}, at)
	must(t, err)
	later := instant(t, a.NextRun).Add(48 * time.Hour)
	_, run, claimed, err := s.ClaimAutomation(ctx, a.ID, "", later, true)
	must(t, err)
	if claimed || run.Status != "skipped" {
		t.Fatal(run)
	}
	current, err := s.Automation(ctx, a.ID)
	must(t, err)
	if !instant(t, current.NextRun).After(later) {
		t.Fatal(current)
	}
	current.Enabled = false
	paused, err := s.SaveAutomation(ctx, current, later)
	must(t, err)
	_, _, claimed, err = s.ClaimAutomation(ctx, a.ID, "", later.Add(48*time.Hour), true)
	must(t, err)
	if claimed {
		t.Fatal("paused automation ran")
	}
	_, err = s.SaveAutomation(ctx, current, later)
	wantError(t, err, ErrStale)
	paused.Enabled = true
	resumed, err := s.SaveAutomation(ctx, paused, later.Add(48*time.Hour))
	must(t, err)
	if !instant(t, resumed.NextRun).After(later.Add(48 * time.Hour)) {
		t.Fatal(resumed)
	}
	for _, bad := range []AutomationConfig{
		{Name: "x", Instructions: "x", Mode: "existing", Frequency: "daily", Time: "09:00", TimeZone: "UTC"},
		{Name: "x", Instructions: "x", Mode: "new", Frequency: "weekly", Time: "09:00", TimeZone: "UTC"},
		{Name: "x", Instructions: "x", Mode: "new", Frequency: "daily", Time: "25:00", TimeZone: "UTC"},
		{Name: "x", Instructions: "x", Mode: "new", Frequency: "daily", Time: "09:00", TimeZone: "Local"},
	} {
		if bad.Validate() == nil {
			t.Fatal("accepted invalid schedule", bad)
		}
	}
}
