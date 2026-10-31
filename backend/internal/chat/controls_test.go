package chat

import (
	"context"
	"errors"
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
func (p *controlledProvisioner) Stop(context.Context, string) error {
	p.stops.Add(1)
	if p.stopError.Load() {
		return errors.New("unconfirmed stop")
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
	close(f.streamStop)
	deadline := time.Now().Add(4 * time.Second)
	for f.streams.Load() < 4 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	time.Sleep(300 * time.Millisecond)
	if f.streams.Load() != 4 || f.prompts.Load() != 1 {
		t.Fatal("unbounded reconnect or message resubmission")
	}
	f.release <- false
	waitStatus(t, s, c.ID, storage.Idle)
}
