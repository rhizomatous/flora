package provisioning

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

type heldStartEngine struct {
	Engine
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (e *heldStartEngine) ContainerStart(ctx context.Context, id string) error {
	e.once.Do(func() { close(e.entered); <-e.release })
	return e.Engine.ContainerStart(ctx, id)
}

func TestCapacityAcrossHandlesAndRestart(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	root := filepath.Join(t.TempDir(), "data")
	engine := newFakeEngine()
	held := &heldStartEngine{Engine: engine, entered: make(chan struct{}), release: make(chan struct{})}
	defer func() {
		select {
		case <-held.release:
		default:
			close(held.release)
		}
	}()
	manager := func(limit int) (*Manager, *storage.Store) {
		t.Helper()
		s, err := storage.Open(ctx, root)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { s.Close() })
		m, err := New(held, s, Config{ImageRef: testDigest, HarnessVersion: "1.2.27", MaxRunning: limit}, nil)
		if err != nil {
			t.Fatal(err)
		}
		m.health = func(context.Context, string, string) bool { return true }
		return m, s
	}
	m1, s1 := manager(1)
	m2, s2 := manager(1)
	one, two := newChat(t, s1), newChat(t, s2)
	first := make(chan error, 1)
	go func() { _, err := m1.Start(ctx, one.ID); first <- err }()
	<-held.entered
	// A different handle cannot consume the reserved slot before Docker has
	// finished starting the first container, even though its running list is empty.
	short, stop := context.WithTimeout(ctx, 50*time.Millisecond)
	defer stop()
	if _, err := m2.Start(short, two.ID); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("reservation: %v", err)
	}
	sameChat, stopSame := context.WithTimeout(ctx, 30*time.Millisecond)
	defer stopSame()
	if _, err := m2.Start(sameChat, one.ID); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("same chat start bypassed lifecycle lock: %v", err)
	}
	stopping, stopStop := context.WithTimeout(ctx, 30*time.Millisecond)
	defer stopStop()
	if err := m2.Stop(stopping, one.ID); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("stop bypassed in-flight start: %v", err)
	}
	// Capacity admission does not hold the activity mutex.
	activity := make(chan struct{})
	go func() { m1.BeginActivity("unrelated"); m1.EndActivity("unrelated"); close(activity) }()
	select {
	case <-activity:
	case <-ctx.Done():
		t.Fatal("start blocked other chat activity")
	}
	close(held.release)
	if err := <-first; err != nil {
		t.Fatal(err)
	}
	if _, err := m2.Start(ctx, one.ID); err != nil {
		t.Fatal("same chat did not reuse its container", err)
	}
	if len(engine.created) != 1 {
		t.Fatal("same chat created multiple containers")
	}
	assertFull := func(m *Manager, id string) {
		t.Helper()
		var full *CapacityError
		if _, err := m.Start(ctx, id); !errors.As(err, &full) || full.Running != 1 {
			t.Fatalf("expected full capacity: %v", err)
		}
	}
	assertFull(m2, two.ID)
	// A fresh manager reconstructs occupancy from Docker, including idle work.
	m3, _ := manager(1)
	assertFull(m3, two.ID)
	if err := m3.Stop(ctx, one.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := m2.Start(ctx, two.ID); err != nil {
		t.Fatal(err)
	}
	assertFull(m1, one.ID)
	// An external crash frees the slot without a backend release callback.
	two, _ = s2.Chat(ctx, two.ID)
	if err := engine.ContainerStop(ctx, two.ContainerID, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := m1.Start(ctx, one.ID); err != nil {
		t.Fatal(err)
	}
}

func TestLowerCapacityPreservesRunningContainers(t *testing.T) {
	engine := newFakeEngine()
	m, s := newTestManager(t, engine, Config{MaxRunning: 3}, nil)
	ctx := context.Background()
	chats := []storage.Chat{newChat(t, s), newChat(t, s), newChat(t, s)}
	for _, c := range chats[:2] {
		if _, err := m.Start(ctx, c.ID); err != nil {
			t.Fatal(err)
		}
	}
	cfg := m.cfg
	cfg.MaxRunning = 1
	lower, err := New(engine, s, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	lower.health = m.health
	if _, err := lower.Start(ctx, chats[0].ID); err != nil {
		t.Fatal("existing container rejected", err)
	}
	var full *CapacityError
	if _, err := lower.Start(ctx, chats[2].ID); !errors.As(err, &full) || full.Running != 2 {
		t.Fatalf("lower limit: %v", err)
	}
	if err := lower.Stop(ctx, chats[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := lower.Start(ctx, chats[2].ID); !errors.As(err, &full) {
		t.Fatal("one running still fills limit")
	}
	if err := lower.Stop(ctx, chats[1].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := lower.Start(ctx, chats[2].ID); err != nil {
		t.Fatal(err)
	}
}

func TestBoundContainerCannotAccessAnotherChat(t *testing.T) {
	engine := newFakeEngine()
	m, s := newTestManager(t, engine, Config{}, nil)
	ctx := context.Background()
	one, two := newChat(t, s), newChat(t, s)
	e, err := m.Start(ctx, one.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.BindRuntime(ctx, two.ID, e.ContainerID, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Start(ctx, two.ID); err == nil {
		t.Fatal("start exposed another chat's runtime")
	}
	if _, err := m.Endpoint(ctx, two.ID); err == nil {
		t.Fatal("endpoint exposed another chat's runtime")
	}
	if err := m.Stop(ctx, two.ID); err == nil {
		t.Fatal("stop reached another chat's container")
	}
	info, _ := engine.ContainerInspect(ctx, e.ContainerID)
	if !info.State.Running {
		t.Fatal("other chat was stopped")
	}
}

type failedCreateEngine struct{ Engine }

func (e failedCreateEngine) ContainerCreate(context.Context, docker.ContainerSpec) (string, error) {
	return "", errors.New("create failed")
}

func TestFailedCreateReleasesCapacityReservation(t *testing.T) {
	engine := newFakeEngine()
	m, s := newTestManager(t, engine, Config{MaxRunning: 1}, nil)
	ctx := context.Background()
	c := newChat(t, s)
	m.engine = failedCreateEngine{engine}
	if _, err := m.Start(ctx, c.ID); err == nil {
		t.Fatal("expected create failure")
	}
	m.engine = engine
	if _, err := m.Start(ctx, c.ID); err != nil {
		t.Fatal("reservation leaked", err)
	}
}

type uncertainStartEngine struct{ Engine }

func (e uncertainStartEngine) ContainerStart(ctx context.Context, id string) error {
	if err := e.Engine.ContainerStart(ctx, id); err != nil {
		return err
	}
	return errors.New("start response lost")
}

type failedStopEngine struct{ Engine }

func (e failedStopEngine) ContainerStop(context.Context, string, int) error {
	return errors.New("stop failed")
}

func TestUncertainStartAndFailedStopKeepActualOccupancy(t *testing.T) {
	engine := newFakeEngine()
	m, s := newTestManager(t, engine, Config{MaxRunning: 1}, nil)
	ctx := context.Background()
	one, two := newChat(t, s), newChat(t, s)
	m.engine = uncertainStartEngine{engine}
	if _, err := m.Start(ctx, one.ID); err == nil {
		t.Fatal("expected uncertain start")
	}
	// Docker may have accepted a start whose response was lost before binding.
	// A fresh manager must count and adopt it, never reuse its occupied slot.
	restarted, err := New(engine, s, m.cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	restarted.health = m.health
	var full *CapacityError
	if _, err := restarted.Start(ctx, two.ID); !errors.As(err, &full) {
		t.Fatalf("uncertain start freed live occupancy: %v", err)
	}
	if _, err := restarted.Start(ctx, one.ID); err != nil {
		t.Fatal("could not adopt running container", err)
	}
	restarted.engine = failedStopEngine{engine}
	if err := restarted.Stop(ctx, one.ID); err == nil {
		t.Fatal("expected stop failure")
	}
	if _, err := restarted.Start(ctx, two.ID); !errors.As(err, &full) {
		t.Fatalf("failed stop freed capacity: %v", err)
	}
	restarted.engine = engine
	if err := restarted.Stop(ctx, one.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.Start(ctx, two.ID); err != nil {
		t.Fatal("slot did not become reusable", err)
	}
}

func TestReadinessDoesNotSerializeOtherChats(t *testing.T) {
	engine := newFakeEngine()
	m, s := newTestManager(t, engine, Config{MaxRunning: 2}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	one, two := newChat(t, s), newChat(t, s)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	m.health = func(ctx context.Context, _, _ string) bool {
		once.Do(func() { close(entered) })
		select {
		case <-release:
			return true
		case <-ctx.Done():
			return false
		}
	}
	first := make(chan error, 1)
	go func() { _, err := m.Start(ctx, one.ID); first <- err }()
	<-entered
	// A second manager is also needed to prove the storage-backed capacity lock
	// is released before the first chat's readiness check.
	other, err := New(engine, s, m.cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	other.health = func(context.Context, string, string) bool { return true }
	if _, err := other.Start(ctx, two.ID); err != nil {
		t.Fatal("unrelated readiness blocked admission", err)
	}
	close(release)
	if err := <-first; err != nil {
		t.Fatal(err)
	}
}

type revocationAccess struct {
	checkoutFunc
	chatIDs []string
	err     error
}

func (a *revocationAccess) Revoke(_ context.Context, chatID string) error {
	a.chatIDs = append(a.chatIDs, chatID)
	return a.err
}

func TestStopMissingBoundContainerRevokesChatAccess(t *testing.T) {
	for _, revokeFails := range []bool{false, true} {
		t.Run(map[bool]string{false: "revoked", true: "revocation unavailable"}[revokeFails], func(t *testing.T) {
			engine := newFakeEngine()
			m, s := newTestManager(t, engine, Config{}, nil)
			ctx := context.Background()
			c := newChat(t, s)
			e, err := m.Start(ctx, c.ID)
			if err != nil {
				t.Fatal(err)
			}
			m.BeginActivity(e.ContainerID)
			engine.mu.Lock()
			delete(engine.containers, e.ContainerID)
			engine.mu.Unlock()
			access := &revocationAccess{}
			if revokeFails {
				access.err = errors.New("revocation unavailable")
			}
			m.access = access
			err = m.Stop(ctx, c.ID)
			if !errors.Is(err, access.err) {
				t.Fatalf("stop did not report revocation result: %v", err)
			}
			if len(access.chatIDs) != 1 || access.chatIDs[0] != c.ID {
				t.Fatal("did not revoke only the missing container's chat")
			}
			if _, ok := m.activeSince[e.ContainerID]; ok {
				t.Fatal("confirmed missing container kept active accounting")
			}
			saved, err := s.Chat(ctx, c.ID)
			if err != nil || saved.ContainerID != e.ContainerID || len(engine.created) != 1 || len(engine.stopped) != 0 {
				t.Fatal("missing container was replaced or identity changed")
			}
		})
	}
}
