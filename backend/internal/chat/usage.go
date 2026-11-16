package chat

import (
	"context"
	"encoding/json"
	"time"

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
func (s *Service) captureUsage(ctx context.Context, rt *runtime, c storage.Chat, history []json.RawMessage, secrets []string, force bool) {
	if !force && time.Now().Before(rt.nextUsage) {
		return
	}
	rt.nextUsage = time.Now().Add(2 * time.Second)
	captureCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	complete := true
	defer func() {
		// Recording a failed capture must still work when its network deadline expired.
		saveCtx, done := context.WithTimeout(context.WithoutCancel(ctx), time.Second)
		defer done()
		_ = s.Store.SetUsageCapture(saveCtx, c.ID, complete)
	}()
	if rt.prices == nil && time.Now().After(rt.nextPrices) {
		rt.nextPrices = time.Now().Add(time.Minute)
		var providers struct {
			All []struct {
				ID     string `json:"id"`
				Models map[string]struct {
					Cost *struct {
						Input  *float64 `json:"input"`
						Output *float64 `json:"output"`
					} `json:"cost"`
				} `json:"models"`
			} `json:"all"`
		}
		if err := rt.call(captureCtx, "GET", "/provider", nil, &providers); err == nil {
			rt.prices = map[string]bool{}
			for _, p := range providers.All {
				for model, m := range p.Models {
					rt.prices[p.ID+"/"+model] = m.Cost != nil && m.Cost.Input != nil && m.Cost.Output != nil && (*m.Cost.Input > 0 || *m.Cost.Output > 0)
				}
			}
		}
	}
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
		if visited[session] || len(visited) >= 128 {
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
			if err := s.Store.SaveUsageMessage(captureCtx, c.ID, session, turn, redaction.JSON(raws[i], secrets...), rt.prices[m.Info.Provider+"/"+m.Info.Model]); err != nil {
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
		if err := rt.call(captureCtx, "GET", sessionPath(session)+"/children", nil, &children); err != nil {
			return false
		}
		ok := true
		for _, child := range children {
			if child.ID == "" || child.ParentID != session {
				ok = false
				continue
			}
			var childHistory []json.RawMessage
			if err := rt.call(captureCtx, "GET", sessionPath(child.ID)+"/message", nil, &childHistory); err != nil {
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
