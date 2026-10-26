// Command probe-opencode is a bounded integration probe, not a production client.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const version = "1.2.27"
const provider = "anthropic"
const model = "claude-sonnet-4-6"
const maxBody = 16 << 20

type client struct {
	base, password string
	http           *http.Client
}

func (c *client) request(ctx context.Context, method, path string, body any, out any) error {
	var b bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&b).Encode(body); err != nil {
			return err
		}
	}
	r, err := http.NewRequestWithContext(ctx, method, c.base+path, &b)
	if err != nil {
		return err
	}
	r.SetBasicAuth("opencode", c.password)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("x-opencode-directory", "/workspace")
	resp, err := c.http.Do(r)
	if err != nil {
		return errors.New("runtime request failed (connection or deadline)")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Runtime error bodies can contain provider credentials or workspace content.
		return fmt.Errorf("%s %s: HTTP %d (body withheld)", method, path, resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return err
	}
	if len(data) > maxBody {
		return errors.New("response exceeded 16 MiB probe limit")
	}
	if out != nil {
		return json.Unmarshal(data, out)
	}
	return nil
}

func (c *client) ready(ctx context.Context) error {
	// Health, history, mutations and events must all be protected, not just UI paths.
	for _, endpoint := range []struct{ method, path string }{{"GET", "/global/health"}, {"GET", "/session"}, {"GET", "/event"}, {"POST", "/session"}} {
		path := endpoint.path
		r, _ := http.NewRequestWithContext(ctx, endpoint.method, c.base+path, nil)
		resp, err := c.http.Do(r)
		if err != nil {
			return errors.New("unauthenticated readiness request failed")
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			return fmt.Errorf("unauthenticated %s returned %d, want 401", path, resp.StatusCode)
		}
	}
	var health struct {
		Healthy bool
		Version string
	}
	if err := c.request(ctx, "GET", "/global/health", nil, &health); err != nil {
		return err
	}
	if !health.Healthy || health.Version != version {
		return fmt.Errorf("runtime not healthy or version differs from %s", version)
	}
	return nil
}

type message struct {
	Info struct {
		ID, Role, ProviderID, ModelID, Finish string
		Time                                  struct{ Completed int64 }
		Error                                 json.RawMessage
	} `json:"info"`
	Parts []json.RawMessage `json:"parts"`
}

func (c *client) history(ctx context.Context, session string) ([]message, error) {
	var result []message
	err := c.request(ctx, "GET", "/session/"+url.PathEscape(session)+"/message", nil, &result)
	return result, err
}

func toolMarker(history []message) bool {
	for _, m := range history {
		for _, raw := range m.Parts {
			var part struct {
				Type, Tool string
				State      struct{ Status, Output string }
			}
			if json.Unmarshal(raw, &part) == nil && part.Type == "tool" && part.Tool == "bash" && part.State.Status == "completed" && strings.Contains(part.State.Output, "flora-probe-marker") {
				return true
			}
		}
	}
	return false
}

func pause(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(200 * time.Millisecond):
		return nil
	}
}

// Completion is tied to a new assistant message, never an idle status observed
// before prompt_async has actually started. Unexpected questions fail visibly.
func (c *client) turn(ctx context.Context, session, text string, question bool) error {
	old, err := c.history(ctx, session)
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, m := range old {
		seen[m.Info.ID] = true
	}
	body := map[string]any{"agent": "build", "model": map[string]string{"providerID": provider, "modelID": model}, "parts": []any{map[string]string{"type": "text", "text": text}}}
	if err := c.request(ctx, "POST", "/session/"+url.PathEscape(session)+"/prompt_async", body, nil); err != nil {
		return err
	}
	answered := false
	for {
		var pending []struct {
			ID, SessionID string
			Questions     []struct{ Options []struct{ Label string } }
		}
		if err := c.request(ctx, "GET", "/question", nil, &pending); err != nil {
			return err
		}
		for _, q := range pending {
			if q.SessionID != session {
				continue
			}
			if !question || answered {
				return errors.New("unexpected pending question; use answer mode")
			}
			answers := make([][]string, len(q.Questions))
			for i, item := range q.Questions {
				if len(item.Options) == 0 {
					return errors.New("probe question has no options")
				}
				answers[i] = []string{item.Options[0].Label}
			}
			if err := c.request(ctx, "POST", "/question/"+url.PathEscape(q.ID)+"/reply", map[string]any{"answers": answers}, nil); err != nil {
				return err
			}
			answered = true
		}
		history, err := c.history(ctx, session)
		if err != nil {
			return err
		}
		var latest *message
		for i := range history {
			m := &history[i]
			if seen[m.Info.ID] || m.Info.Role != "assistant" {
				continue
			}
			if len(m.Info.Error) > 0 && string(m.Info.Error) != "null" {
				return errors.New("assistant error recorded; inspect private history")
			}
			if m.Info.ProviderID != provider || m.Info.ModelID != model {
				return errors.New("assistant model differs from installation pin")
			}
			latest = m
		}
		if latest != nil && latest.Info.Time.Completed != 0 && latest.Info.Finish != "tool-calls" && latest.Info.Finish != "unknown" {
			// A tool-call assistant message may complete before the final response.
			var statuses map[string]struct{ Type string }
			if err := c.request(ctx, "GET", "/session/status", nil, &statuses); err != nil {
				return err
			}
			if s, ok := statuses[session]; ok && s.Type != "idle" {
				if err := pause(ctx); err != nil {
					return err
				}
				continue
			}
			if question && !answered {
				return errors.New("model did not invoke the question tool")
			}
			return nil
		}
		if err := pause(ctx); err != nil {
			return err
		}
	}
}

// events consumes actual SSE frames, including multiline data and CRLF. No
// Last-Event-ID is sent: this runtime's stream has no replay cursor.
func (c *client) events(ctx context.Context, emit func(json.RawMessage) error) error {
	r, _ := http.NewRequestWithContext(ctx, "GET", c.base+"/event", nil)
	r.SetBasicAuth("opencode", c.password)
	r.Header.Set("x-opencode-directory", "/workspace")
	resp, err := c.http.Do(r)
	if err != nil {
		return errors.New("event connection failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		return errors.New("event endpoint did not return SSE")
	}
	return readSSE(resp.Body, emit)
}

func readSSE(r io.Reader, emit func(json.RawMessage) error) error {
	s := bufio.NewScanner(r)
	s.Buffer(make([]byte, 4096), maxBody)
	var data bytes.Buffer
	hasData := false
	for s.Scan() {
		line := s.Text()
		if line == "" {
			if hasData {
				b := append(json.RawMessage(nil), data.Bytes()...)
				if !json.Valid(b) {
					return errors.New("invalid event JSON")
				}
				if err := emit(b); err != nil {
					return err
				}
			}
			data.Reset()
			hasData = false
		} else if strings.HasPrefix(line, "data:") {
			v := strings.TrimPrefix(line, "data:")
			v = strings.TrimPrefix(v, " ")
			if data.Len()+len(v)+1 > maxBody {
				return errors.New("event exceeds 16 MiB")
			}
			if hasData {
				data.WriteByte('\n')
			}
			data.WriteString(v)
			hasData = true
		}
	}
	if err := s.Err(); err != nil {
		return err
	}
	return io.ErrUnexpectedEOF
}

func (c *client) interruptedShell(ctx context.Context, session string) error {
	before, err := c.history(ctx, session)
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, m := range before {
		seen[m.Info.ID] = true
	}
	shellCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- c.request(shellCtx, "POST", "/session/"+url.PathEscape(session)+"/shell", map[string]string{"agent": "build", "command": "sleep 60"}, nil)
	}()
	for {
		history, err := c.history(ctx, session)
		if err != nil {
			return err
		}
		// /shell does not publish busy status in this pin. Observe its new
		// persisted running part instead of assuming status covers shell calls.
		if unfinishedTool(history, seen) {
			break
		}
		select {
		case <-done:
			return errors.New("shell ended before interruption")
		default:
		}
		if err := pause(ctx); err != nil {
			return err
		}
	}
	if err := c.request(ctx, "POST", "/session/"+url.PathEscape(session)+"/abort", nil, nil); err != nil {
		return err
	}
	select {
	case err := <-done:
		if err != nil {
			return err
		}
	case <-ctx.Done():
		return ctx.Err()
	}
	for {
		history, err := c.history(ctx, session)
		if err != nil {
			return err
		}
		var statuses map[string]struct{ Type string }
		if err := c.request(ctx, "GET", "/session/status", nil, &statuses); err != nil {
			return err
		}
		if s, ok := statuses[session]; (!ok || s.Type == "idle") && !unfinishedTool(history, seen) {
			return nil
		}
		if err := pause(ctx); err != nil {
			return err
		}
	}
}

func unfinishedTool(history []message, excluded map[string]bool) bool {
	for _, m := range history {
		if excluded[m.Info.ID] {
			continue
		}
		for _, raw := range m.Parts {
			var part struct {
				Type  string
				State struct{ Status string }
			}
			if json.Unmarshal(raw, &part) == nil && part.Type == "tool" && (part.State.Status == "running" || part.State.Status == "pending") {
				return true
			}
		}
	}
	return false
}

func run(ctx context.Context, c *client, mode, session, sessionFile, text, requestID, answers string) error {
	if err := c.ready(ctx); err != nil {
		return err
	}
	switch mode {
	case "ready":
		return nil
	case "schema":
		var doc json.RawMessage
		if err := c.request(ctx, "GET", "/doc", nil, &doc); err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(doc)
	case "events":
		return c.events(ctx, func(b json.RawMessage) error { return json.NewEncoder(os.Stdout).Encode(b) })
	case "scenario":
		var created struct{ ID string }
		if err := c.request(ctx, "POST", "/session", map[string]string{"title": "Flora issue 2 probe"}, &created); err != nil {
			return err
		}
		if created.ID == "" {
			return errors.New("missing session ID")
		}
		session = created.ID
		// Exclusive create avoids accidentally replacing another run's identity.
		f, err := os.OpenFile(sessionFile, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return err
		}
		_, err = f.WriteString(session + "\n")
		closeErr := f.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		if err := c.turn(ctx, session, "Use bash to write flora-probe-marker to probe.txt, then run cat probe.txt so its output is recorded. Commit the file locally.", false); err != nil {
			return err
		}
		if err := c.turn(ctx, session, "Read probe.txt using bash and report the existing marker. Do not replace the file.", false); err != nil {
			return err
		}
		history, err := c.history(ctx, session)
		if err != nil {
			return err
		}
		if !toolMarker(history) {
			return errors.New("missing completed bash output with workspace marker")
		}
		if err := c.turn(ctx, session, "Invoke the question tool now with exactly one question: Continue the probe? Offer Yes and No, with Yes first. Wait for the answer, then acknowledge it.", true); err != nil {
			return err
		}
		if err := c.interruptedShell(ctx, session); err != nil {
			return err
		}
		if err := c.turn(ctx, session, "The shell was interrupted. Read probe.txt and confirm we can continue the same conversation.", false); err != nil {
			return err
		}
		return run(ctx, c, "inspect", session, sessionFile, text, requestID, answers)
	case "inspect":
		var h json.RawMessage
		if err := c.request(ctx, "GET", "/session/"+url.PathEscape(session)+"/message", nil, &h); err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(h)
	case "recover":
		h, err := c.history(ctx, session)
		if err != nil {
			return err
		}
		if len(h) < 4 {
			return errors.New("persisted history missing")
		}
		fmt.Fprintln(os.Stderr, "Activity gap: SSE is not replayable; restored message/part snapshot only.")
		if !toolMarker(h) {
			return errors.New("persisted tool output missing")
		}
		if err := c.turn(ctx, session, "After reconnect/restart, use bash to read probe.txt. Confirm its marker and summarize the earlier conversation.", false); err != nil {
			return err
		}
		after, err := c.history(ctx, session)
		if err != nil {
			return err
		}
		old := map[string]bool{}
		for _, m := range h {
			old[m.Info.ID] = true
		}
		var added []message
		for _, m := range after {
			if !old[m.Info.ID] {
				added = append(added, m)
			}
		}
		if !toolMarker(added) {
			return errors.New("new turn did not recover workspace marker via bash")
		}
		return nil
	case "turn":
		return c.turn(ctx, session, text, false)
	case "abort":
		return c.request(ctx, "POST", "/session/"+url.PathEscape(session)+"/abort", nil, nil)
	case "answer":
		var a [][]string
		if err := json.Unmarshal([]byte(answers), &a); err != nil {
			return err
		}
		return c.request(ctx, "POST", "/question/"+url.PathEscape(requestID)+"/reply", map[string]any{"answers": a}, nil)
	case "questions":
		var q json.RawMessage
		if err := c.request(ctx, "GET", "/question", nil, &q); err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(q)
	default:
		return errors.New("unknown mode")
	}
}

func main() {
	base := flag.String("url", "http://127.0.0.1:4096", "private runtime URL")
	mode := flag.String("mode", "ready", "ready, schema, events, scenario, inspect, recover, turn, abort, questions, answer")
	session := flag.String("session", "", "existing session ID")
	sessionFile := flag.String("session-file", "probe-session", "exclusive new session ID file (scenario)")
	text := flag.String("text", "", "turn text")
	requestID := flag.String("request", "", "question request ID")
	answers := flag.String("answers", "[]", "question answers as JSON string[][]")
	deadline := flag.Duration("timeout", 5*time.Minute, "overall bounded probe deadline")
	flag.Parse()
	u, err := url.Parse(*base)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		fmt.Fprintln(os.Stderr, "invalid private runtime URL")
		os.Exit(1)
	}
	password := os.Getenv("OPENCODE_SERVER_PASSWORD")
	if password == "" {
		fmt.Fprintln(os.Stderr, "OPENCODE_SERVER_PASSWORD is required")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), *deadline)
	defer cancel()
	c := &client{strings.TrimRight(*base, "/"), password, &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	if err := run(ctx, c, *mode, *session, *sessionFile, *text, *requestID, *answers); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
