package chat

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestQuestionPollingPausesWithoutSSEOrBrowserAndPreservesPauseOnFailure(t *testing.T) {
	f := newFixture(t)
	s, p, project := testService(t, f)
	clock := &activityClock{testProvisioner: p, now: time.Now()}
	s.provisioner = clock
	s.questionPollInterval = 20 * time.Millisecond
	s.questionPollTimeout = 50 * time.Millisecond
	c, err := s.Create(context.Background(), project.ID, "Question", "first", "Inspect")
	if err != nil {
		t.Fatal(err)
	}
	<-f.started
	close(f.streamStop)
	f.mu.Lock()
	f.question = true
	f.mu.Unlock()
	waitStatus(t, s, c.ID, storage.Waiting)
	if clock.advanceAndSweep(3*time.Hour) != 0 {
		t.Fatal("a question missed by SSE consumed the activity budget")
	}
	rows, _ := s.Store.Activities(context.Background(), c.ID, 0, 1000)
	foundSnapshot := false
	for _, row := range rows {
		if row.Kind == "runtime.question.asked" {
			t.Fatal("test did not miss the question event")
		}
		if row.Kind == "question.snapshot" {
			foundSnapshot = true
		}
	}
	if !foundSnapshot || p.endpoints.Load() != 0 {
		t.Fatal("question pause depended on a browser/API viewer")
	}
	f.mu.Lock()
	f.questionFailure = "status"
	f.mu.Unlock()
	deadline := time.Now().Add(3 * time.Second)
	foundFailure := false
	for time.Now().Before(deadline) {
		rows, _ = s.Store.Activities(context.Background(), c.ID, 0, 1000)
		for _, row := range rows {
			if row.Kind == "question.poll.error" {
				foundFailure = true
			}
		}
		if foundFailure {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !foundFailure || clock.advanceAndSweep(3*time.Hour) != 0 {
		t.Fatal("a failed question poll resumed the clock")
	}
	f.mu.Lock()
	f.questionFailure = "hang"
	f.mu.Unlock()
	before := f.questionCompletions.Load()
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && f.questionCompletions.Load() < before+2 {
		time.Sleep(10 * time.Millisecond)
	}
	if f.questionCompletions.Load() < before+2 || f.questionMaxInFlight.Load() > 1 {
		t.Fatal("question requests were unbounded or overlapped")
	}
	if clock.advanceAndSweep(3*time.Hour) != 0 {
		t.Fatal("a timed-out poll falsely resumed the clock")
	}
	current, _ := s.Store.Chat(context.Background(), c.ID)
	if current.Status != storage.Waiting || current.StatusReason != "Flora needs your answer" {
		t.Fatal("poll failure cleared a known question")
	}
	// A successful fresh snapshot, rather than a missing SSE reply, confirms
	// that the process-local question no longer exists.
	f.mu.Lock()
	f.question = false
	f.questionFailure = ""
	f.mu.Unlock()
	waitStatus(t, s, c.ID, storage.Working)
	if clock.advanceAndSweep(59*time.Minute) != 0 {
		t.Fatal("successful question resolution did not start a fresh window")
	}
	if clock.advanceAndSweep(2*time.Minute) != 1 {
		t.Fatal("resumed work lost timeout enforcement")
	}
	f.release <- false
	waitStatus(t, s, c.ID, storage.Idle)
}

func TestQuestionSnapshotsCannotUndoNewerEventsOrConfirmedAnswers(t *testing.T) {
	f := newFixture(t)
	s, p, project := testService(t, f)
	ctx := context.Background()
	c, err := s.Store.CreateChat(ctx, project.ID, "Question", testImage, "1.2.27")
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := s.Store.AcceptMessage(ctx, c.ID, "first", "Inspect")
	if err != nil {
		t.Fatal(err)
	}
	clock := &activityClock{testProvisioner: p, now: time.Now()}
	a := &turnActivity{provisioner: clock, containerID: "container", messageID: accepted.Message.ID, questions: map[string]bool{}}
	s.turns[c.ID] = a
	clock.BeginActivity("container")
	event := func(id string) {
		t.Helper()
		b, _ := json.Marshal(map[string]any{"properties": map[string]string{"id": id}})
		if err := s.runtimeActivity(c.ID, a, "question.asked", b); err != nil {
			t.Fatal(err)
		}
	}
	event("one")
	oldVersion := a.questionVersion()
	event("two")
	if _, err := s.reconcileQuestions(ctx, c.ID, "ses_one", a, questionSnapshot{questions: []Question{}, version: oldVersion}, nil); err != nil {
		t.Fatal(err)
	}
	if clock.advanceAndSweep(2*time.Hour) != 0 {
		t.Fatal("stale empty poll cleared a newer question event")
	}
	s.questionActivity(c.ID, accepted.Message.ID, "one", true)
	var stale []Question
	if err := json.Unmarshal([]byte(`[{"id":"one","sessionID":"ses_one","questions":[]}]`), &stale); err != nil {
		t.Fatal(err)
	}
	if _, err := s.reconcileQuestions(ctx, c.ID, "ses_one", a, questionSnapshot{questions: stale, version: oldVersion}, nil); err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	resurrected := a.questions["one"]
	a.mu.Unlock()
	if resurrected {
		t.Fatal("stale positive poll resurrected an answered question")
	}
	if _, err := s.reconcileQuestions(ctx, c.ID, "ses_one", a, questionSnapshot{version: a.questionVersion(), err: errors.New("unavailable")}, nil); err == nil {
		t.Fatal("failed snapshot was accepted")
	}
	if clock.advanceAndSweep(2*time.Hour) != 0 {
		t.Fatal("failed snapshot resumed the remaining question")
	}
	if _, err := s.reconcileQuestions(ctx, c.ID, "ses_one", a, questionSnapshot{questions: []Question{}, version: a.questionVersion()}, nil); err != nil {
		t.Fatal(err)
	}
	if clock.advanceAndSweep(59*time.Minute) != 0 || clock.advanceAndSweep(2*time.Minute) != 1 {
		t.Fatal("fresh snapshot did not resume the active clock exactly once")
	}
}

func TestPendingQuestionRequestsRequireCompleteBoundedResponses(t *testing.T) {
	for _, mode := range []string{"status", "invalid", "null", "oversized", "hang"} {
		t.Run(mode, func(t *testing.T) {
			f := newFixture(t)
			f.mu.Lock()
			f.question = true
			f.questionFailure = mode
			f.mu.Unlock()
			rt := newRuntime(provisioning.Endpoint{URL: f.server.URL, Username: "opencode", Password: "runtime_SECRET"})
			defer rt.client.CloseIdleConnections()
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()
			questions, err := rt.pendingQuestions(ctx)
			if err == nil || questions != nil || strings.Contains(err.Error(), "SECRET") {
				t.Fatal("failed question response became an authoritative empty snapshot")
			}
		})
	}
}
