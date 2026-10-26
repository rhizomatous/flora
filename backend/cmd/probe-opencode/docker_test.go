package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"
)

// This opt-in test uses the real pinned runtime but NEVER requests model
// generation. noReply and /shell are explicitly not provider acceptance evidence.
func TestDockerWithoutProvider(t *testing.T) {
	image := os.Getenv("FLORA_OPENCODE_TEST_IMAGE")
	if image == "" {
		t.Skip("set FLORA_OPENCODE_TEST_IMAGE to the locally built probe image")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	var nonce [32]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		t.Fatal(err)
	}
	prefix := "flora-issue2-test-" + hex.EncodeToString(nonce[:8])
	password := hex.EncodeToString(nonce[8:])
	docker := func(args ...string) string {
		t.Helper()
		cmd := exec.CommandContext(ctx, "docker", args...)
		cmd.Env = append(os.Environ(), "OPENCODE_SERVER_PASSWORD="+password, "ANTHROPIC_API_KEY=intentionally-invalid-no-provider-calls")
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("docker %s failed: %v (output withheld)", args[0], err)
		}
		return strings.TrimSpace(string(out))
	}
	var names, volumes []string
	t.Cleanup(func() {
		cleanupCtx, stop := context.WithTimeout(context.Background(), 30*time.Second)
		defer stop()
		for _, name := range names {
			_ = exec.CommandContext(cleanupCtx, "docker", "rm", "-f", name).Run()
		}
		for _, v := range volumes {
			_ = exec.CommandContext(cleanupCtx, "docker", "volume", "rm", v).Run()
		}
	})
	start := func(name, home, workspace, setup, timeout string) {
		t.Helper()
		names = append(names, name)
		for _, v := range []string{home, workspace} {
			docker("volume", "create", v)
			volumes = append(volumes, v)
		}
		docker("run", "-d", "--name", name, "--cpus", "2", "--memory", "2g", "--pids-limit", "256", "-p", "127.0.0.1::4096", "-v", home+":/home/flora", "-v", workspace+":/workspace", "-e", "OPENCODE_SERVER_PASSWORD", "-e", "ANTHROPIC_API_KEY", "-e", "SETUP_COMMAND="+setup, "-e", "SETUP_TIMEOUT_SECONDS="+timeout, image)
	}
	connect := func(name string) *client {
		t.Helper()
		address := docker("port", name, "4096/tcp")
		c := &client{"http://" + address, password, &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
		for i := 0; i < 60; i++ {
			readyCtx, stop := context.WithTimeout(ctx, time.Second)
			err := c.ready(readyCtx)
			stop()
			if err == nil {
				return c
			}
			if err := pause(ctx); err != nil {
				t.Fatal(err)
			}
		}
		t.Fatal("runtime did not become ready (private logs retained only until cleanup)")
		return nil
	}
	setup := "sudo -n apk add --no-cache jq && git init /workspace && printf 'setup\\n' >> /home/flora/setup/runs"
	name, home, workspace := prefix+"-runtime", prefix+"-home", prefix+"-workspace"
	start(name, home, workspace, setup, "60")
	c := connect(name)
	t.Log("live authenticated health/version and unauthenticated 401 checks passed")
	if uid := docker("exec", name, "sudo", "-E", "-u", "flora", "id", "-u"); uid != "1000" {
		t.Fatalf("agent uid: %s", uid)
	}
	docker("exec", name, "sudo", "-E", "-u", "flora", "sudo", "-n", "jq", "--version")
	var config map[string]json.RawMessage
	if err := c.request(ctx, "GET", "/config", nil, &config); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"model", "small_model"} {
		if string(config[key]) != `"anthropic/claude-sonnet-4-6"` {
			t.Fatalf("unexpected configured %s", key)
		}
	}
	var agents []struct{ Name, Prompt string }
	if err := c.request(ctx, "GET", "/agent", nil, &agents); err != nil {
		t.Fatal(err)
	}
	promptFound := false
	for _, a := range agents {
		if a.Name == "build" && strings.Contains(a.Prompt, "You are Flora") {
			promptFound = true
		}
	}
	if !promptFound {
		t.Fatal("Flora system prompt missing")
	}
	var toolIDs []string
	if err := c.request(ctx, "GET", "/experimental/tool/ids", nil, &toolIDs); err != nil {
		t.Fatal(err)
	}
	questionEnabled := false
	for _, id := range toolIDs {
		if id == "question" {
			questionEnabled = true
		}
	}
	if !questionEnabled {
		t.Fatal("headless question tool is not registered")
	}
	var doc struct{ Paths map[string]json.RawMessage }
	if err := c.request(ctx, "GET", "/doc", nil, &doc); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/session/{sessionID}/prompt_async", "/question/{requestID}/reply", "/event"} {
		if len(doc.Paths[path]) == 0 {
			t.Fatalf("missing live API schema: %s", path)
		}
	}
	var shellRoute struct {
		Post struct {
			Responses map[string]struct {
				Content map[string]struct {
					Schema struct {
						Ref string `json:"$ref"`
					}
				}
			}
		}
	}
	if err := json.Unmarshal(doc.Paths["/session/{sessionID}/shell"], &shellRoute); err != nil {
		t.Fatal(err)
	}
	t.Logf("live /doc declares shell response schema %q; actual response envelope is checked separately", shellRoute.Post.Responses["200"].Content["application/json"].Schema.Ref)

	var mu sync.Mutex
	eventTypes := map[string]int{}
	eventCtx, stopEvents := context.WithCancel(ctx)
	connected := make(chan struct{}, 1)
	eventsDone := make(chan error, 1)
	go func() {
		eventsDone <- c.events(eventCtx, func(b json.RawMessage) error {
			var e struct{ Type string }
			if err := json.Unmarshal(b, &e); err != nil {
				return err
			}
			mu.Lock()
			eventTypes[e.Type]++
			mu.Unlock()
			if e.Type == "server.connected" {
				select {
				case connected <- struct{}{}:
				default:
				}
			}
			return nil
		})
	}()
	defer stopEvents()
	select {
	case <-connected:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	var session struct{ ID string }
	if err := c.request(ctx, "POST", "/session", map[string]string{"title": "NO PROVIDER: Docker contract test"}, &session); err != nil {
		t.Fatal(err)
	}
	path := "/session/" + session.ID
	for _, text := range []string{"first stored turn, no inference", "second stored turn, same session"} {
		body := map[string]any{"noReply": true, "agent": "build", "model": map[string]string{"providerID": provider, "modelID": model}, "parts": []any{map[string]string{"type": "text", "text": text}}}
		if err := c.request(ctx, "POST", path+"/message", body, nil); err != nil {
			t.Fatal(err)
		}
	}
	var shell json.RawMessage
	if err := c.request(ctx, "POST", path+"/shell", map[string]string{"agent": "build", "command": "printf flora-probe-marker > probe.txt; cat probe.txt; sudo -n true"}, &shell); err != nil {
		t.Fatal(err)
	}
	var shellShape struct {
		Info  struct{ Role string }
		Parts []json.RawMessage
	}
	if err := json.Unmarshal(shell, &shellShape); err != nil || shellShape.Info.Role != "assistant" || len(shellShape.Parts) == 0 {
		t.Fatal("shell response must be a message-with-parts envelope")
	}
	if err := c.interruptedShell(ctx, session.ID); err != nil {
		t.Fatal(err)
	}
	t.Log("live deterministic shell interruption confirmed before another shell turn")
	if err := c.request(ctx, "POST", path+"/shell", map[string]string{"agent": "build", "command": "cat probe.txt"}, nil); err != nil {
		t.Fatal(err)
	}

	// Disconnect the actual HTTP caller and SSE observer while a shell is busy.
	// A fresh client must see it continue, not restart or abort it.
	shellCtx, stopShell := context.WithCancel(ctx)
	shellDone := make(chan error, 1)
	go func() {
		shellDone <- c.request(shellCtx, "POST", path+"/shell", map[string]string{"agent": "build", "command": "sleep 2; printf reconnect-completed > reconnect.txt; cat reconnect.txt"}, nil)
	}()
	waitBusy(t, ctx, c, session.ID)
	stopShell()
	stopEvents()
	<-shellDone
	<-eventsDone
	c = connect(name)
	reconnectCtx, stopReconnect := context.WithCancel(ctx)
	defer stopReconnect()
	reconnectDone := make(chan error, 1)
	reconnected := make(chan struct{}, 1)
	reconnectedPart := make(chan struct{}, 1)
	go func() {
		reconnectDone <- c.events(reconnectCtx, func(b json.RawMessage) error {
			var e struct {
				Type       string
				Properties struct {
					Part struct{ State struct{ Status string } }
				}
			}
			if err := json.Unmarshal(b, &e); err != nil {
				return err
			}
			if e.Type == "server.connected" {
				select {
				case reconnected <- struct{}{}:
				default:
				}
			}
			if e.Type == "message.part.updated" && e.Properties.Part.State.Status == "completed" {
				select {
				case reconnectedPart <- struct{}{}:
				default:
				}
			}
			return nil
		})
	}()
	select {
	case <-reconnected:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	waitIdle(t, ctx, c, session.ID)
	select {
	case <-reconnectedPart:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	stopReconnect()
	<-reconnectDone
	docker("exec", name, "sh", "-c", "test \"$(cat /workspace/reconnect.txt)\" = reconnect-completed")
	t.Log("HTTP caller and SSE disconnected during a real shell; fresh client observed completion")
	mu.Lock()
	for _, kind := range []string{"server.connected", "message.updated", "message.part.updated", "session.status"} {
		if eventTypes[kind] == 0 {
			t.Errorf("missing actual runtime event %s", kind)
		}
	}
	mu.Unlock()
	before, err := c.history(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(before) < 4 || !toolMarker(before) {
		t.Fatal("stored turns/tool output missing")
	}
	checkPersisted := func() {
		t.Helper()
		after, err := c.history(ctx, session.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(after) != len(before) {
			t.Fatalf("history count changed: %d to %d", len(before), len(after))
		}
		for i, m := range before {
			if after[i].Info.ID != m.Info.ID || after[i].Info.ModelID != m.Info.ModelID || after[i].Info.ProviderID != m.Info.ProviderID || len(after[i].Parts) != len(m.Parts) {
				t.Fatal("message/part identity or model metadata lost")
			}
			for j, p := range m.Parts {
				if string(after[i].Parts[j]) != string(p) {
					t.Fatal("persisted part changed")
				}
			}
		}
		docker("exec", name, "sh", "-c", "test \"$(cat /workspace/probe.txt)\" = flora-probe-marker")
	}
	docker("stop", "-t", "5", name)
	docker("start", name)
	c = connect(name)
	checkPersisted()
	docker("exec", name, "sh", "-c", "test \"$(wc -l < /home/flora/setup/runs)\" -eq 1")
	docker("rm", "-f", name)
	start(name, home, workspace, setup, "60")
	c = connect(name)
	checkPersisted()
	docker("exec", name, "sh", "-c", "test \"$(wc -l < /home/flora/setup/runs)\" -eq 2")
	t.Log("stop/start and replacement preserve full parts/workspace; setup counts 1 then 2")

	// Kill active execution. This is history recovery, not automatic continuation.
	activeCtx, stopActive := context.WithCancel(ctx)
	defer stopActive()
	activeDone := make(chan error, 1)
	go func() {
		activeDone <- c.request(activeCtx, "POST", path+"/shell", map[string]string{"agent": "build", "command": "sleep 30; touch must-not-replay"}, nil)
	}()
	waitBusy(t, ctx, c, session.ID)
	docker("kill", "--signal", "KILL", name)
	<-activeDone
	docker("start", name)
	c = connect(name)
	var statuses map[string]struct{ Type string }
	if err := c.request(ctx, "GET", "/session/status", nil, &statuses); err != nil {
		t.Fatal(err)
	}
	var questions []json.RawMessage
	if err := c.request(ctx, "GET", "/question", nil, &questions); err != nil {
		t.Fatal(err)
	}
	if len(questions) != 0 {
		t.Fatal("unexpected pending question")
	}
	h, err := c.history(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	last := h[len(h)-1]
	var partStatuses []string
	for _, raw := range last.Parts {
		var p struct {
			Type  string
			State struct{ Status string }
		}
		_ = json.Unmarshal(raw, &p)
		if p.Type == "tool" {
			partStatuses = append(partStatuses, p.State.Status)
		}
	}
	t.Logf("after SIGKILL/restart: runtime session status=%q; last tool states=%v; pending questions=%d", statuses[session.ID].Type, partStatuses, len(questions))
	docker("exec", name, "sh", "-c", "test ! -e /workspace/must-not-replay")
	if err := c.request(ctx, "POST", path+"/shell", map[string]string{"agent": "build", "command": "cat probe.txt"}, nil); err != nil {
		t.Fatal(err)
	}

	for _, kind := range []string{"failure", "timeout"} {
		t.Run(kind, func(t *testing.T) {
			n := prefix + "-" + kind
			command := "printf 'setup attempt\\n'; printf 'attempt\\n' >> /home/flora/setup/attempts; if [ ! -f /home/flora/setup/retry ]; then touch /home/flora/setup/retry; exit 23; fi"
			want := "23"
			if kind == "timeout" {
				command = "printf 'setup attempt\\n'; printf 'attempt\\n' >> /home/flora/setup/attempts; sleep 30"
				want = "124"
			}
			start(n, n+"-home", n+"-workspace", command, "1")
			if code := docker("wait", n); code != want {
				t.Fatalf("container exit %s want %s", code, want)
			}
			// Use a separate temporary reader, since docker exec cannot read a stopped container.
			check := fmt.Sprintf("test \"$(cat /home/flora/setup/exit-status)\" = %s; test -s /home/flora/setup/output.log; test -s /home/flora/setup/attempts", want)
			docker("run", "--rm", "--entrypoint", "sh", "-v", n+"-home:/home/flora", image, "-c", check)
			docker("start", n)
			if kind == "failure" {
				_ = connect(n)
				docker("exec", n, "test", "-f", "/var/lib/flora-setup.done")
				t.Log("exit 23 blocked startup; next start retried setup and became ready")
			} else {
				if code := docker("wait", n); code != "124" {
					t.Fatalf("timeout retry exit %s", code)
				}
				docker("run", "--rm", "--entrypoint", "sh", "-v", n+"-home:/home/flora", image, "-c", "test \"$(wc -l < /home/flora/setup/attempts)\" -eq 2")
				t.Log("timeout 124 blocked startup and was retried on next start")
			}
		})
	}
}

func waitBusy(t *testing.T, ctx context.Context, c *client, session string) {
	t.Helper()
	for {
		history, err := c.history(ctx, session)
		if err != nil {
			t.Fatal(err)
		}
		if len(history) > 0 && unfinishedTool(history[len(history)-1:], nil) {
			return
		}
		if err := pause(ctx); err != nil {
			t.Fatal(err)
		}
	}
}

func waitIdle(t *testing.T, ctx context.Context, c *client, session string) {
	t.Helper()
	for {
		history, err := c.history(ctx, session)
		if err != nil {
			t.Fatal(err)
		}
		if len(history) > 0 && !unfinishedTool(history[len(history)-1:], nil) {
			return
		}
		if err := pause(ctx); err != nil {
			t.Fatal(err)
		}
	}
}
