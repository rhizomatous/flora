package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func fake(t *testing.T, handler http.HandlerFunc) *client {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, p, ok := r.BasicAuth()
		if !ok || u != "opencode" || p != "test-password" {
			w.WriteHeader(401)
			return
		}
		if r.Header.Get("x-opencode-directory") != "/workspace" {
			t.Error("missing workspace header")
		}
		handler(w, r)
	}))
	t.Cleanup(s.Close)
	return &client{s.URL, "test-password", s.Client()}
}

func TestReadinessPinAndAuth(t *testing.T) {
	for _, v := range []string{version, "wrong-version"} {
		t.Run(v, func(t *testing.T) {
			c := fake(t, func(w http.ResponseWriter, r *http.Request) { fmt.Fprintf(w, `{"healthy":true,"version":%q}`, v) })
			err := c.ready(context.Background())
			if (err == nil) != (v == version) {
				t.Fatalf("ready: %v", err)
			}
		})
	}
}

func TestReadinessRejectsPublicServer(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{}`) }))
	defer s.Close()
	c := &client{s.URL, "password", s.Client()}
	if err := c.ready(context.Background()); err == nil {
		t.Fatal("accepted public server")
	}
}

func TestSSE(t *testing.T) {
	var got []json.RawMessage
	err := readSSE(strings.NewReader(": heartbeat\r\nid: ignored\r\ndata: {\r\ndata: \"type\":\"server.connected\"}\r\n\r\n"), func(b json.RawMessage) error { got = append(got, b); return nil })
	if err != io.ErrUnexpectedEOF || len(got) != 1 || !json.Valid(got[0]) {
		t.Fatalf("%s %v", got, err)
	}
	if err := readSSE(strings.NewReader("data: broken\n\n"), func(json.RawMessage) error { return nil }); err == nil {
		t.Fatal("accepted invalid event")
	}
}

func TestTurnWaitsForNewMessageAndAnswersQuestion(t *testing.T) {
	started, answered := false, false
	c := fake(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/session/ses_test/message":
			if !answered {
				fmt.Fprint(w, `[{"info":{"id":"old","role":"assistant","time":{"completed":1}}}]`)
				return
			}
			fmt.Fprintf(w, `[{"info":{"id":"new","role":"assistant","providerID":%q,"modelID":%q,"time":{"completed":2}},"parts":[]}]`, provider, model)
		case "/session/ses_test/prompt_async":
			var body struct {
				Model struct{ ProviderID, ModelID string }
				Agent string
				Parts []struct{ Type, Text string }
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body.Model.ProviderID != provider || body.Model.ModelID != model || body.Agent != "build" || len(body.Parts) != 1 {
				t.Error("wrong prompt schema")
			}
			started = true
			w.WriteHeader(204)
		case "/question":
			if !started {
				t.Error("polled before prompt")
			}
			fmt.Fprint(w, `[{"id":"que_test","sessionID":"ses_test","questions":[{"options":[{"label":"Yes"}]}]}]`)
		case "/question/que_test/reply":
			b, _ := io.ReadAll(r.Body)
			if strings.TrimSpace(string(b)) != `{"answers":[["Yes"]]}` {
				t.Errorf("wrong answer %s", b)
			}
			answered = true
			fmt.Fprint(w, `true`)
		case "/session/status":
			fmt.Fprint(w, `{}`)
		default:
			t.Errorf("unexpected %s", r.URL.Path)
			w.WriteHeader(404)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := c.turn(ctx, "ses_test", "ask", true); err != nil {
		t.Fatal(err)
	}
	if !answered {
		t.Fatal("did not answer")
	}
}

func TestTurnDoesNotMistakeIdleForCompletion(t *testing.T) {
	c := fake(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/session/s/message", "/question":
			fmt.Fprint(w, `[]`)
		case "/session/s/prompt_async":
			w.WriteHeader(204)
		case "/session/status":
			fmt.Fprint(w, `{}`)
		default:
			w.WriteHeader(404)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if err := c.turn(ctx, "s", "hello", false); err == nil {
		t.Fatal("completed without a response")
	}
}

func TestErrorsDoNotPrintRuntimeBody(t *testing.T) {
	c := fake(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(500); fmt.Fprint(w, "secret-api-key") })
	err := c.request(context.Background(), "GET", "/session", nil, nil)
	if err == nil || strings.Contains(err.Error(), "secret-api-key") {
		t.Fatalf("unsafe error: %v", err)
	}
}

func TestInterruptionWaitsForShellAndIdle(t *testing.T) {
	// The fake coordinates the shell and abort rather than depending on sleeps.
	active := make(chan struct{})
	aborted := make(chan struct{})
	c := fake(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/session/s/shell":
			close(active)
			<-aborted
			fmt.Fprint(w, `{"role":"assistant"}`)
		case "/session/s/abort":
			close(aborted)
			fmt.Fprint(w, `true`)
		case "/session/status":
			select {
			case <-aborted:
				fmt.Fprint(w, `{}`)
			default:
				select {
				case <-active:
					fmt.Fprint(w, `{"s":{"type":"busy"}}`)
				default:
					fmt.Fprint(w, `{}`)
				}
			}
		default:
			w.WriteHeader(404)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := c.interruptedShell(ctx, "s"); err != nil {
		t.Fatal(err)
	}
}
