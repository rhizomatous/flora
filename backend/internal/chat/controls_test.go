package chat

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

type controlledProvisioner struct {
	*testProvisioner
	confirm, release   chan struct{}
	starting, canceled chan struct{}
	stopError          atomic.Bool
	expired            atomic.Bool
	stops              atomic.Int32
	failChat           string
}

func (p *controlledProvisioner) Start(ctx context.Context, id string) (provisioning.Endpoint, error) {
	if p.starting != nil {
		close(p.starting)
		<-ctx.Done()
		close(p.canceled)
		return provisioning.Endpoint{}, ctx.Err()
	}
	return p.testProvisioner.Start(ctx, id)
}
func (p *controlledProvisioner) ConfirmInterrupt(ctx context.Context, _ string) error {
	if p.confirm != nil {
		close(p.confirm)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-p.release:
		}
	}
	return nil
}
func (p *controlledProvisioner) Stop(_ context.Context, chatID string) error {
	p.stops.Add(1)
	if p.stopError.Load() && (p.failChat == "" || p.failChat == chatID) {
		return errors.New("unconfirmed stop secret-diagnostic")
	}
	return nil
}
func (p *controlledProvisioner) ActivityExpired(string) bool { return p.expired.Load() }

func awaitPrompt(t *testing.T, f *runtimeFixture) {
	t.Helper()
	select {
	case <-f.started:
	case <-time.After(5 * time.Second):
		t.Fatal("prompt did not start")
	}
}

func TestInterruptJoinsBeforeAcceptingConcurrentFollowups(t *testing.T) {
	f := newFixture(t)
	s, base, project := testService(t, f)
	p := &controlledProvisioner{testProvisioner: base, confirm: make(chan struct{}), release: make(chan struct{})}
	s.provisioner = p
	c, err := s.Create(context.Background(), project.ID, "Interrupt", "first", "long command")
	if err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	f.mu.Lock()
	f.question = true
	f.mu.Unlock()
	interrupted := make(chan error, 1)
	go func() { interrupted <- s.Interrupt(context.Background(), c.ID) }()
	select {
	case <-p.confirm:
	case <-time.After(5 * time.Second):
		t.Fatal("no teardown verification")
	}
	current, _ := s.Store.Chat(context.Background(), c.ID)
	if current.ActiveMessageID == "" || current.Status != storage.Working {
		t.Fatal("turn released before teardown")
	}
	var accepted atomic.Int32
	var wg sync.WaitGroup
	for i := range 8 {
		wg.Go(func() {
			_, err := s.Submit(context.Background(), c.ID, string(rune('a'+i)), "follow-up")
			if err == nil {
				accepted.Add(1)
			} else if !errors.Is(err, storage.ErrActive) {
				t.Errorf("submit: %v", err)
			}
		})
	}
	time.Sleep(30 * time.Millisecond)
	if accepted.Load() != 0 {
		t.Fatal("accepted during teardown")
	}
	close(p.release)
	if err := <-interrupted; err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	if accepted.Load() != 1 {
		t.Fatalf("accepted %d concurrent turns", accepted.Load())
	}
	awaitPrompt(t, f)
	f.release <- false
	final := waitStatus(t, s, c.ID, storage.Idle)
	if final.SessionID != "ses_one" || f.sessions.Load() != 1 || f.prompts.Load() != 2 {
		t.Fatal("lost session or replayed interrupted turn")
	}
}

func TestStopDuringStartCancelsUnderlyingContextAndRepeatedStop(t *testing.T) {
	f := newFixture(t)
	s, base, project := testService(t, f)
	p := &controlledProvisioner{testProvisioner: base, starting: make(chan struct{}), canceled: make(chan struct{})}
	s.provisioner = p
	c, err := s.Create(context.Background(), project.ID, "Starting", "first", "work")
	if err != nil {
		t.Fatal(err)
	}
	<-p.starting
	if err := s.Stop(context.Background(), c.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-p.canceled:
	default:
		t.Fatal("underlying Start was not canceled")
	}
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			if err := s.Stop(context.Background(), c.ID); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if p.stops.Load() != 1 || f.prompts.Load() != 0 {
		t.Fatal("repeated stop changed work")
	}
	waitStatus(t, s, c.ID, storage.Stopped)
}

func TestStopFailureBlocksThenResumePreservesSessionAndSettings(t *testing.T) {
	f := newFixture(t)
	s, base, project := testService(t, f)
	p := &controlledProvisioner{testProvisioner: base}
	s.provisioner = p
	c, err := s.Create(context.Background(), project.ID, "Stop", "first", "work")
	if err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	before, _ := s.Store.Chat(context.Background(), c.ID)
	p.stopError.Store(true)
	if err := s.Stop(context.Background(), c.ID); err == nil {
		t.Fatal("unconfirmed stop succeeded")
	}
	waitStatus(t, s, c.ID, storage.Waiting)
	if _, err := s.Submit(context.Background(), c.ID, "blocked", "work"); !errors.Is(err, storage.ErrActive) {
		t.Fatal(err)
	}
	p.stopError.Store(false)
	if err := s.Stop(context.Background(), c.ID); err != nil {
		t.Fatal(err)
	}
	if f.prompts.Load() != 1 {
		t.Fatal("stop replayed work")
	}
	if _, err := s.Submit(context.Background(), c.ID, "follow", "new work"); err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	f.release <- false
	after := waitStatus(t, s, c.ID, storage.Idle)
	if before.ContainerID != after.ContainerID || before.SessionID != after.SessionID || before.Configuration.SetupCommand != after.Configuration.SetupCommand || base.starts.Load() != 2 || f.sessions.Load() != 1 {
		t.Fatal("resume changed identity or settings")
	}
	if err := s.Interrupt(context.Background(), c.ID); err != nil {
		t.Fatal(err)
	}
}

func TestTimeoutUsesStopLifecycle(t *testing.T) {
	f := newFixture(t)
	s, base, project := testService(t, f)
	p := &controlledProvisioner{testProvisioner: base}
	s.provisioner = p
	c, err := s.Create(context.Background(), project.ID, "Timeout", "first", "work")
	if err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	if err := s.EnforceTimeouts(context.Background()); err != nil {
		t.Fatal(err)
	}
	if p.stops.Load() != 0 {
		t.Fatal("stopped nonexpired work")
	}
	p.expired.Store(true)
	if err := s.EnforceTimeouts(context.Background()); err != nil {
		t.Fatal(err)
	}
	final := waitStatus(t, s, c.ID, storage.Stopped)
	if final.ActiveMessageID != "" || p.stops.Load() != 1 {
		t.Fatal("timeout did not release after stop")
	}
}

func TestRestartDoesNotSubmitIntoBusyRuntime(t *testing.T) {
	f := newFixture(t)
	s, p, project := testService(t, f)
	c, err := s.Create(context.Background(), project.ID, "Restart", "first", "work")
	if err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	f.release <- false
	waitStatus(t, s, c.ID, storage.Idle)
	f.mu.Lock()
	f.busy = true
	f.mu.Unlock()
	restarted := New(s.ctx, s.Store, p)
	if _, err := restarted.Submit(context.Background(), c.ID, "after-restart", "new work"); err != nil {
		t.Fatal(err)
	}
	blocked := waitStatus(t, restarted, c.ID, storage.Waiting)
	if blocked.ActiveMessageID == "" || f.prompts.Load() != 1 {
		t.Fatal("submitted overlapping runtime work")
	}
	if err := restarted.Stop(context.Background(), c.ID); err != nil {
		t.Fatal(err)
	}
}

func TestInterruptCannotReleaseUncertainAdmission(t *testing.T) {
	f := newFixture(t)
	f.noRuntimeAcceptance = true
	f.noPromptHeaders = true
	s, _, project := testService(t, f)
	c, err := s.Create(context.Background(), project.ID, "Uncertain", "first", "work")
	if err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	if err := s.Interrupt(context.Background(), c.ID); err == nil {
		t.Fatal("unobserved delivery was treated as confirmed interrupted")
	}
	waitStatus(t, s, c.ID, storage.Waiting)
	if _, err := s.Submit(context.Background(), c.ID, "follow", "work"); !errors.Is(err, storage.ErrActive) {
		t.Fatal(err)
	}
	if err := s.Stop(context.Background(), c.ID); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, s, c.ID, storage.Stopped)
}

func TestRuntimeReconnectIsBoundedAndNeverResubmits(t *testing.T) {
	f := newFixture(t)
	s, _, project := testService(t, f)
	c, err := s.Create(context.Background(), project.ID, "Reconnect", "first", "work")
	if err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	f.streamUnavailable.Store(true)
	close(f.streamStop)
	deadline := time.Now().Add(4 * time.Second)
	for f.streams.Load() < 4 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	time.Sleep(300 * time.Millisecond)
	if f.streams.Load() != 4 || f.prompts.Load() != 1 {
		t.Fatal("unbounded reconnect or message resubmission")
	}
	rows, err := s.Store.Activities(context.Background(), c.ID, 0, 1000)
	if err != nil {
		t.Fatal(err)
	}
	gaps := 0
	for _, row := range rows {
		if row.Kind == "capture.gap" {
			gaps++
		}
	}
	if gaps != 1 {
		t.Fatalf("repeated failed stream connections saved %d gap notices", gaps)
	}
	f.release <- false
	waitStatus(t, s, c.ID, storage.Idle)
}

func TestFailedStopCannotAnswerAbandonedQuestion(t *testing.T) {
	f := newFixture(t)
	s, base, project := testService(t, f)
	p := &controlledProvisioner{testProvisioner: base}
	s.provisioner = p
	c, err := s.Create(context.Background(), project.ID, "Question", "first", "work")
	if err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	f.mu.Lock()
	f.question = true
	f.mu.Unlock()
	f.events <- `{"type":"question.asked","properties":{"sessionID":"ses_one","id":"que_one"}}`
	waitStatus(t, s, c.ID, storage.Waiting)
	p.stopError.Store(true)
	err = s.Stop(context.Background(), c.ID)
	var failure *ControlError
	if !errors.As(err, &failure) {
		t.Fatalf("expected safe unconfirmed control: %v", err)
	}
	blocked := waitStatus(t, s, c.ID, storage.Waiting)
	if failure.Reason != blocked.StatusReason {
		t.Fatal("API and saved control reasons differ")
	}
	if strings.Contains(failure.Reason, "secret-diagnostic") {
		t.Fatal("runtime diagnostic escaped the safe control explanation")
	}
	if err := s.Reply(context.Background(), c.ID, "que_one", [][]string{{"Yes"}}); !errors.As(err, &failure) {
		t.Fatalf("abandoned reply: %v", err)
	}
	s.questionActivity(c.ID, blocked.ActiveMessageID, "que_one", true)
	after, _ := s.Store.Chat(context.Background(), c.ID)
	if after.Status != storage.Waiting || after.StatusReason != blocked.StatusReason || after.ActiveMessageID == "" || f.questionReplies.Load() != 0 {
		t.Fatal("abandoned question restarted invisible work")
	}
	if questions, err := s.Questions(context.Background(), c.ID); err != nil || len(questions) != 0 {
		t.Fatal("abandoned question still offered for reply")
	}
}

func TestStopAcceptsCompletedTurnButRejectsNewTurn(t *testing.T) {
	f := newFixture(t)
	s, p, project := testService(t, f)
	c, err := s.Create(context.Background(), project.ID, "Completion", "first", "work")
	if err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	observed, _ := s.Store.Chat(context.Background(), c.ID)
	f.release <- false
	waitStatus(t, s, c.ID, storage.Idle)
	if err := s.controlObserved(context.Background(), observed, true, false); err != nil {
		t.Fatal("completion raced with stop: ", err)
	}
	waitStatus(t, s, c.ID, storage.Stopped)
	if _, err := s.Submit(context.Background(), c.ID, "new", "new work"); err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	if err := s.controlObserved(context.Background(), observed, true, false); !errors.Is(err, storage.ErrStale) {
		t.Fatal("stale stop affected new turn: ", err)
	}
	if p.starts.Load() != 2 {
		t.Fatal("resume did not use existing container")
	}
	f.release <- false
	waitStatus(t, s, c.ID, storage.Idle)
}

func TestTimeoutFailureDoesNotStarveOtherChats(t *testing.T) {
	f := newFixture(t)
	s, base, project := testService(t, f)
	p := &controlledProvisioner{testProvisioner: base}
	s.provisioner = p
	ctx := context.Background()
	for _, title := range []string{"One", "Two"} {
		c, err := s.Store.CreateChat(ctx, project.ID, title, testImage, "1.2.27")
		if err != nil {
			t.Fatal(err)
		}
		if err := s.Store.BindRuntime(ctx, c.ID, "container-"+c.ID, ""); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Store.AcceptMessage(ctx, c.ID, "first", "work"); err != nil {
			t.Fatal(err)
		}
	}
	ordered, err := s.Store.Chats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	p.failChat = ordered[0].ID
	p.stopError.Store(true)
	p.expired.Store(true)
	if err := s.EnforceTimeouts(ctx); err == nil {
		t.Fatal("timeout failure not reported")
	}
	waitStatus(t, s, ordered[0].ID, storage.Waiting)
	waitStatus(t, s, ordered[1].ID, storage.Stopped)
	if p.stops.Load() != 2 {
		t.Fatal("failed first stop starved later chat")
	}
}

func TestConfirmedReplyAfterWorkerExitRemainsBlocked(t *testing.T) {
	f := newFixture(t)
	f.transportLoss = true
	f.replyStarted, f.replyRelease = make(chan struct{}), make(chan struct{})
	s, p, project := testService(t, f)
	clock := &activityClock{testProvisioner: p, now: time.Now()}
	s.provisioner = clock
	ctx := context.Background()
	c, err := s.Create(ctx, project.ID, "Reply race", "first", "work")
	if err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	f.mu.Lock()
	f.question = true
	f.mu.Unlock()
	f.events <- `{"type":"question.asked","properties":{"sessionID":"ses_one","id":"que_one"}}`
	waitStatus(t, s, c.ID, storage.Waiting)
	if clock.advanceAndSweep(2*time.Hour) != 0 {
		t.Fatal("question wait was not paused")
	}
	s.turnMu.Lock()
	job := s.jobs[c.ID]
	s.turnMu.Unlock()
	replied := make(chan error, 1)
	go func() { replied <- s.Reply(ctx, c.ID, "que_one", [][]string{{"Yes"}}) }()
	select {
	case <-f.replyStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("reply POST did not reach runtime")
	}
	f.release <- false
	select {
	case <-job.done:
	case <-time.After(5 * time.Second):
		t.Fatal("prompt worker did not exit after transport failure")
	}
	before, _ := s.Store.Chat(ctx, c.ID)
	if before.Status != storage.Waiting || before.ActiveMessageID == "" || !strings.Contains(before.StatusReason, "uncertain") {
		t.Fatalf("missing saved delivery uncertainty: %+v", before)
	}
	close(f.replyRelease)
	var failure *ControlError
	select {
	case err := <-replied:
		if !errors.As(err, &failure) || !strings.Contains(failure.Reason, "was delivered") || !strings.Contains(failure.Reason, "Do not resend") {
			t.Fatalf("confirmed delivery was not reported accurately: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("reply response did not complete")
	}
	after, _ := s.Store.Chat(ctx, c.ID)
	if after.Status != storage.Waiting || after.ActiveMessageID != before.ActiveMessageID || after.StatusReason != failure.Reason {
		t.Fatalf("reply released or falsely resumed unmonitored turn: %+v", after)
	}
	s.questionActivity(c.ID, after.ActiveMessageID, "que_one", true)
	if err := s.Reply(ctx, c.ID, "que_one", [][]string{{"Yes"}}); !errors.As(err, &failure) {
		t.Fatalf("abandoned turn accepted another reply: %v", err)
	}
	if _, err := s.Submit(ctx, c.ID, "follow", "new work"); !errors.Is(err, storage.ErrActive) {
		t.Fatal("unmonitored execution accepted new work: ", err)
	}
	rows, err := s.Store.Activities(ctx, c.ID, 0, 1000)
	if err != nil {
		t.Fatal(err)
	}
	confirmations := 0
	for _, row := range rows {
		if row.Kind == "question.reply.confirmed" {
			confirmations++
		}
	}
	if confirmations != 1 || f.questionReplies.Load() != 1 || f.prompts.Load() != 1 {
		t.Fatal("lost confirmed reply or resent runtime work")
	}
	final, _ := s.Store.Chat(ctx, c.ID)
	if final.Status != storage.Waiting {
		t.Fatal("late question callback falsely marked unmonitored work Working")
	}
	if clock.advanceAndSweep(59*time.Minute) != 0 || clock.advanceAndSweep(2*time.Minute) != 1 {
		t.Fatal("confirmed answer left unmonitored execution outside timeout enforcement")
	}
}
