package provisioning

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

// observedEngine records state transitions without logging container environments
// or endpoint credentials. It forwards each request without retries or delays.
type observedEngine struct {
	Engine
	t *testing.T
}

func (e observedEngine) ContainerList(ctx context.Context, running bool, labels map[string]string) ([]docker.ContainerSummary, error) {
	list, err := e.Engine.ContainerList(ctx, running, labels)
	for _, c := range list {
		e.t.Logf("list running=%t: id=%s state=%s", running, c.ID, c.State)
	}
	return list, err
}

func (e observedEngine) ContainerStop(ctx context.Context, id string, timeoutSeconds int) error {
	err := e.Engine.ContainerStop(ctx, id, timeoutSeconds)
	e.t.Logf("stop id=%s: %v", id, err)
	return err
}

func (e observedEngine) ContainerInspect(ctx context.Context, id string) (docker.ContainerInfo, error) {
	info, err := e.Engine.ContainerInspect(ctx, id)
	e.t.Logf("inspect id=%s: running=%t status=%s err=%v", id, info.State.Running, info.State.Status, err)
	return info, err
}

// This opt-in test runs the real pinned agent image against a real Docker
// daemon, entirely through the Engine API client. It never requests model
// generation. Build the image first:
//
//	docker build -t flora-agent-test:local agent/image
//	FLORA_PROVISIONING_TEST_IMAGE=flora-agent-test:local \
//	  go -C backend test -race -count=1 -v -run TestProvisioningDocker ./internal/provisioning
//
// The test removes only the containers it created, including after failure.
// On native Linux it also proves the agent runs as the backend's own uid, so
// backend-owned storage and checkout files stay writable by both sides.
func TestProvisioningDocker(t *testing.T) {
	image := os.Getenv("FLORA_PROVISIONING_TEST_IMAGE")
	if image == "" {
		t.Skip("set FLORA_PROVISIONING_TEST_IMAGE to a locally built agent image")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
	defer cancel()
	engine, err := docker.New("")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = engine.Close() })
	if err := engine.Ping(ctx); err != nil {
		t.Skipf("docker daemon unavailable: %v", err)
	}
	img, err := engine.ImageInspect(ctx, image)
	if err != nil {
		t.Fatalf("test image must be built locally first: %v", err)
	}
	var containers []string
	t.Cleanup(func() {
		cleanupCtx, stop := context.WithTimeout(context.Background(), 30*time.Second)
		defer stop()
		for _, id := range containers {
			_ = engine.ContainerRemove(cleanupCtx, id, true)
		}
	})

	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "data"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	// The checkout callback stands in for the chat lifecycle's repository
	// download: it writes real files into the workspace before the first
	// container start.
	checkout := func(_ context.Context, workspaceDir string, _ []storage.Repository) error {
		return os.WriteFile(filepath.Join(workspaceDir, "checked-out.txt"), []byte("checkout\n"), 0644)
	}
	cfg := Config{ImageRef: image, ImageDigest: testDigest, ImageID: img.ID, HarnessVersion: "1.2.27", MaxRunning: 2}
	m, err := New(observedEngine{Engine: engine, t: t}, store, cfg, checkout)
	if err != nil {
		t.Fatal(err)
	}
	// Use the real health check, not the unit-test stub.
	m.health = healthy

	newChatWithSetup := func(title, setup string) storage.Chat {
		t.Helper()
		project, err := store.CreateProject(ctx, title, storage.Configuration{
			Repositories: []storage.Repository{{Name: "core", URL: "https://github.com/example/core", BaseBranch: "main", Role: "core"}},
			SetupCommand: setup,
		})
		if err != nil {
			t.Fatal(err)
		}
		chat, err := store.CreateChat(ctx, project.ID, title, testDigest, "1.2.27")
		if err != nil {
			t.Fatal(err)
		}
		return chat
	}
	get := func(endpoint Endpoint, auth bool) (int, string) {
		t.Helper()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.URL+"/global/health", nil)
		if err != nil {
			t.Fatal(err)
		}
		if auth {
			req.SetBasicAuth(endpoint.Username, endpoint.Password)
		}
		client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return resp.StatusCode, string(raw)
	}
	setupRuns := func(chatID string) string {
		t.Helper()
		paths, err := store.Paths(ctx, chatID)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(filepath.Join(paths.RuntimeState, "setup", "runs"))
		if err != nil {
			t.Fatal(err)
		}
		return strings.TrimSpace(string(raw))
	}

	t.Run("lifecycle isolation and limits", func(t *testing.T) {
		setup := "printf 'agent-edit\\n' >> /workspace/checked-out.txt && id -u > /home/flora/setup/agent-uid && sudo -n apk add --no-cache jq && git init /workspace && printf 'setup\\n' >> /home/flora/setup/runs && printf marker > /workspace/marker.txt"
		chat := newChatWithSetup("lifecycle", setup)
		endpoint, err := m.Start(ctx, chat.ID)
		if err != nil {
			t.Fatal(err)
		}
		containers = append(containers, endpoint.ContainerID)
		t.Logf("container %s ready at %s", endpoint.ContainerID, endpoint.URL)

		code, body := get(endpoint, false)
		if code != http.StatusUnauthorized {
			t.Fatalf("unauthenticated health: %d %s", code, body)
		}
		code, body = get(endpoint, true)
		if code != http.StatusOK || !strings.Contains(body, `"healthy":true`) || !strings.Contains(body, `"version":"1.2.27"`) {
			t.Fatalf("authenticated health: %d %s", code, body)
		}

		info, err := engine.ContainerInspect(ctx, endpoint.ContainerID)
		if err != nil {
			t.Fatal(err)
		}
		if info.HostConfig.Privileged {
			t.Fatal("container must not be privileged")
		}
		if info.HostConfig.NanoCPUs != 2e9 || info.HostConfig.Memory != 8<<30 || info.HostConfig.PidsLimit != 512 {
			t.Fatalf("docker-enforced limits: cpus=%d memory=%d pids=%d", info.HostConfig.NanoCPUs, info.HostConfig.Memory, info.HostConfig.PidsLimit)
		}
		paths, err := store.Paths(ctx, chat.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(info.HostConfig.Binds) != 2 {
			t.Fatalf("binds: %v", info.HostConfig.Binds)
		}
		for _, bind := range info.HostConfig.Binds {
			host, _, _ := strings.Cut(bind, ":")
			if host != paths.Workspace && host != paths.RuntimeState {
				t.Fatalf("unexpected mount %q; only the chat's own directories are allowed", bind)
			}
		}
		if setupRuns(chat.ID) != "setup" {
			t.Fatal("setup must have run once before the runtime started")
		}
		if raw, err := os.ReadFile(filepath.Join(paths.Workspace, "marker.txt")); err != nil || string(raw) != "marker" {
			t.Fatalf("setup workspace output missing: %v %q", err, raw)
		}

		// The agent runs as the backend's uid: it edited the checkout's file,
		// and everything it wrote stays owned by the service account.
		raw, err := os.ReadFile(filepath.Join(paths.Workspace, "checked-out.txt"))
		if err != nil || string(raw) != "checkout\nagent-edit\n" {
			t.Fatalf("agent must edit checkout files in place: %v %q", err, raw)
		}
		agentUID, err := os.ReadFile(filepath.Join(paths.RuntimeState, "setup", "agent-uid"))
		if err != nil {
			t.Fatal(err)
		}
		if strings.TrimSpace(string(agentUID)) != strconv.Itoa(os.Getuid()) {
			t.Fatalf("agent uid %q must equal the backend uid %d", agentUID, os.Getuid())
		}

		// Stop/start the same container: setup runs once per container.
		if err := m.Stop(ctx, chat.ID); err != nil {
			t.Fatal(err)
		}
		endpoint2, err := m.Start(ctx, chat.ID)
		if err != nil {
			t.Fatal(err)
		}
		if endpoint2.ContainerID != endpoint.ContainerID || endpoint2.Password != endpoint.Password {
			t.Fatalf("restart must reuse the container and endpoint: %+v", endpoint2)
		}
		if setupRuns(chat.ID) != "setup" {
			t.Fatal("setup must not rerun on stop/start of the same container")
		}
	})

	t.Run("orphan adoption", func(t *testing.T) {
		// A container created but never bound (process death in the window)
		// is adopted by name after ownership validation on the next start.
		chat := newChatWithSetup("adoption", "git init /workspace")
		paths, err := store.Paths(ctx, chat.ID)
		if err != nil {
			t.Fatal(err)
		}
		orphanID, err := engine.ContainerCreate(ctx, docker.ContainerSpec{
			Name:  containerName(chat.ID),
			Image: image,
			Env: []string{
				"OPENCODE_SERVER_PASSWORD=orphan-secret",
				"FLORA_UID=" + strconv.Itoa(os.Getuid()),
				"FLORA_GID=" + strconv.Itoa(os.Getgid()),
				"SETUP_TIMEOUT_SECONDS=600",
			},
			Labels: map[string]string{labelManaged: "true", labelChatID: chat.ID},
			Binds: []string{
				paths.Workspace + ":/workspace",
				paths.RuntimeState + ":/home/flora",
			},
			LoopbackPort: 4096,
		})
		if err != nil {
			t.Fatal(err)
		}
		containers = append(containers, orphanID)
		endpoint, err := m.Start(ctx, chat.ID)
		if err != nil {
			t.Fatal(err)
		}
		if endpoint.ContainerID != orphanID || endpoint.Password != "orphan-secret" {
			t.Fatalf("must adopt the orphan, not replace it: %+v", endpoint)
		}
		if code, _ := get(endpoint, true); code != http.StatusOK {
			t.Fatal("adopted container must become ready")
		}
		if err := m.Stop(ctx, chat.ID); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("setup failure timeout and explicit retry", func(t *testing.T) {
		setup := "printf 'setup attempt running\\n'; printf 'attempt\\n' >> /home/flora/setup/attempts; if [ ! -f /home/flora/setup/retry ]; then touch /home/flora/setup/retry; exit 23; fi"
		chat := newChatWithSetup("setup-failure", setup)
		_, err := m.Start(ctx, chat.ID)
		saved, serr := store.Chat(ctx, chat.ID)
		if serr == nil && saved.ContainerID != "" {
			containers = append(containers, saved.ContainerID)
		}
		var setupErr *SetupError
		if !errors.As(err, &setupErr) {
			t.Fatalf("want setup failure, got %v", err)
		}
		if setupErr.ExitCode != 23 || !strings.Contains(setupErr.OutputTail, "setup attempt") {
			t.Fatalf("setup error must carry exit status and output: %+v", setupErr)
		}
		// Explicit retry: the same failed setup now succeeds.
		endpoint, err := m.Start(ctx, chat.ID)
		if err != nil {
			t.Fatalf("explicit retry must succeed: %v", err)
		}
		if code, _ := get(endpoint, true); code != http.StatusOK {
			t.Fatal("runtime must become ready after retried setup")
		}
		// Free the slot for the capacity subtest.
		if err := m.Stop(ctx, chat.ID); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("setup timeout", func(t *testing.T) {
		short, err := New(engine, store, Config{ImageRef: image, ImageDigest: testDigest, ImageID: img.ID, HarnessVersion: "1.2.27", SetupTimeout: 3 * time.Second}, nil)
		if err != nil {
			t.Fatal(err)
		}
		short.health = healthy
		chat := newChatWithSetup("setup-timeout", "printf 'attempt\\n' >> /home/flora/setup/attempts; sleep 30")
		_, err = short.Start(ctx, chat.ID)
		saved, serr := store.Chat(ctx, chat.ID)
		if serr == nil && saved.ContainerID != "" {
			containers = append(containers, saved.ContainerID)
		}
		var setupErr *SetupError
		if !errors.As(err, &setupErr) || setupErr.ExitCode != 124 {
			t.Fatalf("want timeout exit 124, got %+v (%v)", setupErr, err)
		}
		// A retry runs setup again and times out again; both attempts persist.
		if _, err := short.Start(ctx, chat.ID); !errors.As(err, &setupErr) {
			t.Fatalf("retry must attempt setup again: %v", err)
		}
		paths, err := store.Paths(ctx, chat.ID)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(filepath.Join(paths.RuntimeState, "setup", "attempts"))
		if err != nil || strings.Count(string(raw), "attempt") != 2 {
			t.Fatalf("both attempts must persist: %v %q", err, raw)
		}
	})

	t.Run("setup ignoring SIGTERM is killed", func(t *testing.T) {
		bounded, err := New(engine, store, Config{ImageRef: image, ImageDigest: testDigest, ImageID: img.ID, HarnessVersion: "1.2.27", SetupTimeout: 2 * time.Second, SetupKillGrace: time.Second}, nil)
		if err != nil {
			t.Fatal(err)
		}
		bounded.health = healthy
		chat := newChatWithSetup("setup-stubborn", `trap '' TERM; printf 'attempt\n' >> /home/flora/setup/attempts; while true; do sleep 1; done`)
		start := time.Now()
		_, err = bounded.Start(ctx, chat.ID)
		saved, serr := store.Chat(ctx, chat.ID)
		if serr == nil && saved.ContainerID != "" {
			containers = append(containers, saved.ContainerID)
		}
		var setupErr *SetupError
		if !errors.As(err, &setupErr) {
			t.Fatalf("want setup failure, got %v", err)
		}
		// 124 is the plain timeout; 137 means the kill grace had to SIGKILL.
		if setupErr.ExitCode != 124 && setupErr.ExitCode != 137 {
			t.Fatalf("want timeout/kill exit, got %+v", setupErr)
		}
		if elapsed := time.Since(start); elapsed > 30*time.Second {
			t.Fatalf("a SIGTERM-ignoring setup must be killed in bounded time, took %s", elapsed)
		}
	})

	t.Run("capacity rejects excess starts", func(t *testing.T) {
		first := newChatWithSetup("capacity-1", "")
		second := newChatWithSetup("capacity-2", "")
		endpoint, err := m.Start(ctx, first.ID)
		if err != nil {
			t.Fatal(err)
		}
		containers = append(containers, endpoint.ContainerID)
		// The lifecycle chat is still running, so the limit of 2 is full.
		if _, err := m.Start(ctx, second.ID); err == nil || !strings.Contains(err.Error(), "capacity") {
			t.Fatalf("over-limit start must be rejected with an explanation: %v", err)
		}
		if err := m.Stop(ctx, first.ID); err != nil {
			t.Fatal(err)
		}
		endpoint2, err := m.Start(ctx, second.ID)
		if err != nil {
			t.Fatalf("start after freeing capacity: %v", err)
		}
		containers = append(containers, endpoint2.ContainerID)
		// Each chat gets its own endpoint password.
		if endpoint2.Password == endpoint.Password {
			t.Fatal("endpoint passwords must be per-container")
		}
	})
}
