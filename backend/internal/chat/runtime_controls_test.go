package chat

import (
	"context"
	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"testing"
	"time"
)

type leaseProvisioner struct{ *controlledProvisioner }

func (p *leaseProvisioner) Runtime(context.Context, string) (provisioning.RuntimeState, error) {
	return provisioning.RuntimeState{State: "running"}, nil
}
func (p *leaseProvisioner) Wake(ctx context.Context, id string) (provisioning.Endpoint, error) {
	return p.Start(ctx, id)
}
func idleLeaseChat(t *testing.T) (*Service, *leaseProvisioner, storage.Chat) {
	t.Helper()
	f := newFixture(t)
	s, base, project := testService(t, f)
	p := &leaseProvisioner{&controlledProvisioner{testProvisioner: base}}
	s.provisioner = p
	image, harness := p.Identity()
	c, err := s.Store.CreateChat(context.Background(), project.ID, "Lease", image, harness)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Store.Transition(context.Background(), c.ID, "", storage.Idle, "Ready"); err != nil {
		t.Fatal(err)
	}
	return s, p, c
}
func TestLeasePrecedenceAndCancellation(t *testing.T) {
	ctx := context.Background()
	s, p, c := idleLeaseChat(t)
	if err := s.KeepAwake(ctx, c.ID, 3600); err != nil {
		t.Fatal(err)
	}
	if err := s.EnforceTimeouts(ctx); err != nil {
		t.Fatal(err)
	}
	if p.stops.Load() != 0 {
		t.Fatal("live lease stopped")
	}
	if err := s.KeepAwake(ctx, c.ID, 0); err != nil {
		t.Fatal(err)
	}
	if err := s.EnforceTimeouts(ctx); err != nil {
		t.Fatal(err)
	}
	if p.stops.Load() != 1 {
		t.Fatal("canceled idle lease not stopped")
	}
	until, err := s.Store.RuntimeLease(ctx, c.ID)
	if err != nil || !until.IsZero() {
		t.Fatalf("lease not cleared: %v %v", until, err)
	}
}
func TestExpiredLeaseDoesNotInterruptWorkAndActivityLimitWins(t *testing.T) {
	ctx := context.Background()
	s, p, c := idleLeaseChat(t)
	accepted, err := s.Store.AcceptMessage(ctx, c.ID, "active", "working")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Store.Transition(ctx, c.ID, accepted.Message.ID, storage.Working, "Working"); err != nil {
		t.Fatal(err)
	}
	if err := s.Store.SetRuntimeLease(ctx, c.ID, time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := s.enforceLeases(ctx); err != nil {
		t.Fatal(err)
	}
	if p.stops.Load() != 0 {
		t.Fatal("lease interrupted active work")
	}
	if err := s.Store.SetRuntimeLease(ctx, c.ID, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	p.expired.Store(true)
	if err := s.EnforceTimeouts(ctx); err != nil {
		t.Fatal(err)
	}
	if p.stops.Load() != 1 {
		t.Fatal("lease bypassed activity limit")
	}
}
func TestWakeWithoutModelTurnAndCancelWake(t *testing.T) {
	ctx := context.Background()
	s, p, c := idleLeaseChat(t)
	before, err := s.Store.Messages(ctx, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Wake(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	after, err := s.Store.Messages(ctx, c.ID)
	if err != nil || len(before) != len(after) {
		t.Fatal("wake submitted a message")
	}
	p.starting = make(chan struct{})
	p.canceled = make(chan struct{})
	done := make(chan error, 1)
	go func() { done <- s.Wake(ctx, c.ID) }()
	select {
	case <-p.starting:
	case <-time.After(time.Second):
		t.Fatal("wake did not start")
	}
	if err := s.Stop(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err == nil {
		t.Fatal("wake not canceled")
	}
	if p.stops.Load() != 1 {
		t.Fatal("stop not confirmed")
	}
}

func TestLeaseSurvivesServiceRestart(t *testing.T) {
	ctx := context.Background()
	s, p, c := idleLeaseChat(t)
	if err := s.KeepAwake(ctx, c.ID, 3600); err != nil {
		t.Fatal(err)
	}
	restarted := New(ctx, s.Store, p)
	if err := restarted.EnforceTimeouts(ctx); err != nil {
		t.Fatal(err)
	}
	if p.stops.Load() != 0 {
		t.Fatal("restart discarded the live lease")
	}
	if err := s.Store.SetRuntimeLease(ctx, c.ID, time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := restarted.EnforceTimeouts(ctx); err != nil {
		t.Fatal(err)
	}
	if p.stops.Load() != 1 {
		t.Fatal("restart did not enforce the expired lease")
	}
}
