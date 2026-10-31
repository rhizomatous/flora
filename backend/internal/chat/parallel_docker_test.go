package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

// Three real OpenCode bash tools wait independently. Model output comes only
// from this local fixture; checkout never contacts GitHub.
func TestThreeChatsDocker(t *testing.T) {
	image := os.Getenv("FLORA_CHAT_TEST_IMAGE")
	if image == "" {
		t.Skip("set FLORA_CHAT_TEST_IMAGE to a locally built pinned agent image")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
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
	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "data"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	provider := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			http.NotFound(w, r)
			return
		}
		body, _ := io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "text/event-stream")
		send := func(kind string, value any) {
			b, _ := json.Marshal(value)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", kind, b)
		}
		send("message_start", map[string]any{"type": "message_start", "message": map[string]any{"id": "msg_parallel", "type": "message", "role": "assistant", "content": []any{}, "model": "claude-sonnet-4-6", "stop_reason": nil, "stop_sequence": nil, "usage": map[string]int{"input_tokens": 10, "output_tokens": 0}}})
		stop := "end_turn"
		if !bytes.Contains(body, []byte(`"tool_result"`)) {
			stop = "tool_use"
			send("content_block_start", map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]any{"type": "tool_use", "id": "toolu_parallel", "name": "bash", "input": map[string]any{}}})
			input := `{"command":"echo own > /workspace/parallel-edit; echo own > /home/flora/parallel-state; cd /workspace; git add parallel-edit; touch /workspace/parallel-ready; while ! test -f /workspace/parallel-release; do sleep 0.1; done; echo finished","description":"Edit this chat and wait independently","timeout":120000}`
			send("content_block_delta", map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]string{"type": "input_json_delta", "partial_json": input}})
		} else {
			send("content_block_start", map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]string{"type": "text", "text": ""}})
			send("content_block_delta", map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]string{"type": "text_delta", "text": "This chat completed independently."}})
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
	url := fmt.Sprintf("http://%s:%d/v1", host, listener.Addr().(*net.TCPAddr).Port)
	if err := store.SaveCredentials(ctx, storage.Credentials{Provider: "anthropic", Model: "claude-sonnet-4-6", ProviderKey: "offline-test-key", GitHubToken: "github_pat_offline"}); err != nil {
		t.Fatal(err)
	}
	cfg := provisioning.Config{ImageRef: image, ImageDigest: testImage, ImageID: img.ID, HarnessVersion: "1.2.27", MaxRunning: 3, NanoCPUs: 1e9, MemoryBytes: 1 << 30, PidsLimit: 128}
	manager, err := provisioning.New(providerEngine{engine, url}, store, cfg, localCheckout{engine, store})
	if err != nil {
		t.Fatal(err)
	}
	processCtx, stopProcess := context.WithCancel(ctx)
	svc := New(processCtx, store, manager)
	defer stopProcess()
	chats := make([]storage.Chat, 3)
	for i := range chats {
		project, err := store.CreateProject(ctx, fmt.Sprintf("Project %d", i), storage.Configuration{Repositories: []storage.Repository{{Name: "core", URL: "https://github.com/example/core", BaseBranch: "main", Role: "core"}}})
		if err != nil {
			t.Fatal(err)
		}
		c, err := svc.Create(ctx, project.ID, fmt.Sprintf("Chat %d", i), "initial", "Run this chat's independent command")
		if err != nil {
			t.Fatal(err)
		}
		chats[i] = c
		defer func() {
			cleanup, stop := context.WithTimeout(context.Background(), 20*time.Second)
			defer stop()
			_ = engine.ContainerRemove(cleanup, "flora-chat-"+c.ID, true)
		}()
	}
	run := func(c storage.Chat, script string) string {
		t.Helper()
		var out, diagnostic bytes.Buffer
		code, err := engine.Exec(ctx, c.ContainerID, "flora", []string{"sh", "-ec", script}, nil, &out, &diagnostic)
		if err != nil || code != 0 {
			t.Fatalf("chat command: %d %v %s", code, err, &diagnostic)
		}
		return strings.TrimSpace(out.String())
	}
	wait := func(check func() bool) {
		t.Helper()
		deadline := time.Now().Add(60 * time.Second)
		for time.Now().Before(deadline) {
			if check() {
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatal("parallel chat condition timed out")
	}
	for i := range chats {
		wait(func() bool {
			chats[i], _ = store.Chat(ctx, chats[i].ID)
			if chats[i].Status == storage.Failed {
				t.Fatalf("chat failed: %s", chats[i].StatusReason)
			}
			if chats[i].ContainerID == "" {
				return false
			}
			code, err := engine.Exec(ctx, chats[i].ContainerID, "flora", []string{"test", "-f", "/workspace/parallel-ready"}, nil, io.Discard, io.Discard)
			return err == nil && code == 0
		})
		if _, err := svc.Submit(ctx, chats[i].ID, "followup", "must not queue"); !errors.Is(err, storage.ErrActive) {
			t.Fatalf("active follow-up: %v", err)
		}
		info, err := engine.ContainerInspect(ctx, chats[i].ContainerID)
		if err != nil {
			t.Fatal(err)
		}
		if info.HostConfig.NanoCPUs != cfg.NanoCPUs || info.HostConfig.Memory != cfg.MemoryBytes || info.HostConfig.PidsLimit != cfg.PidsLimit {
			t.Fatal("Docker resource settings differ")
		}
		run(chats[i], fmt.Sprintf("echo chat-%d > /workspace/parallel-edit; echo state-%d > /home/flora/parallel-state; cd /workspace; git config flora.chat chat-%d; touch only-%d; git add only-%d", i, i, i, i, i))
	}
	for i, c := range chats {
		want := fmt.Sprintf("chat-%d\nstate-%d\nchat-%d\nonly-%d", i, i, i, i)
		if got := run(c, "cat /workspace/parallel-edit /home/flora/parallel-state; cd /workspace; git config flora.chat; git ls-files 'only-*'"); got != want {
			t.Fatalf("shared writable files or Git config: %q", got)
		}
		own, err := manager.Endpoint(ctx, c.ID)
		if err != nil {
			t.Fatal(err)
		}
		other, err := manager.Endpoint(ctx, chats[(i+1)%3].ID)
		if err != nil {
			t.Fatal(err)
		}
		req, _ := http.NewRequestWithContext(ctx, "GET", other.URL+"/global/health", nil)
		req.SetBasicAuth(own.Username, own.Password)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatal("another chat's runtime accepted these credentials")
		}
		// Each peer's host paths are absent, and no Docker socket is available.
		paths, _ := store.Paths(ctx, chats[(i+1)%3].ID)
		run(c, fmt.Sprintf("test ! -e %q; test ! -e %q; test ! -e /var/run/docker.sock; test -f /workspace/.git/index; test ! -f /workspace/.git/commondir", paths.Workspace, paths.RuntimeState))
	}
	// Finish one while the others remain in their real bash tools.
	run(chats[1], "touch /workspace/parallel-release")
	wait(func() bool { c, _ := store.Chat(ctx, chats[1].ID); return c.Status == storage.Idle })
	for _, i := range []int{0, 2} {
		c, _ := store.Chat(ctx, chats[i].ID)
		if c.Status != storage.Working || c.ActiveMessageID == "" {
			t.Fatal("one chat's completion changed another chat")
		}
		run(c, "touch /workspace/parallel-release")
	}
	for _, c := range chats {
		wait(func() bool { current, _ := store.Chat(ctx, c.ID); return current.Status == storage.Idle })
	}
	var full *provisioning.CapacityError
	project, _ := store.Project(ctx, chats[0].ProjectID)
	extra, err := store.CreateChat(ctx, project.ID, "Overflow", testImage, "1.2.27")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Start(ctx, extra.ID); !errors.As(err, &full) || full.Running != 3 {
		t.Fatalf("idle containers did not fill capacity: %v", err)
	}
	if err := manager.Stop(ctx, chats[0].ID); err != nil {
		t.Fatal(err)
	}
	defer engine.ContainerRemove(context.Background(), "flora-chat-"+extra.ID, true)
	if _, err := manager.Start(ctx, extra.ID); err != nil {
		t.Fatal("stop did not free capacity", err)
	}
	for _, c := range append(chats[1:], extra) {
		if err := manager.Stop(ctx, c.ID); err != nil {
			t.Fatal(err)
		}
	}
	// Race two real Engine starts for the last slot, using distinct managers.
	cfg.MaxRunning = 1
	competitors := make([]*provisioning.Manager, 2)
	for i := range competitors {
		competitors[i], err = provisioning.New(providerEngine{engine, url}, store, cfg, localCheckout{engine, store})
		if err != nil {
			t.Fatal(err)
		}
	}
	type result struct {
		endpoint provisioning.Endpoint
		err      error
	}
	results := make(chan result, 2)
	start := make(chan struct{})
	for i, m := range competitors {
		c, err := store.CreateChat(ctx, project.ID, fmt.Sprintf("Racer %d", i), testImage, "1.2.27")
		if err != nil {
			t.Fatal(err)
		}
		defer engine.ContainerRemove(context.Background(), "flora-chat-"+c.ID, true)
		go func() { <-start; e, err := m.Start(ctx, c.ID); results <- result{e, err} }()
	}
	close(start)
	admitted, rejected := 0, 0
	for range competitors {
		r := <-results
		if r.err == nil && r.endpoint.ContainerID != "" {
			admitted++
		} else if errors.As(r.err, &full) {
			rejected++
		} else {
			t.Fatalf("Engine capacity race: %v", r.err)
		}
	}
	if admitted != 1 || rejected != 1 {
		t.Fatalf("Engine capacity race admitted=%d rejected=%d", admitted, rejected)
	}
}
