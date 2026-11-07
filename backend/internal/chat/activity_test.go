package chat

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type activityClock struct {
	*testProvisioner
	mu    sync.Mutex
	now   time.Time
	since *time.Time
	stops int
}

func (p *activityClock) BeginActivity(string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.since == nil {
		since := p.now
		p.since = &since
	}
}
func (p *activityClock) EndActivity(string) { p.mu.Lock(); defer p.mu.Unlock(); p.since = nil }
func (p *activityClock) advanceAndSweep(d time.Duration) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.now = p.now.Add(d)
	if p.since != nil && p.now.Sub(*p.since) > time.Hour {
		p.stops++
		p.since = nil
	}
	return p.stops
}

func TestQuestionPausesClockDespiteBusyAndRetry(t *testing.T) {
	f := newFixture(t)
	s, p, project := testService(t, f)
	clock := &activityClock{testProvisioner: p, now: time.Now()}
	s.provisioner = clock
	c, err := s.Create(context.Background(), project.ID, "Question", "first", "Inspect")
	if err != nil {
		t.Fatal(err)
	}
	<-f.started
	f.mu.Lock()
	f.question = true
	f.mu.Unlock()
	f.events <- `{"type":"question.asked","properties":{"sessionID":"ses_one","id":"que_one","questions":[]}}`
	waitStatus(t, s, c.ID, storage.Waiting)
	f.events <- `{"type":"session.status","properties":{"sessionID":"ses_one","status":{"type":"busy"}}}`
	f.events <- `{"type":"session.status","properties":{"sessionID":"ses_one","status":{"type":"retry","attempt":1,"message":"retrying","next":123}}}`
	time.Sleep(30 * time.Millisecond)
	if clock.advanceAndSweep(3*time.Hour) != 0 {
		t.Fatal("user question consumed the activity budget")
	}
	if err := s.Reply(context.Background(), c.ID, "que_one", [][]string{{"Yes"}}); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, s, c.ID, storage.Working)
	if clock.advanceAndSweep(59*time.Minute) != 0 {
		t.Fatal("answer did not start a fresh activity window")
	}
	if clock.advanceAndSweep(2*time.Minute) != 1 {
		t.Fatal("resumed execution lost timeout enforcement")
	}
	f.release <- false
	waitStatus(t, s, c.ID, storage.Idle)
}

func TestMultipleQuestionsAndRetryClock(t *testing.T) {
	clock := &activityClock{now: time.Now()}
	a := &turnActivity{provisioner: clock, containerID: "container", questions: map[string]bool{}}
	clock.BeginActivity("container")
	event := func(kind, key, id string) {
		b, _ := json.Marshal(map[string]any{"properties": map[string]string{key: id}})
		a.event(kind, b)
	}
	event("question.asked", "id", "one")
	event("question.asked", "id", "two")
	event("question.replied", "requestID", "one")
	if clock.advanceAndSweep(2*time.Hour) != 0 {
		t.Fatal("second question did not keep clock paused")
	}
	event("question.rejected", "requestID", "two")
	clock.advanceAndSweep(59 * time.Minute)
	event("question.replied", "requestID", "two")
	event("question.asked", "id", "two")
	a.event("session.status", json.RawMessage(`{"properties":{"status":{"type":"retry","attempt":2,"message":"retrying","next":123}}}`))
	if clock.advanceAndSweep(2*time.Minute) != 1 {
		t.Fatal("duplicate question events or retry reset the active clock")
	}
}
