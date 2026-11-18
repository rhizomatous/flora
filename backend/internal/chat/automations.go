package chat

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

// RunAutomations runs in the application process after chat recovery. Claimed
// occurrences are never replayed, even when the process exits during delivery.
func (s *Service) RunAutomations(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		if err := s.TickAutomations(ctx, time.Now()); err != nil && ctx.Err() == nil {
			slog.Error("Automation scheduling failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func (s *Service) TickAutomations(ctx context.Context, at time.Time) error {
	runs, err := s.Store.UnreleasedAutomationRuns(ctx)
	if err != nil {
		return err
	}
	for _, r := range runs {
		c, err := s.Store.Chat(ctx, r.ChatID)
		if err != nil {
			return err
		}
		// A follow-up belongs to the user. Only release a chat whose last accepted
		// message is still this automation's completed turn.
		messages, err := s.Store.Messages(ctx, c.ID)
		if err != nil {
			return err
		}
		latest := ""
		for _, m := range messages {
			if m.Role == "user" {
				latest = m.ID
			}
		}
		if latest == r.MessageID && c.Status == storage.Idle && c.ActiveMessageID == "" {
			until, err := s.Store.RuntimeLease(ctx, c.ID)
			if err != nil {
				return err
			}
			if until.After(at) {
				continue
			}
			if s.AutomationBeforeStop != nil {
				if err := s.AutomationBeforeStop(ctx, c.ID); err != nil {
					slog.Error("Automation changes could not be saved before stopping", "error", err)
					continue
				}
			}
			if err := s.controlObserved(ctx, c, true, false, true); err != nil {
				if errors.Is(err, storage.ErrStale) {
					continue
				}
				return err
			}
		}
		if err := s.Store.ReleaseAutomationRun(ctx, r.ID); err != nil {
			return err
		}
	}
	list, err := s.Store.Automations(ctx)
	if err != nil {
		return err
	}
	for _, a := range list {
		if _, err := s.StartAutomation(ctx, a.ID, "", at, true); err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) StartAutomation(ctx context.Context, id, requestID string, at time.Time, scheduled bool) (storage.AutomationRun, error) {
	a, r, claimed, err := s.Store.ClaimAutomation(ctx, id, requestID, at, scheduled)
	if err != nil || !claimed {
		return r, err
	}
	// The saved claim outlives HTTP cancellation. The chat service itself owns
	// asynchronous execution; disconnecting a browser cannot abandon admission.
	ctx, cancel := context.WithTimeout(s.ctx, 30*time.Second)
	defer cancel()
	chatID := a.ChatID
	// Without an override, standing chats retain their last accepted selection.
	if a.Mode == "same" && chatID != "" {
		c, readErr := s.Store.Chat(ctx, chatID)
		if readErr != nil {
			err = readErr
		} else if c.ActiveMessageID != "" || c.Status == storage.Working || c.Status == storage.Waiting {
			r.Status = "skipped"
			r.Reason = "This chat is working or waiting for an answer."
			r.ChatID = chatID
			return r, s.Store.SetAutomationRun(ctx, r.ID, r.Status, r.Reason, chatID)
		} else {
			_, err = s.SubmitWithExecution(ctx, chatID, r.ID, a.Instructions, a.Execution)
		}
	} else {
		if s.provisioner == nil {
			err = errors.New("chat runtime is not configured")
		} else {
			// New chats use the installation default unless the automation overrides it.
			image, harness := s.provisioner.Identity()
			var c storage.Chat
			c, err = s.Store.CreateChatRequest(ctx, a.ProjectID, a.Name, image, harness, r.ID, a.Instructions)
			chatID = c.ID
			if err == nil {
				err = s.Store.BindAutomationChat(ctx, a, chatID)
			}
			if err == nil {
				_, err = s.SubmitWithExecution(ctx, chatID, r.ID, a.Instructions, a.Execution)
			}
		}
	}
	if err != nil {
		r.Status = "failed"
		r.Reason = "Could not start this run. Check the chat and installation settings before running again."
		if errors.Is(err, storage.ErrActive) {
			r.Status = "skipped"
			r.Reason = "This chat is working or waiting for an answer."
		}
		var control *ControlError
		if errors.As(err, &control) {
			r.Reason = control.Reason
		}
		r.ChatID = chatID
		saveCtx, saveCancel := context.WithTimeout(s.ctx, 5*time.Second)
		defer saveCancel()
		return r, s.Store.SetAutomationRun(saveCtx, r.ID, r.Status, r.Reason, chatID)
	}
	history, err := s.Store.AutomationRuns(ctx, a.ID)
	if err != nil {
		return r, err
	}
	for _, saved := range history {
		if saved.ID == r.ID {
			return saved, nil
		}
	}
	return r, storage.ErrNotFound
}

// ValidateAutomationExecution checks a saved override against available models and reasoning variants.
// Runs validate again at admission so unavailable choices cannot silently fall back.
func (s *Service) ValidateAutomationExecution(ctx context.Context, selected *storage.Execution, chatIDs ...string) error {
	if selected == nil {
		return nil
	}
	return s.validateExecution(ctx, *selected, nil, chatIDs...)
}
