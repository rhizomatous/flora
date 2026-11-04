package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

// TestRecoveryDocker cancels Flora's connections while a real OpenCode bash tool
// runs, then attaches a fresh service to the saved session. Only the local
// provider fixture supplies model output; commands cannot write to GitHub.
func TestRecoveryDocker(t *testing.T) {
	image := os.Getenv("FLORA_CHAT_TEST_IMAGE")
	if image == "" {
		t.Skip("set FLORA_CHAT_TEST_IMAGE to a locally built pinned agent image")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	engine, err := docker.New(os.Getenv("FLORA_CHAT_DOCKER_SOCKET"))
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	img, err := engine.ImageInspect(ctx, image)
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(t.TempDir(), "data")
	store, err := storage.Open(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	var calls atomic.Int32
	provider := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		calls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		send := func(kind string, value any) {
			b, _ := json.Marshal(value)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", kind, b)
		}
		send("message_start", map[string]any{"type": "message_start", "message": map[string]any{"id": "msg_fixture", "type": "message", "role": "assistant", "content": []any{}, "model": "claude-sonnet-4-6", "stop_reason": nil, "stop_sequence": nil, "usage": map[string]int{"input_tokens": 10, "output_tokens": 0}}})
		stop := "end_turn"
		if !strings.Contains(string(body), `"tool_result"`) && !strings.Contains(string(body), "explicit continuation") {
			stop = "tool_use"
			send("content_block_start", map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]any{"type": "tool_use", "id": "toolu_recovery", "name": "bash", "input": map[string]any{}}})
			input := `{"command":"echo action >> /workspace/action-count; touch /workspace/recovery-ready; while ! test -f /workspace/recovery-release; do sleep 0.1; done; echo recovered","description":"Hold execution for connection recovery","timeout":90000}`
			send("content_block_delta", map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]string{"type": "input_json_delta", "partial_json": input}})
		} else {
			send("content_block_start", map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]string{"type": "text", "text": ""}})
			send("content_block_delta", map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]string{"type": "text_delta", "text": "Recovered existing execution."}})
		}
		send("content_block_stop", map[string]any{"type": "content_block_stop", "index": 0})
		send("message_delta", map[string]any{"type": "message_delta", "delta": map[string]any{"stop_reason": stop, "stop_sequence": nil}, "usage": map[string]int{"output_tokens": 15}})
		send("message_stop", map[string]string{"type": "message_stop"})
	}))
	listener, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	provider.Listener = listener
	provider.Start()
	defer provider.Close()
	host := os.Getenv("FLORA_CHAT_PROVIDER_HOST")
	if host == "" {
		host = "host.docker.internal"
	}
	providerURL := fmt.Sprintf("http://%s:%d/v1", host, listener.Addr().(*net.TCPAddr).Port)
	if err := store.SaveCredentials(ctx, storage.Credentials{Provider: "anthropic", Model: "claude-sonnet-4-6", ProviderKey: "offline-test-key", GitHubToken: "github_pat_offline"}); err != nil {
		t.Fatal(err)
	}
	project, err := store.CreateProject(ctx, "Recovery fixture", storage.Configuration{Repositories: []storage.Repository{{Name: "core", URL: "https://github.com/example/core", BaseBranch: "main", Role: "core"}}})
	if err != nil {
		t.Fatal(err)
	}
	network, err := engine.NetworkInspect(ctx, "bridge")
	if err != nil {
		t.Fatal(err)
	}
	config := provisioning.Config{NetworkID: network.ID, BrokerGateway: network.Gateways[0], ImageRef: image, ImageDigest: testImage, ImageID: img.ID, HarnessVersion: "1.2.27"}
	manager, err := provisioning.New(providerEngine{engine, providerURL}, store, config, localCheckout{engine, store})
	if err != nil {
		t.Fatal(err)
	}
	processCtx, stopProcess := context.WithCancel(ctx)
	svc := New(processCtx, store, manager)
	c, err := svc.Create(ctx, project.ID, "Surviving tool", "initial", "Run the held command once")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 20*time.Second)
		defer stop()
		_ = engine.ContainerRemove(cleanup, "flora-chat-"+c.ID, true)
	}()
	deadline := time.Now().Add(40 * time.Second)
	ready := false
	for time.Now().Before(deadline) {
		c, _ = store.Chat(ctx, c.ID)
		if c.ContainerID != "" {
			exit, err := engine.Exec(ctx, c.ContainerID, "0", []string{"sh", "-c", "test -f /workspace/recovery-ready"}, nil, io.Discard, io.Discard)
			if err == nil && exit == 0 {
				ready = true
				break
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !ready {
		t.Fatal("real bash never started: ", c.StatusReason)
	}
	endpoint, err := manager.Endpoint(ctx, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	rt := newRuntime(endpoint)
	var health struct {
		Version string `json:"version"`
	}
	err = rt.call(ctx, "GET", "/global/health", nil, &health)
	rt.client.CloseIdleConnections()
	if err != nil || health.Version != "1.2.27" {
		t.Fatalf("unexpected runtime version: %s, %v", health.Version, err)
	}
	stopProcess()
	if err := svc.quiesce(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = storage.Open(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	manager, err = provisioning.New(providerEngine{engine, providerURL}, store, config, localCheckout{engine, store})
	if err != nil {
		t.Fatal(err)
	}
	recoveryCtx, stopRecovery := context.WithCancel(ctx)
	recovered := New(recoveryCtx, store, manager)
	defer func() { stopRecovery(); _ = recovered.quiesce(context.Background(), c.ID) }()
	for range 3 {
		if err := recovered.Reconcile(ctx); err != nil {
			t.Fatal(err)
		}
	}
	time.Sleep(time.Second)
	exit, err := engine.Exec(ctx, c.ContainerID, "0", []string{"sh", "-c", "touch /workspace/recovery-release"}, nil, io.Discard, io.Discard)
	if err != nil || exit != 0 {
		t.Fatal("could not release surviving command")
	}
	waitStatus(t, recovered, c.ID, storage.Idle)
	var out strings.Builder
	exit, err = engine.Exec(ctx, c.ContainerID, "0", []string{"sh", "-c", "wc -l < /workspace/action-count"}, nil, &out, io.Discard)
	if err != nil || exit != 0 || strings.TrimSpace(out.String()) != "1" {
		t.Fatal("action replayed: ", out.String())
	}
	messages, _ := store.Messages(ctx, c.ID)
	users := 0
	for _, m := range messages {
		if m.Role == "user" {
			users++
		}
	}
	if users != 1 || calls.Load() != 2 {
		t.Fatalf("duplicate delivery: users=%d provider calls=%d", users, calls.Load())
	}
	current, _ := store.Chat(ctx, c.ID)
	if current.ContainerID != c.ContainerID || current.SessionID != c.SessionID {
		t.Fatal("recovery replaced runtime identity")
	}
	// A stopped daemon container models the state left by a host reboot. Startup
	// must report the exit rather than start it or replay the previous command.
	if err := engine.ContainerStop(ctx, c.ContainerID, 1); err != nil {
		t.Fatal(err)
	}
	if err := recovered.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, recovered, c.ID, storage.Failed)
	info, err := engine.ContainerInspect(ctx, c.ContainerID)
	if err != nil || info.State.Running || calls.Load() != 2 {
		t.Fatal("reboot-equivalent state restarted execution")
	}
	if err := engine.ContainerRemove(ctx, c.ContainerID, false); err != nil {
		t.Fatal(err)
	}
	if err := recovered.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	missing, err := store.Chat(ctx, c.ID)
	if err != nil || missing.StatusReason != missingContainerRecovery || recovered.ContinuationBlock(ctx, missing) == "" {
		t.Fatal("removed container advertised continuation")
	}
	if _, err := recovered.Submit(ctx, c.ID, "after-removal", "continue"); err == nil {
		t.Fatal("removed container accepted futile continuation")
	}
	saved, err := store.Messages(ctx, c.ID)
	if err != nil || len(saved) != len(messages) || calls.Load() != 2 {
		t.Fatal("missing-container check changed history or submitted work")
	}
	for _, mode := range []string{"crash", "oom", "host-reboot"} {
		interrupted, err := recovered.Create(ctx, project.ID, mode, mode, "Hold another real command")
		if err != nil {
			t.Fatal(err)
		}
		defer func(id string) {
			cleanup, stop := context.WithTimeout(context.Background(), 20*time.Second)
			defer stop()
			_ = engine.ContainerRemove(cleanup, "flora-chat-"+id, true)
		}(interrupted.ID)
		deadline := time.Now().Add(30 * time.Second)
		started := false
		for time.Now().Before(deadline) {
			interrupted, _ = store.Chat(ctx, interrupted.ID)
			if interrupted.ContainerID != "" {
				exit, err := engine.Exec(ctx, interrupted.ContainerID, "0", []string{"sh", "-c", "test -f /workspace/recovery-ready"}, nil, io.Discard, io.Discard)
				if err == nil && exit == 0 {
					started = true
					break
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
		if !started {
			t.Fatal("failure fixture command did not start")
		}
		before := calls.Load()
		if mode == "crash" || mode == "oom" {
			socket := os.Getenv("FLORA_CHAT_DOCKER_SOCKET")
			if socket == "" {
				socket = docker.DefaultSocket
			}
			args := []string{"--host", "unix://" + socket, "kill", interrupted.ContainerID}
			if mode == "oom" {
				args = []string{"--host", "unix://" + socket, "update", "--memory", "6m", "--memory-swap", "6m", interrupted.ContainerID}
			}
			if output, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput(); err != nil {
				t.Fatalf("%s fixture: %v: %s", mode, err, output)
			}
		} else if err := engine.ContainerStop(ctx, interrupted.ContainerID, 0); err != nil {
			t.Fatal(err)
		}
		if err := recovered.quiesce(ctx, interrupted.ID); err != nil {
			t.Fatal(err)
		}
		// A fresh process has no prompt transport or activity map to consult.
		freshCtx, stopFresh := context.WithCancel(ctx)
		fresh := New(freshCtx, store, manager)
		if err := fresh.Reconcile(ctx); err != nil {
			t.Fatal(err)
		}
		failed := waitStatus(t, fresh, interrupted.ID, storage.Failed)
		info, err := engine.ContainerInspect(ctx, interrupted.ContainerID)
		if err != nil || info.State.Running || calls.Load() != before || failed.SessionID != interrupted.SessionID {
			t.Fatal("dead runtime restarted or lost context")
		}
		if mode == "oom" && (!info.State.OOMKilled || !strings.Contains(failed.StatusReason, "out of memory")) {
			t.Fatal("real OOM was not identified")
		}
		paths, err := store.Paths(ctx, interrupted.ID)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(paths.Workspace, "action-count")); err != nil {
			t.Fatal("workspace lost after exit")
		}
		if mode == "crash" {
			if _, err := fresh.Submit(ctx, interrupted.ID, "new-after-crash", "explicit continuation: inspect saved context, do not replay the held command"); err != nil {
				t.Fatal(err)
			}
			continued := waitStatus(t, fresh, interrupted.ID, storage.Idle)
			if continued.SessionID != interrupted.SessionID || continued.ContainerID != interrupted.ContainerID {
				t.Fatal("explicit continuation replaced saved context")
			}
			var count strings.Builder
			exit, err := engine.Exec(ctx, interrupted.ContainerID, "0", []string{"sh", "-c", "wc -l < /workspace/action-count"}, nil, &count, io.Discard)
			if err != nil || exit != 0 || strings.TrimSpace(count.String()) != "1" {
				t.Fatal("continuation replayed an old command")
			}
		}
		stopFresh()
		_ = fresh.quiesce(context.Background(), interrupted.ID)
	}
	t.Log("Pinned OpenCode 1.2.27: backend storage reopened mid-bash; same session/container, one user input, one bash action, two provider requests; stopped container retained without restart")
}
