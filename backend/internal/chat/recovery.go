package chat

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"strings"
	"sync/atomic"
	"time"

	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/redaction"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

const uncertainRecovery = "Execution cannot be confirmed. The accepted message will not be resent. External effects may already have happened. Interrupt current work or stop the container before sending new input."
const pendingRecoveryControl = "A previous execution control was not confirmed. Retry interrupt or stop the container before continuing. External effects may already have happened."
const missingContainerRecovery = "The saved container is missing. Continuation is unavailable because Flora cannot recreate this container. Workspace files and saved history are retained. Output may be missing and external effects are uncertain. Prior actions will not be replayed."
const idleConnectionUnavailable = "The container or OpenCode connection is unavailable. No turn is active. Workspace files and saved history are retained; new input is paused until the connection is restored or the container is stopped."

// ContinuationBlock reports a confirmed missing container, not a transient
// inspection failure. Existing accepted requests remain available for lookup.
func (s *Service) ContinuationBlock(ctx context.Context, c storage.Chat) string {
	if c.StatusReason == missingContainerRecovery {
		return missingContainerRecovery
	}
	if c.ContainerID == "" || s.provisioner == nil {
		return ""
	}
	check, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	_, err := s.provisioner.Endpoint(check, c.ID)
	var ended *provisioning.ExecutionEndedError
	if errors.As(err, &ended) && ended.Missing {
		return missingContainerRecovery
	}
	return ""
}

func recoveryControlPending(reason string) bool {
	for _, prefix := range []string{"Interrupting current work", "Stopping container", "Capture shutdown could not be confirmed.", "Runtime abort or tool teardown could not be confirmed.", "Runtime acceptance is uncertain.", "Preparation has no runtime session to interrupt.", "Container stop could not be confirmed.", pendingRecoveryControl} {
		if strings.HasPrefix(reason, prefix) {
			return true
		}
	}
	return false
}

// Reconcile attaches read-only observers to saved active turns. Call it before
// serving requests and periodically afterward. It never starts containers,
// creates sessions, submits prompts, or replays tool actions.
func (s *Service) Reconcile(ctx context.Context) error {
	chats, err := s.Store.Chats(ctx)
	if err != nil {
		return err
	}
	for _, saved := range chats {
		unlock := s.lockOperation(saved.ID)
		err := s.reconcileChat(ctx, saved.ID)
		unlock()
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) reconcileChat(ctx context.Context, chatID string) error {
	c, err := s.Store.Chat(ctx, chatID)
	if err != nil {
		return err
	}
	if c.Status == storage.Stopped || c.Status == storage.Failed {
		if reason := s.ContinuationBlock(ctx, c); reason != "" && c.StatusReason != reason {
			return s.Store.Transition(ctx, c.ID, c.ActiveMessageID, storage.Failed, reason)
		}
		return nil
	}
	s.turnMu.Lock()
	job := s.jobs[c.ID]
	running := job != nil && !job.finished
	s.turnMu.Unlock()
	if running {
		return nil
	}
	if c.ActiveMessageID == "" {
		if c.ContainerID == "" {
			return nil
		}
		check, cancel := context.WithTimeout(ctx, 3*time.Second)
		e, endpointErr := s.provisioner.Endpoint(check, c.ID)
		err = endpointErr
		if err == nil {
			rt := newRuntime(e)
			var health struct {
				Healthy bool `json:"healthy"`
			}
			err = rt.call(check, "GET", "/global/health", nil, &health)
			if err == nil && !health.Healthy {
				err = errors.New("runtime unhealthy")
			}
			rt.client.CloseIdleConnections()
		}
		cancel()
		var ended *provisioning.ExecutionEndedError
		if errors.As(err, &ended) {
			reason := ended.Reason + ". Workspace and saved history are retained. Send new input to continue; prior actions are not replayed."
			if ended.Missing {
				reason = missingContainerRecovery
			}
			return s.Store.Transition(ctx, c.ID, "", storage.Failed, reason)
		}
		if err != nil && c.StatusReason != idleConnectionUnavailable {
			return s.Store.Transition(ctx, c.ID, "", storage.Waiting, idleConnectionUnavailable)
		}
		if err == nil && c.Status == storage.Waiting {
			return s.Store.Transition(ctx, c.ID, "", storage.Idle, "Container connection restored; ready for new input")
		}
		return nil
	}
	workerCtx, cancel := context.WithCancel(s.ctx)
	job = &turnJob{cancel: cancel, done: make(chan struct{})}
	job.attempted.Store(true)
	s.turnMu.Lock()
	s.jobs[c.ID] = job
	s.turnMu.Unlock()
	go func() {
		defer cancel()
		defer func() {
			s.turnMu.Lock()
			job.finished = true
			close(job.done)
			s.turnMu.Unlock()
		}()
		s.observeRecovery(workerCtx, c)
	}()
	return nil
}

func (s *Service) recoveryGap(ctx context.Context, chatID string) error {
	return s.Store.AppendActivity(ctx, chatID, rand.Text(), "capture.gap", json.RawMessage(`{"reason":"Flora is reconnecting to existing execution. Runtime message and tool snapshots will be reconciled, but transient events during the disconnection cannot be recovered. No accepted message or action is replayed."}`))
}

func (s *Service) observeRecovery(ctx context.Context, c storage.Chat) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	activity := &turnActivity{provisioner: s.provisioner, containerID: c.ContainerID, messageID: c.ActiveMessageID, questions: map[string]bool{}}
	blocked := recoveryControlPending(c.StatusReason)
	activity.finished = blocked
	s.turnMu.Lock()
	s.turns[c.ID] = activity
	s.provisioner.BeginActivity(c.ContainerID)
	s.turnMu.Unlock()
	defer s.endTurnActivity(c.ID, activity)
	known, seen := map[string]bool{}, map[string][32]byte{}
	var messages []storage.Message
	for {
		var err error
		messages, err = s.Store.Messages(ctx, c.ID)
		if err == nil {
			break
		}
		if ctx.Err() != nil || errors.Is(err, storage.ErrNotFound) {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
	var runtimeID string
	for _, m := range messages {
		if m.Role == "user" {
			known[m.RuntimeMessageID] = true
		}
		if m.ID == c.ActiveMessageID {
			runtimeID = m.RuntimeMessageID
		}
		if m.Role == "assistant" {
			seen[m.RuntimeMessageID] = sha256.Sum256(m.Payload)
		}
	}
	var streamCancel context.CancelFunc
	var streamDone chan error
	var streamReady <-chan error
	var runtimeFailure atomic.Bool
	disconnected, gapPending := true, true
	defer func() {
		if streamCancel != nil {
			streamCancel()
			<-streamDone
		}
	}()
	for {
		if ctx.Err() != nil {
			return
		}
		current, err := s.Store.Chat(ctx, c.ID)
		if errors.Is(err, storage.ErrNotFound) || err == nil && current.ActiveMessageID != c.ActiveMessageID {
			return
		}
		if err != nil {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
			continue
		}
		if gapPending && s.recoveryGap(ctx, c.ID) == nil {
			gapPending = false
		}
		check, cancel := context.WithTimeout(ctx, 3*time.Second)
		endpoint, err := s.provisioner.Endpoint(check, c.ID)
		if err == nil && activity.containerID == "" {
			activity.mu.Lock()
			activity.containerID = endpoint.ContainerID
			activity.mu.Unlock()
			s.provisioner.EndActivity("")
			s.provisioner.BeginActivity(endpoint.ContainerID)
		}
		var ended *provisioning.ExecutionEndedError
		if errors.As(err, &ended) {
			cancel()
			reason := ended.Reason + ". Execution ended unexpectedly. Workspace and saved history are retained; output may be missing and external effects are uncertain. Send explicit new input to continue with saved context. Prior actions will not be replayed."
			if ended.Missing {
				reason = missingContainerRecovery
			}
			if err := s.transition(c.ID, c.ActiveMessageID, storage.Failed, reason); err == nil || errors.Is(err, storage.ErrStale) {
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
			continue
		}
		if blocked {
			// A terminal message cannot replace process-exit verification for a
			// stop or interrupt that lost its confirmation during a restart.
			cancel()
			s.recoveryStatus(ctx, c, storage.Waiting, pendingRecoveryControl)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
			continue
		}
		if err == nil && c.SessionID != "" {
			rt := newRuntime(endpoint)
			secrets := redaction.Values(check, s.Store, c.ID, endpoint.Password, endpoint.ProviderKey)
			if streamDone == nil {
				streamCtx, stop := context.WithCancel(ctx)
				streamCancel = stop
				streamDone = make(chan error, 1)
				ready := make(chan error, 1)
				streamReady = ready
				done := streamDone
				go func() {
					done <- rt.stream(streamCtx, c.SessionID, ready, func(kind string, raw json.RawMessage) error {
						if kind == "message.part.delta" {
							return nil
						}
						if kind == "session.error" {
							runtimeFailure.Store(true)
						}
						if err := s.Store.AppendActivity(streamCtx, c.ID, rand.Text(), "runtime."+kind, redaction.JSON(raw, secrets...)); err != nil {
							return err
						}
						return s.runtimeActivity(c.ID, activity, kind, raw)
					})
				}()
			}
			var completed bool
			var failure bool
			failure, err = s.captureHistory(check, rt, c, secrets, c.ActiveMessageID, &runtimeID, &completed, known, seen)
			var statuses map[string]struct {
				Type string `json:"type"`
			}
			if err == nil {
				err = rt.call(check, "GET", "/session/status", nil, &statuses)
			}
			if err == nil {
				version := activity.questionVersion()
				questions, questionErr := rt.pendingQuestions(check)
				err = questionErr
				if err == nil {
					waiting, reconcileErr := s.reconcileQuestions(check, c.ID, c.SessionID, activity, questionSnapshot{questions: questions, version: version}, secrets)
					err = reconcileErr
					if err == nil && waiting {
						s.recoveryStatus(ctx, c, storage.Waiting, "Flora needs your answer")
					}
					status := statuses[c.SessionID].Type
					if err == nil && !waiting && (status == "" || status == "idle") && completed && runtimeID != "" {
						target, reason := storage.Idle, "Reconnected and recovered the saved terminal response; ready for new input. Transient activity may be missing."
						if failure || runtimeFailure.Load() {
							target, reason = storage.Failed, "The recovered response reports a provider or runtime failure. Inspect saved activity before sending new input."
						}
						if saveErr := s.transition(c.ID, c.ActiveMessageID, target, reason); saveErr == nil || errors.Is(saveErr, storage.ErrStale) {
							rt.client.CloseIdleConnections()
							cancel()
							return
						}
					}
					if err == nil && !waiting {
						reason, target := uncertainRecovery, storage.Waiting
						if status == "busy" || status == "retry" {
							target, reason = storage.Working, "Reconnected to existing execution; no message was resent"
							if status == "retry" {
								target, reason = storage.Waiting, "Waiting for the model provider to retry"
							}
						}
						s.recoveryStatus(ctx, c, target, reason)
					}
				}
			}
			rt.client.CloseIdleConnections()
		} else if err == nil {
			err = errors.New("saved session binding unavailable")
		}
		cancel()
		if err != nil {
			s.recoveryStatus(ctx, c, storage.Waiting, uncertainRecovery)
		}
		select {
		case <-ctx.Done():
			return
		case err := <-streamReady:
			if err == nil {
				disconnected = false
			}
			streamReady = nil
		case <-streamDone:
			select {
			case err := <-streamReady:
				if err == nil {
					disconnected = false
				}
			default:
			}
			streamCancel()
			streamCancel, streamDone = nil, nil
			streamReady = nil
			if !disconnected {
				gapPending = true
			}
			disconnected = true
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		case <-ticker.C:
		}
	}
}

func (s *Service) recoveryStatus(ctx context.Context, c storage.Chat, status storage.Status, reason string) {
	current, err := s.Store.Chat(ctx, c.ID)
	if err == nil && (current.Status != status || current.StatusReason != reason) {
		_ = s.transition(c.ID, c.ActiveMessageID, status, reason)
	}
}
