package chat

import (
	"context"
	"errors"
	"time"

	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func (s *Service) Runtime(ctx context.Context, id string) (provisioning.RuntimeState, error) {
	if _, err := s.Store.Chat(ctx, id); err != nil {
		return provisioning.RuntimeState{}, err
	}
	r := provisioning.RuntimeState{State: "unknown", ObservedAt: time.Now().UTC(), CollectionError: "This server does not support chat container status checks."}
	if p, ok := s.provisioner.(interface {
		Runtime(context.Context, string) (provisioning.RuntimeState, error)
	}); ok {
		var err error
		r, err = p.Runtime(ctx, id)
		if err != nil {
			return r, err
		}
	}
	until, err := s.Store.RuntimeLease(ctx, id)
	if !until.IsZero() {
		r.KeepAwakeUntil = &until
	}
	if _, ok := s.wakes.Load(id); ok && (r.State == "running" || r.State == "stopped" || r.State == "failed") {
		r.State = "starting"
	}
	return r, err
}

// Wake starts only the saved container, without creating a message or session.
// Stop cancels readiness before waiting for the operation lock. Cancellation
// leaves any uncertain Docker start for Stop to inspect and confirm.
func (s *Service) Wake(ctx context.Context, id string) error {
	wakeCtx, cancel := context.WithCancel(ctx)
	if _, loaded := s.wakes.LoadOrStore(id, cancel); loaded {
		cancel()
		return storage.ErrActive
	}
	defer s.wakes.Delete(id)
	defer cancel()
	unlock := s.lockOperation(id)
	defer unlock()
	if err := wakeCtx.Err(); err != nil {
		return err
	}

	c, err := s.Store.Chat(ctx, id)
	if err != nil {
		return err
	}
	if c.ActiveMessageID != "" || c.Status == storage.Working || c.Status == storage.Waiting {
		return storage.ErrActive
	}
	if s.provisioner == nil {
		return errors.New("chat runtime is not configured")
	}
	r, err := s.Runtime(ctx, id)
	if err != nil {
		return err
	}
	if r.State == "missing" {
		return &ControlError{Reason: "The saved container is missing. Restore it before waking this workspace."}
	}
	if r.State == "unknown" {
		return &ControlError{Reason: "Container state could not be verified. Refresh before waking this workspace."}
	}
	p, ok := s.provisioner.(interface {
		Wake(context.Context, string) (provisioning.Endpoint, error)
	})
	if !ok {
		return &ControlError{Reason: "Waking an existing container is unavailable from this runtime."}
	}
	if _, err = p.Wake(wakeCtx, id); err != nil {
		return err
	}
	return s.Store.Transition(ctx, id, "", storage.Idle, "Container awake")
}

// KeepAwake changes only a running machine's idle lease. Cancellation marks it
// due for idle cleanup. Explicit stop and continuous activity limits always win.
func (s *Service) KeepAwake(ctx context.Context, id string, seconds int) error {
	if _, err := s.Store.Chat(ctx, id); err != nil {
		return err
	}
	if seconds != 0 && seconds != 1800 && seconds != 3600 && seconds != 14400 {
		return storage.ErrInvalid
	}
	unlock := s.lockOperation(id)
	defer unlock()
	if seconds != 0 {
		r, err := s.Runtime(ctx, id)
		if err != nil {
			return err
		}
		if r.State != "running" {
			return &ControlError{Reason: "Wake the machine before keeping it awake."}
		}
	}
	return s.Store.SetRuntimeLease(ctx, id, time.Now().UTC().Add(time.Duration(seconds)*time.Second))
}

func (s *Service) enforceLeases(ctx context.Context) error {
	// Automation cleanup saves changes before stopping its own completed chats.
	runs, err := s.Store.UnreleasedAutomationRuns(ctx)
	if err != nil {
		return err
	}
	automatic := map[string]bool{}
	for _, run := range runs {
		automatic[run.ChatID] = true
	}

	chats, err := s.Store.Chats(ctx)
	if err != nil {
		return err
	}
	for _, c := range chats {
		if automatic[c.ID] {
			continue
		}
		until, err := s.Store.RuntimeLease(ctx, c.ID)
		if err != nil {
			return err
		}
		if until.IsZero() || until.After(time.Now()) {
			continue
		}
		if c.Status == storage.Stopped {
			if err := s.Store.SetRuntimeLease(ctx, c.ID, time.Time{}); err != nil {
				return err
			}
			continue
		}
		if c.Status == storage.Idle && c.ActiveMessageID == "" {
			if err := s.controlObserved(ctx, c, true, false, true); err != nil && !errors.Is(err, storage.ErrStale) {
				return err
			}
		}
	}
	return nil
}
