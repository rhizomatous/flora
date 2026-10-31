package chat

import (
	"encoding/json"
	"sync"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

// turnActivity keeps genuine user questions separate from provider retries.
// Question waits pause the active clock; retries remain part of continuous work.
type turnActivity struct {
	mu                     sync.Mutex
	provisioner            Provisioner
	containerID, messageID string
	questions              map[string]bool
	resolved               map[string]bool
	finished               bool
	version                uint64
}

func (a *turnActivity) event(kind string, payload json.RawMessage) (storage.Status, string) {
	var event runtimeEvent
	if json.Unmarshal(payload, &event) != nil {
		return "", ""
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.finished {
		return "", ""
	}
	switch kind {
	case "question.asked":
		if event.Properties.ID == "" || a.resolved[event.Properties.ID] || a.questions[event.Properties.ID] {
			return "", ""
		}
		a.questions[event.Properties.ID] = true
		a.version++
		a.provisioner.EndActivity(a.containerID)
	case "question.replied", "question.rejected":
		if !a.questions[event.Properties.RequestID] {
			return "", ""
		}
		delete(a.questions, event.Properties.RequestID)
		a.version++
		if a.resolved == nil {
			a.resolved = map[string]bool{}
		}
		a.resolved[event.Properties.RequestID] = true
		if len(a.questions) == 0 {
			a.provisioner.BeginActivity(a.containerID)
			return storage.Working, "Continuing after question"
		}
	case "session.status":
		if len(a.questions) == 0 {
			switch event.Properties.Status.Type {
			case "retry":
				return storage.Waiting, "Waiting for the model provider to retry"
			case "busy":
				a.provisioner.BeginActivity(a.containerID)
				return storage.Working, "Flora is working"
			}
		}
	default:
		return "", ""
	}
	if len(a.questions) > 0 {
		return storage.Waiting, "Flora needs your answer"
	}
	return "", ""
}

func (s *Service) endTurnActivity(chatID string, a *turnActivity) {
	s.turnMu.Lock()
	defer s.turnMu.Unlock()
	a.mu.Lock()
	a.finished = true
	a.mu.Unlock()
	if s.turns[chatID] == a {
		delete(s.turns, chatID)
		s.provisioner.EndActivity(a.containerID)
	}
}

func (s *Service) runtimeActivity(chatID string, a *turnActivity, kind string, payload json.RawMessage) error {
	s.turnMu.Lock()
	defer s.turnMu.Unlock()
	if s.turns[chatID] != a {
		return nil
	}
	status, reason := a.event(kind, payload)
	if status != "" {
		return s.transition(chatID, a.messageID, status, reason)
	}
	return nil
}

func (s *Service) questionActivity(chatID, messageID, questionID string, answered bool) {
	s.turnMu.Lock()
	defer s.turnMu.Unlock()
	a := s.turns[chatID]
	if a == nil || a.messageID != messageID {
		return
	}
	kind, key := "question.asked", "id"
	if answered {
		kind, key = "question.replied", "requestID"
	}
	b, _ := json.Marshal(map[string]any{"properties": map[string]string{key: questionID}})
	status, reason := a.event(kind, b)
	if status != "" {
		_ = s.transition(chatID, messageID, status, reason)
	}
}
