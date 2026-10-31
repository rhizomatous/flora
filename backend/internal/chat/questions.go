package chat

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"maps"

	"github.com/rhizomatous/flora/backend/internal/redaction"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

const maxQuestionSnapshotBytes = 1 << 20

// pendingQuestions requires one complete, bounded array. A failed or incomplete
// response must never be interpreted as evidence that a user question disappeared.
func (rt *runtime) pendingQuestions(ctx context.Context) ([]Question, error) {
	response, err := rt.request(ctx, "GET", "/question", nil)
	if err != nil {
		return nil, errors.New("runtime questions unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &responseError{response.StatusCode}
	}
	limited := &io.LimitedReader{R: response.Body, N: maxQuestionSnapshotBytes + 1}
	decoder := json.NewDecoder(limited)
	var questions []Question
	if decoder.Decode(&questions) != nil || questions == nil {
		return nil, errors.New("runtime question list was incomplete")
	}
	if decoder.Decode(new(any)) != io.EOF || limited.N <= 0 {
		return nil, errors.New("runtime question list was incomplete or oversized")
	}
	seen := map[string]bool{}
	for _, q := range questions {
		if q.ID == "" || q.SessionID == "" || q.Questions == nil || seen[q.ID] {
			return nil, errors.New("runtime question list was invalid")
		}
		seen[q.ID] = true
	}
	return questions, nil
}

type questionSnapshot struct {
	questions []Question
	version   uint64
	err       error
}

func (a *turnActivity) questionVersion() uint64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.version
}

// reconcileQuestions changes only this process's active turn. Older successful
// polls may discover questions, but cannot remove questions observed after they
// began. Failed polls never reach this method. Resolved IDs reject stale re-adds.
func (s *Service) reconcileQuestions(ctx context.Context, chatID, sessionID string, a *turnActivity, snapshot questionSnapshot, secrets []string) (bool, error) {
	if snapshot.err != nil {
		return false, snapshot.err
	}
	if snapshot.questions == nil {
		return false, errors.New("runtime question list was incomplete")
	}
	s.turnMu.Lock()
	defer s.turnMu.Unlock()
	if s.turns[chatID] != a {
		return false, nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.finished {
		return false, nil
	}
	pending := map[string]bool{}
	observed := []Question{}
	for _, q := range snapshot.questions {
		if q.SessionID == sessionID {
			pending[q.ID] = true
			observed = append(observed, q)
		}
	}
	next := maps.Clone(a.questions)
	for id := range pending {
		if !a.resolved[id] {
			next[id] = true
		}
	}
	if snapshot.version == a.version {
		for id := range next {
			if !pending[id] {
				delete(next, id)
			}
		}
	}
	if maps.Equal(next, a.questions) {
		return len(next) > 0, nil
	}
	payload, _ := json.Marshal(map[string]any{"questions": observed})
	if err := s.Store.AppendActivity(ctx, chatID, rand.Text(), "question.snapshot", redaction.JSON(payload, secrets...)); err != nil {
		return len(a.questions) > 0, err
	}
	if a.resolved == nil {
		a.resolved = map[string]bool{}
	}
	for id := range a.questions {
		if !next[id] {
			a.resolved[id] = true
		}
	}
	a.questions = next
	a.version++
	status, reason := storage.Waiting, "Flora needs your answer"
	if len(next) > 0 {
		a.provisioner.EndActivity(a.containerID)
	} else {
		a.provisioner.BeginActivity(a.containerID)
		status, reason = storage.Working, "Runtime no longer reports a pending question; checking turn progress"
	}
	return len(next) > 0, s.transition(chatID, a.messageID, status, reason)
}
