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
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

type localCheckout struct {
	engine *docker.Client
	store  *storage.Store
}

func (a localCheckout) Revoke(context.Context, string) error { return nil }
func (a localCheckout) Checkout(ctx context.Context, chat storage.Chat, paths storage.Paths, id string) error {
	// No remote GitHub writes or real credentials. The ordinary container tools
	// still initialize a workspace and commit before releasing the setup barrier.
	var out strings.Builder
	info, err := os.Stat(paths.Workspace)
	if err != nil {
		return err
	}
	owner := info.Sys().(*syscall.Stat_t)
	gid := owner.Gid
	if gid == 0 {
		gid = owner.Uid
	}
	user := fmt.Sprintf("%d:%d", owner.Uid, gid)
	exit, err := a.engine.Exec(ctx, id, user, []string{"sh", "-c", "git init -q /workspace && cd /workspace && git config user.email flora@example.test && git config user.name Flora && touch sample && git add sample && git commit -qm initial && git rev-parse HEAD"}, nil, &out, io.Discard)
	if err != nil || exit != 0 {
		return fmt.Errorf("local checkout failed")
	}
	if err := a.store.RecordStartingCommit(ctx, chat.ID, "core", strings.TrimSpace(out.String())); err != nil {
		return err
	}
	_, err = a.engine.Exec(ctx, id, "0", []string{"sh", "-c", ": > /home/flora/.flora-github.env; touch /var/lib/flora-checkout.ready"}, nil, io.Discard, io.Discard)
	return err
}

type providerEngine struct {
	*docker.Client
	providerURL string
}

func (p providerEngine) ContainerCreate(ctx context.Context, spec docker.ContainerSpec) (string, error) {
	for i, value := range spec.Env {
		if raw, ok := strings.CutPrefix(value, "OPENCODE_CONFIG_CONTENT="); ok {
			var config map[string]any
			if err := json.Unmarshal([]byte(raw), &config); err != nil {
				return "", err
			}
			config["provider"] = map[string]any{"anthropic": map[string]any{"options": map[string]string{"baseURL": p.providerURL}}}
			b, _ := json.Marshal(config)
			spec.Env[i] = "OPENCODE_CONFIG_CONTENT=" + string(b)
		}
	}
	spec.Env = append(spec.Env, "OPENCODE_DISABLE_MODELS_FETCH=true")
	return p.Client.ContainerCreate(ctx, spec)
}

// TestChatDocker uses the pinned OpenCode server, a real setup/workspace and real
// bash execution. A local Anthropic-compatible fixture supplies deterministic
// responses without contacting a paid model or giving it remote write access.
func TestChatDocker(t *testing.T) {
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
		t.Fatal("test image is not present")
	}
	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "data"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	var calls atomic.Int32
	var followupContext atomic.Bool
	provider := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("unexpected provider path %s", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		body, _ := io.ReadAll(r.Body)
		if strings.Contains(string(body), "error marker") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(401)
			fmt.Fprint(w, `{"type":"error","error":{"type":"authentication_error","message":"offline provider denied"}}`)
			return
		}
		if strings.Contains(string(body), "followup marker") && strings.Contains(string(body), "initial marker") {
			followupContext.Store(true)
		}
		n := calls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		send := func(kind string, value any) {
			b, _ := json.Marshal(value)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", kind, b)
		}
		send("message_start", map[string]any{"type": "message_start", "message": map[string]any{"id": fmt.Sprintf("msg_test_%d", n), "type": "message", "role": "assistant", "content": []any{}, "model": "claude-sonnet-4-6", "stop_reason": nil, "stop_sequence": nil, "usage": map[string]int{"input_tokens": 10, "output_tokens": 0}}})
		stopReason := "end_turn"
		if n == 1 || n == 2 {
			stopReason = "tool_use"
			tool, input := "bash", `{"command":"pwd && git status --short","description":"Inspect workspace"}`
			if n == 2 {
				tool, input = "question", `{"questions":[{"header":"Continue","question":"Confirm read-only inspection?","options":[{"label":"Yes","description":"Continue"}]}]}`
			}
			send("content_block_start", map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]any{"type": "tool_use", "id": fmt.Sprintf("toolu_test_%d", n), "name": tool, "input": map[string]any{}}})
			send("content_block_delta", map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]string{"type": "input_json_delta", "partial_json": input}})
		} else {
			send("content_block_start", map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]string{"type": "text", "text": ""}})
			send("content_block_delta", map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]string{"type": "text_delta", "text": "Workspace inspected. Context retained."}})
		}
		send("content_block_stop", map[string]any{"type": "content_block_stop", "index": 0})
		send("message_delta", map[string]any{"type": "message_delta", "delta": map[string]any{"stop_reason": stopReason, "stop_sequence": nil}, "usage": map[string]int{"output_tokens": 15}})
		send("message_stop", map[string]string{"type": "message_stop"})
	}))
	listener, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	provider.Listener = listener
	provider.Start()
	defer provider.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	providerHost := os.Getenv("FLORA_CHAT_PROVIDER_HOST")
	if providerHost == "" {
		providerHost = "host.docker.internal"
	}
	providerURL := fmt.Sprintf("http://%s:%d/v1", providerHost, port)
	if err := store.SaveCredentials(ctx, storage.Credentials{Provider: "anthropic", Model: "claude-sonnet-4-6", ProviderKey: "offline-test-key", GitHubToken: "github_pat_offline"}); err != nil {
		t.Fatal(err)
	}
	project, err := store.CreateProject(ctx, "Offline integration", storage.Configuration{Repositories: []storage.Repository{{Name: "core", URL: "https://github.com/example/core", BaseBranch: "main", Role: "core"}}, SetupCommand: "printf 'setup complete\\n'; test -f /workspace/sample"})
	if err != nil {
		t.Fatal(err)
	}
	manager, err := provisioning.New(providerEngine{engine, providerURL}, store, provisioning.Config{ImageRef: image, ImageDigest: testImage, ImageID: img.ID, HarnessVersion: "1.2.27"}, localCheckout{engine, store})
	if err != nil {
		t.Fatal(err)
	}
	svc := New(ctx, store, manager)
	svc.promptAdmissionTimeout = time.Second
	c, err := svc.Create(ctx, project.ID, "Real runtime", "initial", "initial marker: inspect the workspace without editing")
	if err != nil {
		t.Fatal(err)
	}
	// The deterministic name permits cleanup even if startup fails before the
	// container is bound. It belongs only to this newly created test chat.
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 30*time.Second)
		defer stop()
		_ = engine.ContainerRemove(cleanup, "flora-chat-"+c.ID, true)
	}()
	wait := func() storage.Chat {
		deadline := time.Now().Add(90 * time.Second)
		for time.Now().Before(deadline) {
			current, err := store.Chat(ctx, c.ID)
			if err != nil {
				t.Fatal(err)
			}
			if current.Status == storage.Idle {
				return current
			}
			if current.Status == storage.Waiting && current.StatusReason == "Flora needs your answer" {
				// The pinned server may buffer headers until the answer arrives.
				// Saved admission evidence must allow a longer question wait.
				time.Sleep(2 * svc.promptAdmissionTimeout)
				questions, err := svc.Questions(ctx, c.ID)
				if err != nil || len(questions) != 1 {
					t.Fatal("real question unavailable")
				}
				if err := svc.Reply(ctx, c.ID, questions[0].ID, [][]string{{"Yes"}}); err != nil {
					t.Fatal(err)
				}
				continue
			}
			if current.Status == storage.Failed || current.Status == storage.Waiting {
				messages, _ := store.Messages(ctx, c.ID)
				for _, message := range messages {
					var saved runtimeMessage
					if json.Unmarshal(message.Payload, &saved) == nil && len(saved.Info.Error) > 0 {
						t.Logf("Saved runtime error: %s", saved.Info.Error)
					}
				}
				t.Fatalf("runtime failed: %s", current.StatusReason)
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatal("runtime did not finish")
		return storage.Chat{}
	}
	first := wait()
	if _, err := svc.Submit(ctx, c.ID, "followup", "followup marker: confirm prior context"); err != nil {
		t.Fatal(err)
	}
	second := wait()
	if first.SessionID == "" || first.SessionID != second.SessionID || first.ContainerID != second.ContainerID || len(second.StartingCommits) != 1 || !followupContext.Load() {
		t.Fatal("workspace/session/context not retained")
	}
	messages, _ := store.Messages(ctx, c.ID)
	foundTool, foundModel := false, false
	for _, m := range messages {
		if strings.Contains(string(m.Payload), "/workspace") && strings.Contains(string(m.Payload), `"tool":"bash"`) {
			foundTool = true
		}
		if m.Provider == "anthropic" && m.Model == "claude-sonnet-4-6" {
			foundModel = true
		}
	}
	if !foundTool || !foundModel {
		t.Fatal("real tool output/model metadata were not captured")
	}
	rows, _ := store.Activities(ctx, c.ID, 0, 1000)
	foundSetup := false
	for _, row := range rows {
		if row.Kind == "setup.output" && strings.Contains(string(row.Payload), "setup complete") {
			foundSetup = true
		}
	}
	if !foundSetup {
		t.Fatal("setup output not retained")
	}
	foundBusy, foundAsked, foundReplied := false, false, false
	for _, row := range rows {
		var event runtimeEvent
		_ = json.Unmarshal(row.Payload, &event)
		if event.Properties.SessionID != second.SessionID {
			continue
		}
		if event.Type == "session.status" && event.Properties.Status.Type == "busy" {
			foundBusy = true
		}
		if event.Type == "question.asked" && event.Properties.ID != "" {
			foundAsked = true
		}
		if event.Type == "question.replied" && event.Properties.RequestID != "" {
			foundReplied = true
		}
	}
	if !foundBusy || !foundAsked || !foundReplied {
		t.Fatal("pinned runtime status/question event shapes were not captured")
	}
	if _, err := svc.Submit(ctx, c.ID, "provider-failure", "error marker: read-only provider failure"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		current, _ := store.Chat(ctx, c.ID)
		if current.Status == storage.Failed {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	current, _ := store.Chat(ctx, c.ID)
	if current.Status != storage.Failed {
		t.Fatal("real runtime provider rejection was not visible")
	}
	rows, _ = store.Activities(ctx, c.ID, 0, 1000)
	foundError := false
	for _, row := range rows {
		if row.Kind == "runtime.session.error" {
			var event runtimeEvent
			_ = json.Unmarshal(row.Payload, &event)
			if event.Properties.SessionID == second.SessionID && strings.Contains(string(event.Properties.Error), `"name":"APIError"`) {
				foundError = true
			}
		}
	}
	if !foundError {
		t.Fatal("pinned session.error schema was not captured")
	}
	t.Logf("Pinned OpenCode: %d provider fixture calls, %d saved messages, %d saved events; same session/workspace on follow-up", calls.Load(), len(messages), len(rows))
}
