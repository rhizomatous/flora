package chat

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/rhizomatous/flora/backend/internal/redaction"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

type turnJob struct {
	cancel    context.CancelFunc
	done      chan struct{}
	resume    bool
	attempted atomic.Bool
	finished  bool // Protected by Service.turnMu, set before done closes.
}

// ControlError contains only a fixed, credential-free explanation of an
// unconfirmed control. The active message remains reserved for explicit recovery.
type ControlError struct{ Reason string }

func (e *ControlError) Error() string { return e.Reason }

func (s *Service) abandonTurn(chatID string) {
	s.turnMu.Lock()
	defer s.turnMu.Unlock()
	if a := s.turns[chatID]; a != nil {
		a.mu.Lock()
		a.finished = true
		a.mu.Unlock()
	}
}

func (s *Service) monitoredTurn(chatID, messageID string) bool {
	s.turnMu.Lock()
	defer s.turnMu.Unlock()
	return s.monitoredTurnLocked(chatID, messageID)
}

// The caller holds turnMu through any status change authorized by this check.
func (s *Service) monitoredTurnLocked(chatID, messageID string) bool {
	a, job := s.turns[chatID], s.jobs[chatID]
	if a == nil || job == nil || job.finished || a.messageID != messageID {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.finished {
		return false
	}
	select {
	case <-job.done:
		return false
	default:
		return true
	}
}

// Admission and controls share this lock. Runtime workers never acquire it, so
// a control can cancel and join preparation, capture, and delivery before release.
func (s *Service) lockOperation(chatID string) func() {
	v, _ := s.operations.LoadOrStore(chatID, &sync.Mutex{})
	m := v.(*sync.Mutex)
	m.Lock()
	return m.Unlock
}

func (s *Service) quiesce(ctx context.Context, chatID string) error {
	s.turnMu.Lock()
	j := s.jobs[chatID]
	s.turnMu.Unlock()
	if j == nil {
		return nil
	}
	j.cancel()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-j.done:
		return nil
	}
}

// Interrupt cancels local delivery, then asks OpenCode to abort the persisted
// session. The pinned abort endpoint reports idle before tools finish, so saved
// terminal parts and a container-side process check must also confirm teardown.
func (s *Service) Interrupt(ctx context.Context, chatID string) error {
	return s.control(ctx, chatID, false, false)
}

// Stop keeps the existing container and both persistent mounts. Only a confirmed
// Docker stop releases admission; an uncertain stop remains blocked for retry.
func (s *Service) Stop(ctx context.Context, chatID string) error {
	return s.control(ctx, chatID, true, false)
}

// EnforceTimeouts uses the same cancellation and admission ordering as an
// explicit stop. Question waits are excluded by the provisioner's active clock.
func (s *Service) EnforceTimeouts(ctx context.Context) error {
	p, ok := s.provisioner.(interface{ ActivityExpired(string) bool })
	if !ok {
		return nil
	}
	chats, err := s.Store.Chats(ctx)
	if err != nil {
		return err
	}
	var failures []error
	for _, c := range chats {
		if p.ActivityExpired(c.ContainerID) {
			if err := s.control(ctx, c.ID, true, true); err != nil {
				failures = append(failures, err)
			}
		}
	}
	return errors.Join(failures...)
}

func (s *Service) control(ctx context.Context, chatID string, stop, timeout bool) error {
	observed, err := s.Store.Chat(s.ctx, chatID)
	if err != nil {
		return err
	}
	return s.controlObserved(ctx, observed, stop, timeout)
}

func (s *Service) controlObserved(_ context.Context, observed storage.Chat, stop, timeout bool) error {
	chatID := observed.ID
	unlock := s.lockOperation(chatID)
	defer unlock()
	if s.provisioner == nil {
		return errors.New("chat runtime is not configured")
	}
	// Browser disconnection must not abandon an already requested teardown.
	ctx, cancel := context.WithTimeout(s.ctx, 45*time.Second)
	defer cancel()
	c, err := s.Store.Chat(ctx, chatID)
	if err != nil {
		return err
	}
	if c.Status == storage.Stopped || (!stop && c.ActiveMessageID == "" && c.Status == storage.Idle) {
		return nil
	}
	if c.ActiveMessageID != observed.ActiveMessageID && !(stop && c.ActiveMessageID == "" && c.Status == storage.Idle) {
		return storage.ErrStale
	}
	if timeout {
		p, ok := s.provisioner.(interface{ ActivityExpired(string) bool })
		s.turnMu.Lock()
		expired := ok && p.ActivityExpired(c.ContainerID)
		if expired {
			if a := s.turns[chatID]; a != nil {
				a.mu.Lock()
				a.finished = true
				a.mu.Unlock()
			}
		}
		s.turnMu.Unlock()
		if !expired {
			return nil
		}
	}
	// No answer may restart work once this control abandons its capture worker.
	s.abandonTurn(chatID)
	if err := s.quiesce(ctx, chatID); err != nil {
		reason := "Capture shutdown could not be confirmed. New messages and question replies remain blocked. Retry the control."
		if err := s.Store.Transition(s.ctx, chatID, c.ActiveMessageID, storage.Waiting, reason); err != nil {
			return err
		}
		return &ControlError{Reason: reason}
	}
	c, err = s.Store.Chat(ctx, chatID)
	if err != nil {
		return err
	}
	reason := "Interrupting current work"
	failureReason := "Runtime abort or tool teardown could not be confirmed. Retry interrupt or stop the container."
	if stop {
		reason = "Stopping container"
		failureReason = "Container stop could not be confirmed. Check Docker and retry Stop container."
	}
	if err := s.Store.Transition(ctx, chatID, c.ActiveMessageID, storage.Working, reason); err != nil {
		return err
	}
	if stop {
		s.captureControlHistory(ctx, c)
	}
	if stop {
		p, ok := s.provisioner.(interface {
			Stop(context.Context, string) error
		})
		if !ok {
			err = errors.New("container stop unavailable")
		} else {
			err = p.Stop(ctx, chatID)
		}
	} else if c.SessionID != "" {
		s.captureControlHistory(ctx, c)
		s.turnMu.Lock()
		job := s.jobs[chatID]
		s.turnMu.Unlock()
		if c.ActiveMessageID != "" && (job == nil || job.attempted.Load()) {
			messages, readErr := s.Store.Messages(ctx, chatID)
			linked := false
			for _, m := range messages {
				if m.ID == c.ActiveMessageID && m.RuntimeMessageID != "" {
					linked = true
				}
			}
			if readErr != nil || !linked {
				err = errors.New("runtime admission is uncertain; stop the container before new work")
				failureReason = "Runtime acceptance is uncertain. Stop the container before starting new work."
			}
		}
		e, endpointErr := s.provisioner.Endpoint(ctx, chatID)
		if err == nil {
			err = endpointErr
		}
		if err == nil {
			rt := newRuntime(e)
			err = rt.abort(ctx, c.SessionID)
			if err == nil {
				p, ok := s.provisioner.(interface {
					ConfirmInterrupt(context.Context, string) error
				})
				if !ok {
					err = errors.New("runtime teardown verification unavailable")
				} else {
					err = p.ConfirmInterrupt(ctx, chatID)
				}
			}
			if err == nil {
				s.captureControlHistory(ctx, c)
			}
			rt.client.CloseIdleConnections()
		}
	} else {
		err = errors.New("preparation has no runtime session to abort; stop the container to confirm teardown")
		failureReason = "Preparation has no runtime session to interrupt. Stop the container to confirm teardown."
	}
	if err != nil {
		reason := failureReason + " New messages and question replies remain blocked."
		if err := s.Store.Transition(s.ctx, chatID, c.ActiveMessageID, storage.Waiting, reason); err != nil {
			return err
		}
		return &ControlError{Reason: reason}
	}
	status, reason := storage.Idle, "Current work interrupted; send a new message to continue with saved context"
	if stop {
		status, reason = storage.Stopped, "Container stopped; send a new message to resume with saved workspace and conversation"
	}
	if timeout {
		reason = "Continuous activity limit reached; container stopped. Send a new message to resume with saved context."
	}
	s.turnMu.Lock()
	a := s.turns[chatID]
	s.turnMu.Unlock()
	if a != nil {
		s.endTurnActivity(chatID, a)
	}
	return s.Store.Transition(ctx, chatID, c.ActiveMessageID, status, reason)
}

func (s *Service) captureControlHistory(ctx context.Context, c storage.Chat) {
	if c.SessionID == "" || c.ActiveMessageID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	e, err := s.provisioner.Endpoint(ctx, c.ID)
	if err != nil {
		return
	}
	rt := newRuntime(e)
	defer rt.client.CloseIdleConnections()
	known, seen := map[string]bool{}, map[string][32]byte{}
	messages, err := s.Store.Messages(ctx, c.ID)
	if err != nil {
		return
	}
	var runtimeID string
	for _, m := range messages {
		if m.Role == "user" {
			known[m.RuntimeMessageID] = true
		}
		if m.ID == c.ActiveMessageID {
			runtimeID = m.RuntimeMessageID
		}
	}
	var completed bool
	_, _ = s.captureHistory(ctx, rt, c, redaction.Values(ctx, s.Store, c.ID, e.Password, e.ProviderKey), c.ActiveMessageID, &runtimeID, &completed, known, seen)
}
