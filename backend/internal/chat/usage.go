package chat

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/redaction"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

type usageHistory struct {
	Info struct {
		ID        string `json:"id"`
		Role      string `json:"role"`
		SessionID string `json:"sessionID"`
		ParentID  string `json:"parentID"`
		Provider  string `json:"providerID"`
		Model     string `json:"modelID"`
		Time      struct {
			Created int64 `json:"created"`
		} `json:"time"`
	} `json:"info"`
	Parts []struct {
		Type  string `json:"type"`
		State struct {
			Time struct {
				Start int64 `json:"start"`
				End   int64 `json:"end"`
			} `json:"time"`
			Metadata struct {
				SessionID string `json:"sessionId"`
			} `json:"metadata"`
		} `json:"state"`
	} `json:"parts"`
}

type usageInvocation struct {
	start, end int64
	turn       string
}

// captureUsage reconciles the session tree without changing execution state. A
// failed traversal retains earlier spending and marks the summary incomplete.
// Only sessions returned as children of this chat's root are accepted.
func (s *Service) captureUsage(ctx context.Context, rt *runtime, c storage.Chat, history []json.RawMessage, secrets []string) {
	captureCtx := ctx
	complete := true
	defer func() {
		// Recording a failed capture must still work when its network deadline expired.
		saveCtx, done := context.WithTimeout(context.WithoutCancel(ctx), time.Second)
		defer done()
		_ = s.Store.SetUsageCapture(saveCtx, c.ID, storage.UsageCapture{Complete: complete, Revision: c.UpdatedAt})
	}()
	messages, err := s.Store.Messages(captureCtx, c.ID)
	if err != nil {
		complete = false
		return
	}
	turns := map[string]string{}
	for _, m := range messages {
		if m.Role == "user" && m.RuntimeMessageID != "" {
			turns[m.RuntimeMessageID] = m.ID
		}
	}
	visited := map[string]bool{}
	var collect func(string, []json.RawMessage, []usageInvocation) bool
	collect = func(session string, raws []json.RawMessage, invocations []usageInvocation) bool {
		if visited[session] || captureCtx.Err() != nil {
			return false
		}
		visited[session] = true
		parsed := make([]usageHistory, len(raws))
		userTimes := map[string]int64{}
		for i, raw := range raws {
			if json.Unmarshal(raw, &parsed[i]) != nil {
				return false
			}
			m := parsed[i]
			if m.Info.SessionID != "" && m.Info.SessionID != session {
				return false
			}
			if m.Info.Role == "user" {
				userTimes[m.Info.ID] = m.Info.Time.Created
			}
		}
		childrenTurns := map[string][]usageInvocation{}
		for i, m := range parsed {
			if m.Info.Role != "assistant" {
				continue
			}
			turn := ""
			if session == c.SessionID {
				turn = turns[m.Info.ParentID]
			} else {
				turn = invocationTurn(userTimes[m.Info.ParentID], invocations)
			}
			if err := s.Store.SaveUsageMessage(captureCtx, c.ID, session, turn, c.UpdatedAt, redaction.JSON(raws[i], secrets...)); err != nil {
				return false
			}
			for _, p := range m.Parts {
				if p.Type == "tool" && p.State.Metadata.SessionID != "" {
					childrenTurns[p.State.Metadata.SessionID] = append(childrenTurns[p.State.Metadata.SessionID], usageInvocation{p.State.Time.Start, p.State.Time.End, turn})
				}
			}
		}
		var children []struct {
			ID       string `json:"id"`
			ParentID string `json:"parentID"`
		}
		if err := usageCall(captureCtx, rt, "GET", sessionPath(session)+"/children", nil, &children); err != nil {
			return false
		}
		ok := true
		for _, child := range children {
			if captureCtx.Err() != nil {
				return false
			}
			if child.ID == "" || child.ParentID != session {
				ok = false
				continue
			}
			var childHistory []json.RawMessage
			if err := usageCall(captureCtx, rt, "GET", sessionPath(child.ID)+"/message", nil, &childHistory); err != nil {
				ok = false
				continue
			}
			if !collect(child.ID, childHistory, childrenTurns[child.ID]) {
				ok = false
			}
		}
		return ok
	}
	complete = collect(c.SessionID, history, nil)
}

// Child sessions can be resumed by later turns. Match the child user message's
// creation time to its parent tool invocation rather than the currently active turn.
// Missing or ambiguous timing leaves attribution unknown without losing chat usage.
func invocationTurn(created int64, invocations []usageInvocation) string {
	turn := ""
	for _, inv := range invocations {
		if inv.start <= 0 || created < inv.start || (inv.end != 0 && created > inv.end) {
			continue
		}
		if turn != "" && turn != inv.turn {
			return ""
		}
		turn = inv.turn
	}
	return turn
}

// Each request has its own deadline. A healthy large session tree can finish
// without consuming a shared timeout while shutdown still cancels the traversal.
func usageCall(ctx context.Context, rt *runtime, method, path string, in, out any) error {
	requestCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return rt.call(requestCtx, method, path, in, out)
}

// RunUsage collects saved history independently of turn delivery and browser
// connections. It never starts a container, submits a prompt, or changes status.
func (s *Service) RunUsage(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		_ = s.ReconcileUsage(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// ReconcileUsage scans all saved sessions, including finished chats. Successful
// settled chats need no more reads until their saved chat state changes.
func (s *Service) ReconcileUsage(ctx context.Context) error {
	if s.provisioner == nil || !s.usageMu.TryLock() {
		return nil
	}
	defer s.usageMu.Unlock()
	chats, err := s.Store.Chats(ctx)
	if err != nil {
		return err
	}
	jobs := make(chan storage.Chat)
	var workers sync.WaitGroup
	for range 4 {
		workers.Go(func() {
			for c := range jobs {
				s.reconcileChatUsage(ctx, c)
			}
		})
	}
	defer workers.Wait()
	defer close(jobs)
	for _, c := range chats {
		if c.SessionID == "" {
			continue
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case jobs <- c:
		}
	}
	return nil
}

func (s *Service) reconcileChatUsage(ctx context.Context, c storage.Chat) {
	usage, err := s.Store.ChatUsage(ctx, c.ID)
	if err != nil {
		return
	}
	if c.ActiveMessageID == "" && usage.Collection == "complete" && usage.ReconciledRevision == c.UpdatedAt {
		return
	}
	// Failed endpoints are retried without inspecting every stopped container on
	// each live-usage tick. A newly changed chat bypasses this delay.
	checked, _ := time.Parse(time.RFC3339Nano, usage.CheckedAt)
	if (usage.Collection != "complete" || c.ActiveMessageID == "") && usage.ReconciledRevision == c.UpdatedAt && time.Since(checked) < s.usageRetryInterval {
		return
	}
	endpointCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	endpoint, err := s.provisioner.Endpoint(endpointCtx, c.ID)
	cancel()
	if err != nil {
		reason := "history_unavailable"
		var ended *provisioning.ExecutionEndedError
		if errors.As(err, &ended) {
			reason = "runtime_stopped"
		}
		if ctx.Err() == nil {
			_ = s.Store.SetUsageCapture(ctx, c.ID, storage.UsageCapture{Reason: reason, Revision: c.UpdatedAt})
		}
		return
	}
	rt := newRuntime(endpoint)
	defer rt.client.CloseIdleConnections()
	var history []json.RawMessage
	if err := usageCall(ctx, rt, "GET", sessionPath(c.SessionID)+"/message", nil, &history); err != nil {
		if ctx.Err() == nil {
			_ = s.Store.SetUsageCapture(ctx, c.ID, storage.UsageCapture{Reason: "history_unavailable", Revision: c.UpdatedAt})
		}
		return
	}
	s.captureUsage(ctx, rt, c, history, redaction.Values(ctx, s.Store, c.ID, endpoint.Password, endpoint.ProviderKey))
}
