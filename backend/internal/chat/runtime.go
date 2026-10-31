// Package chat submits accepted turns and captures runtime observations independently
// of browser connections. Saved request identities never authorize automatic resend.
package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/rhizomatous/flora/backend/internal/provisioning"
	sse "github.com/tmaxmax/go-sse"
)

const SystemPrompt = `You are Flora, a helpful autonomous coding agent. Use simple, down-to-earth English and it/its pronouns. Work in /workspace, which contains this chat's checked-out repository on its own branch. Execute commands and edit files without per-action approval. You have Git, gh, and passwordless sudo for installing tools. Use the question tool when genuine user input is needed. Make and verify code changes, then commit them locally. Only push or open a draft pull request when the user asks. Use normal git and gh commands for GitHub access. Never print credentials, read credential files into output, or include secrets in commits. Preserve unrelated work.`

type runtime struct {
	endpoint provisioning.Endpoint
	client   *http.Client
}

type responseError struct{ status int }

func (e *responseError) Error() string {
	return fmt.Sprintf("runtime rejected request (HTTP %d)", e.status)
}

func newRuntime(e provisioning.Endpoint) *runtime {
	return &runtime{e, &http.Client{Transport: &http.Transport{}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func (c *runtime) request(ctx context.Context, method, path string, in any) (*http.Response, error) {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(b)
	}
	r, err := http.NewRequestWithContext(ctx, method, c.endpoint.URL+path, body)
	if err != nil {
		return nil, errors.New("cannot prepare runtime request")
	}
	r.SetBasicAuth(c.endpoint.Username, c.endpoint.Password)
	r.Header.Set("Content-Type", "application/json")
	return c.client.Do(r)
}

func (c *runtime) call(ctx context.Context, method, path string, in, out any) error {
	res, err := c.request(ctx, method, path, in)
	if err != nil {
		return errors.New("runtime connection lost; delivery may be uncertain")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return &responseError{res.StatusCode}
	}
	if out == nil {
		_, err = io.Copy(io.Discard, res.Body)
		return err
	}
	if err := json.NewDecoder(res.Body).Decode(out); err != nil {
		return errors.New("runtime response was incomplete")
	}
	return nil
}

func sessionPath(id string) string { return "/session/" + url.PathEscape(id) }

func (c *runtime) abort(ctx context.Context, session string) error {
	var confirmed bool
	if err := c.call(ctx, "POST", sessionPath(session)+"/abort", nil, &confirmed); err != nil {
		return err
	}
	if !confirmed {
		return errors.New("runtime did not confirm interruption")
	}
	questions, err := c.pendingQuestions(ctx)
	if err != nil {
		return err
	}
	for _, q := range questions {
		if q.SessionID == session {
			if err := c.call(ctx, "POST", "/question/"+url.PathEscape(q.ID)+"/reject", nil, nil); err != nil {
				return err
			}
		}
	}
	for {
		var statuses map[string]struct {
			Type string `json:"type"`
		}
		if err := c.call(ctx, "GET", "/session/status", nil, &statuses); err != nil {
			return err
		}
		questions, err := c.pendingQuestions(ctx)
		if err != nil {
			return err
		}
		var history []runtimeMessage
		if err := c.call(ctx, "GET", sessionPath(session)+"/message", nil, &history); err != nil {
			return err
		}
		waiting := false
		for _, q := range questions {
			if q.SessionID == session {
				waiting = true
			}
		}
		latestUser := ""
		for _, m := range history {
			if m.Info.Role == "user" {
				latestUser = m.Info.ID
			}
		}
		for _, m := range history {
			if m.Info.Role != "assistant" || m.Info.ParentID != latestUser {
				continue
			}
			if m.Info.Role == "assistant" && m.Info.Time.Completed == 0 {
				waiting = true
			}
			for _, p := range m.Parts {
				if p.Type == "tool" && p.State.Status != "completed" && p.State.Status != "error" {
					waiting = true
				}
			}
		}
		if status := statuses[session].Type; (status == "" || status == "idle") && !waiting {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}

type runtimeMessage struct {
	Info struct {
		ID       string          `json:"id"`
		Role     string          `json:"role"`
		ParentID string          `json:"parentID"`
		Provider string          `json:"providerID"`
		Model    string          `json:"modelID"`
		Error    json.RawMessage `json:"error"`
		Finish   string          `json:"finish"`
		Time     struct {
			Completed int64 `json:"completed"`
		} `json:"time"`
	} `json:"info"`
	Parts []struct {
		Type  string `json:"type"`
		Text  string `json:"text"`
		State struct {
			Status string `json:"status"`
		} `json:"state"`
	} `json:"parts"`
}

// OpenCode 1.2.27 emits status as properties.status, and question request IDs as
// properties.id (asked) or properties.requestID (replied/rejected). Session errors
// without a sessionID cannot be attributed to a particular chat.
type runtimeEvent struct {
	Type       string `json:"type"`
	Properties struct {
		SessionID string `json:"sessionID"`
		ID        string `json:"id"`
		RequestID string `json:"requestID"`
		Status    struct {
			Type    string `json:"type"`
			Attempt int    `json:"attempt"`
			Message string `json:"message"`
			Next    int64  `json:"next"`
		} `json:"status"`
		Error json.RawMessage `json:"error"`
		Info  struct {
			SessionID string `json:"sessionID"`
			ID        string `json:"id"`
			Role      string `json:"role"`
		} `json:"info"`
		Part struct {
			SessionID string `json:"sessionID"`
		} `json:"part"`
	} `json:"properties"`
}

// stream uses a standards-compliant SSE decoder. Upstream has no replay cursor;
// the caller records a capture gap if this stream ends unexpectedly.
func (c *runtime) stream(ctx context.Context, session string, ready chan<- error, capture func(string, json.RawMessage) error) error {
	streamClient := newRuntime(c.endpoint)
	streamClient.client.Transport.(*http.Transport).ResponseHeaderTimeout = 10 * time.Second
	defer streamClient.client.CloseIdleConnections()
	res, err := streamClient.request(ctx, "GET", "/event", nil)
	if err != nil {
		ready <- errors.New("runtime activity connection unavailable")
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		err = errors.New("runtime activity stream unavailable")
		ready <- err
		return err
	}
	ready <- nil
	for event, err := range sse.Read(res.Body, &sse.ReadConfig{MaxEventSize: 16 << 20}) {
		if err != nil {
			return err
		}
		var envelope runtimeEvent
		if json.Unmarshal([]byte(event.Data), &envelope) != nil {
			return errors.New("invalid runtime event")
		}
		p := envelope.Properties
		if p.SessionID != session && p.Info.SessionID != session && p.Part.SessionID != session {
			continue
		}
		if err := capture(envelope.Type, json.RawMessage(event.Data)); err != nil {
			return err
		}
	}
	return io.ErrUnexpectedEOF
}
