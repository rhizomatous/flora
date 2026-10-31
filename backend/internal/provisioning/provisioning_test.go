package provisioning

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/containerd/errdefs"
	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestSetupErrorTailMasksPartialSecretsAfterShrinkageAndTrim(t *testing.T) {
	secret := "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabc"
	shrinkSecret := "another-credential-" + strings.Repeat("Q", 81)
	engine := newFakeEngine()
	manager, store := newTestManager(t, engine, Config{ProviderAPIKey: secret}, nil)
	chat := newChat(t, store)
	ctx := context.Background()
	if err := store.SaveCredentials(ctx, storage.Credentials{Provider: "anthropic", Model: "model", ProviderKey: shrinkSecret, GitHubToken: "github_pat_test_fixture"}); err != nil {
		t.Fatal(err)
	}
	paths, err := store.Paths(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(paths.RuntimeState, "setup"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(paths.RuntimeState, "setup", "exit-status"), []byte("1"), 0600); err != nil {
		t.Fatal(err)
	}
	repeats := strings.Repeat(shrinkSecret, 300)
	padding := strings.Repeat("z", (32<<10)-20-len(repeats)-20)
	input := strings.Repeat("x", 64<<10) + secret + repeats + padding + secret[:20]
	if len(input)-(32<<10) != (64<<10)+19 {
		t.Fatal("fixture does not cut the credential at the raw window boundary")
	}
	for _, test := range []struct{ input, want string }{
		{input, "[redacted]" + strings.Repeat("[redacted]", 300) + padding + "[redacted]"},
		{strings.Repeat("x", 64<<10) + secret[19:] + strings.Repeat("z", setupTailMax-20), "[redacted]" + strings.Repeat("z", setupTailMax-20)},
	} {
		if err := os.WriteFile(filepath.Join(paths.RuntimeState, "setup", "output.log"), []byte(test.input), 0600); err != nil {
			t.Fatal(err)
		}
		var info docker.ContainerInfo
		info.State.ExitCode = 1
		var setupErr *SetupError
		if err := manager.containerExited(ctx, chat.ID, paths, info); !errors.As(err, &setupErr) {
			t.Fatal("expected setup error")
		}
		if setupErr.OutputTail != test.want || len(setupErr.OutputTail) > setupTailMax {
			t.Fatal("setup error exposed a credential boundary fragment")
		}
	}
}

func TestInstalledProviderEnvironmentAndEndpointRecovery(t *testing.T) {
	for provider, key := range map[string]string{"anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY", "google": "GOOGLE_GENERATIVE_AI_API_KEY"} {
		t.Run(provider, func(t *testing.T) {
			engine := newFakeEngine()
			manager, store := newTestManager(t, engine, Config{ProviderAPIKey: "old-test-key"}, nil)
			chat := newChat(t, store)
			ctx := context.Background()
			if err := store.SaveCredentials(ctx, storage.Credentials{Provider: provider, Model: "installed-model", ProviderKey: "installed-test-secret", GitHubToken: "github_pat_host-only"}); err != nil {
				t.Fatal(err)
			}
			endpoint, err := manager.Start(ctx, chat.ID)
			if err != nil {
				t.Fatal(err)
			}
			info, err := engine.ContainerInspect(ctx, endpoint.ContainerID)
			if err != nil {
				t.Fatal(err)
			}
			if info.EnvValue(key) != "installed-test-secret" {
				t.Fatal("provider key not installed")
			}
			for _, value := range info.Config.Env {
				if strings.Contains(value, "host-only") || strings.Contains(value, "old-test-key") {
					t.Fatal("wrong credential entered container")
				}
			}
			var config struct {
				Model      string   `json:"model"`
				SmallModel string   `json:"small_model"`
				Enabled    []string `json:"enabled_providers"`
			}
			if json.Unmarshal([]byte(info.EnvValue("OPENCODE_CONFIG_CONTENT")), &config) != nil || config.Model != provider+"/installed-model" || config.SmallModel != config.Model || len(config.Enabled) != 1 || config.Enabled[0] != provider {
				t.Fatal("installation model config missing")
			}
			recovered, err := manager.Endpoint(ctx, chat.ID)
			if err != nil || recovered != endpoint || len(engine.created) != 1 {
				t.Fatal("endpoint recovery changed runtime")
			}
		})
	}
}

const (
	testDigest  = "flora/agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	testImageID = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

func TestPausedActivityDoesNotStopContainer(t *testing.T) {
	engine := newFakeEngine()
	manager, store := newTestManager(t, engine, Config{ActivityTimeout: time.Hour}, nil)
	chat := newChat(t, store)
	ctx := context.Background()
	endpoint, err := manager.Start(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	manager.now = func() time.Time { return now }
	manager.BeginActivity(endpoint.ContainerID)
	now = now.Add(30 * time.Minute)
	manager.EndActivity(endpoint.ContainerID)
	now = now.Add(3 * time.Hour)
	stopped, err := manager.SweepActivity(ctx)
	if err != nil || len(stopped) != 0 || len(engine.stopped) != 0 {
		t.Fatal("paused user question stopped its container")
	}
	manager.BeginActivity(endpoint.ContainerID)
	now = now.Add(59 * time.Minute)
	stopped, err = manager.SweepActivity(ctx)
	if err != nil || len(stopped) != 0 {
		t.Fatal("resumed clock did not start fresh")
	}
	now = now.Add(2 * time.Minute)
	stopped, err = manager.SweepActivity(ctx)
	if err != nil || len(stopped) != 1 {
		t.Fatal("resumed execution never timed out")
	}
}

type fakeContainer struct {
	id, name, imageID string
	labels            map[string]string
	binds             []string
	env               []string
	running           bool
	exitCode          int
	// startExitCode makes the next start leave the container exited with
	// this code, simulating a setup failure or an external stop.
	startExitCode int
	port          string
}

// fakeEngine is a thread-safe in-memory Engine. ContainerList derives the
// running set from actual container state so capacity accounting is honest.
type fakeEngine struct {
	mu         sync.Mutex
	imageID    string
	images     map[string]bool
	containers map[string]*fakeContainer
	pulled     []string
	created    []docker.ContainerSpec
	stopped    []string
	nextID     int
}

func newFakeEngine() *fakeEngine {
	return &fakeEngine{
		imageID:    testImageID,
		images:     map[string]bool{testDigest: true},
		containers: map[string]*fakeContainer{},
	}
}

func (f *fakeEngine) ImageInspect(_ context.Context, ref string) (docker.Image, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.images[ref] {
		return docker.Image{ID: f.imageID}, nil
	}
	return docker.Image{}, fmt.Errorf("no such image: %w", errdefs.ErrNotFound)
}

func (f *fakeEngine) ImagePull(_ context.Context, ref string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.pulled = append(f.pulled, ref)
	f.images[ref] = true
	return nil
}

func (f *fakeEngine) ContainerCreate(_ context.Context, spec docker.ContainerSpec) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.containers {
		if c.name == spec.Name {
			return "", fmt.Errorf("name in use: %w", errdefs.ErrConflict)
		}
	}
	f.nextID++
	id := fmt.Sprintf("container-%d", f.nextID)
	f.created = append(f.created, spec)
	f.containers[id] = &fakeContainer{
		id: id, name: spec.Name, imageID: f.imageID, labels: spec.Labels,
		binds: spec.Binds, env: spec.Env, port: "49152",
	}
	return id, nil
}

func (f *fakeEngine) lookup(idOrName string) (*fakeContainer, error) {
	if c, ok := f.containers[idOrName]; ok {
		return c, nil
	}
	for _, c := range f.containers {
		if c.name == idOrName {
			return c, nil
		}
	}
	return nil, fmt.Errorf("no such container: %w", errdefs.ErrNotFound)
}

func (f *fakeEngine) ContainerStart(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, err := f.lookup(id)
	if err != nil {
		return err
	}
	if c.startExitCode != 0 {
		c.running = false
		c.exitCode = c.startExitCode
		return nil
	}
	c.running = true
	c.exitCode = 0
	return nil
}

func (f *fakeEngine) ContainerStop(_ context.Context, id string, _ int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.stopped = append(f.stopped, id)
	if c, err := f.lookup(id); err == nil {
		c.running = false
	}
	return nil
}

func (f *fakeEngine) ContainerInspect(_ context.Context, idOrName string) (docker.ContainerInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, err := f.lookup(idOrName)
	if err != nil {
		return docker.ContainerInfo{}, err
	}
	var info docker.ContainerInfo
	info.ID = c.id
	info.Name = "/" + c.name
	info.Image = c.imageID
	info.State.Running = c.running
	info.State.ExitCode = c.exitCode
	if c.running {
		info.State.Status = "running"
	} else {
		info.State.Status = "exited"
	}
	info.Config.Env = c.env
	info.Config.Labels = c.labels
	info.HostConfig.Binds = c.binds
	if c.port != "" {
		info.NetworkSettings.Ports = map[string][]docker.PortBinding{"4096/tcp": {{HostIP: "127.0.0.1", HostPort: c.port}}}
	}
	return info, nil
}

func (f *fakeEngine) ContainerList(_ context.Context, running bool, labels map[string]string) ([]docker.ContainerSummary, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if labels[labelManaged] != "true" {
		return nil, errors.New("capacity listing must filter to managed containers")
	}
	var list []docker.ContainerSummary
	for _, c := range f.containers {
		if c.labels[labelManaged] != "true" {
			continue
		}
		if running && !c.running {
			continue
		}
		list = append(list, docker.ContainerSummary{ID: c.id, State: "running", Labels: c.labels})
	}
	return list, nil
}

type checkoutFunc func(context.Context, storage.Chat, storage.Paths, string) error

func (f checkoutFunc) Checkout(ctx context.Context, chat storage.Chat, paths storage.Paths, id string) error {
	return f(ctx, chat, paths, id)
}
func (f checkoutFunc) Revoke(context.Context, string) error { return nil }

type observedAccess struct {
	checkoutFunc
	revoked int
}

func (a *observedAccess) Revoke(context.Context, string) error { a.revoked++; return nil }

func TestFailedCheckoutStopsBeforeReadinessAndRetries(t *testing.T) {
	engine := newFakeEngine()
	m, store := newTestManager(t, engine, Config{}, nil)
	chat := newChat(t, store)
	fail := true
	checks := 0
	a := &observedAccess{checkoutFunc: func(ctx context.Context, chat storage.Chat, paths storage.Paths, id string) error {
		info, err := engine.ContainerInspect(ctx, id)
		if err != nil || !info.State.Running {
			t.Fatal("checkout must run inside the started container")
		}
		if fail {
			return errors.New("repository checkout failed")
		}
		return nil
	}}
	m.access = a
	m.health = func(context.Context, string, string) bool { checks++; return true }
	if _, err := m.Start(context.Background(), chat.ID); err == nil {
		t.Fatal("checkout failure allowed startup")
	}
	if checks != 0 || a.revoked != 1 {
		t.Fatal("checkout failure reached readiness or retained credentials")
	}
	saved, err := store.Chat(context.Background(), chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	info, err := engine.ContainerInspect(context.Background(), saved.ContainerID)
	if err != nil || info.State.Running {
		t.Fatal("failed checkout left container running")
	}
	fail = false
	if _, err := m.Start(context.Background(), chat.ID); err != nil {
		t.Fatal(err)
	}
	if len(engine.created) != 1 || checks != 1 {
		t.Fatal("retry created a new container")
	}
	if err := m.Stop(context.Background(), chat.ID); err != nil {
		t.Fatal(err)
	}
	if a.revoked != 2 {
		t.Fatal("stop did not revoke")
	}
}

func newTestManager(t *testing.T, engine *fakeEngine, cfg Config, checkout WorkspaceAccess) (*Manager, *storage.Store) {
	t.Helper()
	store, err := storage.Open(context.Background(), filepath.Join(t.TempDir(), "data"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	if cfg.ImageRef == "" {
		cfg.ImageRef = testDigest
	}
	if cfg.HarnessVersion == "" {
		cfg.HarnessVersion = "1.2.27"
	}
	m, err := New(engine, store, cfg, checkout)
	if err != nil {
		t.Fatal(err)
	}
	m.health = func(context.Context, string, string) bool { return true }
	return m, store
}

func newChat(t *testing.T, store *storage.Store) storage.Chat {
	t.Helper()
	project, err := store.CreateProject(context.Background(), "demo", storage.Configuration{
		Repositories: []storage.Repository{
			{Name: "core", URL: "https://github.com/example/core", BaseBranch: "main", Role: "core"},
			{Name: "extra", URL: "https://github.com/example/extra", BaseBranch: "main", Role: "extra"},
		},
		SetupCommand: "git init /workspace",
	})
	if err != nil {
		t.Fatal(err)
	}
	chat, err := store.CreateChat(context.Background(), project.ID, "demo chat", testDigest, "1.2.27")
	if err != nil {
		t.Fatal(err)
	}
	return chat
}

func TestConfigDefaultsAndValidation(t *testing.T) {
	if _, err := New(newFakeEngine(), nil, Config{}, nil); err == nil {
		t.Fatal("missing store must fail")
	}
	store, err := storage.Open(context.Background(), filepath.Join(t.TempDir(), "data"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for name, cfg := range map[string]Config{
		"unpinned identity":        {ImageRef: "flora/agent:latest", ImageDigest: "flora/agent:latest", HarnessVersion: "1.2.27"},
		"digest without reference": {ImageRef: "flora/agent:latest", ImageDigest: testDigest, HarnessVersion: "1.2.27"},
		"tag without image ID":     {ImageRef: "flora/agent:dev", HarnessVersion: "1.2.27"},
		"tag with bad image ID":    {ImageRef: "flora/agent:dev", ImageID: "not-a-sha", HarnessVersion: "1.2.27"},
		"identity mismatch":        {ImageRef: testDigest, ImageDigest: "flora/agent@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", HarnessVersion: "1.2.27"},
	} {
		if _, err := New(newFakeEngine(), store, cfg, nil); err == nil {
			t.Errorf("%s: config must be rejected", name)
		}
	}
	m, err := New(newFakeEngine(), store, Config{ImageRef: testDigest, HarnessVersion: "1.2.27"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if m.cfg.MaxRunning != 10 || m.cfg.SetupTimeout != 10*time.Minute || m.cfg.ActivityTimeout != time.Hour {
		t.Fatalf("lifecycle defaults not applied: %+v", m.cfg)
	}
	if m.cfg.ReadyTimeout != 11*time.Minute {
		t.Fatalf("readiness bound must default to setup timeout plus margin: %s", m.cfg.ReadyTimeout)
	}
	if m.cfg.NanoCPUs != 2e9 || m.cfg.MemoryBytes != 8<<30 || m.cfg.PidsLimit != 512 {
		t.Fatalf("resource defaults not applied: %+v", m.cfg)
	}
	digest, harness := m.Identity()
	if digest != testDigest || harness != "1.2.27" {
		t.Fatalf("identity: %q %q", digest, harness)
	}
}

func TestStartCreatesIsolatedContainer(t *testing.T) {
	engine := newFakeEngine()
	var checkedOut []storage.Repository
	var workspace string
	checkout := checkoutFunc(func(_ context.Context, chat storage.Chat, paths storage.Paths, id string) error {
		workspace = paths.Workspace
		checkedOut = nil
		for _, r := range chat.Configuration.Repositories {
			if r.Role == "core" {
				checkedOut = append(checkedOut, r)
			}
		}
		return nil
	})
	m, store := newTestManager(t, engine, Config{ProviderAPIKey: "test-key"}, checkout)
	chat := newChat(t, store)
	endpoint, err := m.Start(context.Background(), chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(engine.created) != 1 {
		t.Fatalf("expected one created container, got %d", len(engine.created))
	}
	spec := engine.created[0]
	if spec.Name != "flora-chat-"+chat.ID || spec.Image != testDigest {
		t.Fatalf("spec identity: %+v", spec)
	}
	if spec.NanoCPUs != 2e9 || spec.MemoryBytes != 8<<30 || spec.PidsLimit != 512 {
		t.Fatalf("limits: %+v", spec)
	}
	if spec.Labels[labelManaged] != "true" || spec.Labels[labelChatID] != chat.ID {
		t.Fatalf("labels: %+v", spec.Labels)
	}
	if spec.LoopbackPort != 4096 {
		t.Fatalf("loopback port: %+v", spec.LoopbackPort)
	}
	if len(spec.Binds) != 2 {
		t.Fatalf("binds: %v", spec.Binds)
	}
	for _, bind := range spec.Binds {
		host := strings.SplitN(bind, ":", 2)[0]
		if !strings.HasPrefix(host, filepath.Dir(filepath.Dir(workspace))) {
			t.Fatalf("bind outside chat storage: %s", bind)
		}
		if strings.Contains(bind, "docker.sock") {
			t.Fatalf("host socket must never be mounted: %s", bind)
		}
	}
	env := strings.Join(spec.Env, "\n")
	// The mapped identity comes from the storage directory's owner, with a
	// root group (macOS wheel) replaced by a user-private group.
	uid, gid, err := storageOwner(workspace)
	if err != nil {
		t.Fatal(err)
	}
	if gid == 0 {
		gid = uid
	}
	for _, want := range []string{
		"OPENCODE_SERVER_PASSWORD=", "ANTHROPIC_API_KEY=test-key",
		"SETUP_COMMAND=git init /workspace", "SETUP_TIMEOUT_SECONDS=600", "SETUP_KILL_GRACE_SECONDS=30",
		fmt.Sprintf("FLORA_UID=%d", uid), fmt.Sprintf("FLORA_GID=%d", gid),
	} {
		if !strings.Contains(env, want) {
			t.Fatalf("env missing %q in %q", want, env)
		}
	}
	// Checkout prepared this container's workspace before runtime readiness.
	if workspace == "" || len(checkedOut) != 1 || checkedOut[0].Name != "core" {
		t.Fatalf("checkout: %q %+v", workspace, checkedOut)
	}
	// The container identity is recorded once through the storage contract.
	saved, err := store.Chat(context.Background(), chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if saved.ContainerID != endpoint.ContainerID {
		t.Fatalf("container binding: %q vs %q", saved.ContainerID, endpoint.ContainerID)
	}
	if endpoint.URL != "http://127.0.0.1:49152" || endpoint.Username != "opencode" || endpoint.Password == "" {
		t.Fatalf("endpoint: %+v", endpoint)
	}
	// A second start reuses the container and idempotently prepares its access.
	if _, err := m.Start(context.Background(), chat.ID); err != nil {
		t.Fatal(err)
	}
	if len(engine.created) != 1 || len(checkedOut) != 1 {
		t.Fatalf("restart must not recreate or re-checkout: %d %d", len(engine.created), len(checkedOut))
	}
}

func TestStartRejectsRootOwnedStorage(t *testing.T) {
	engine := newFakeEngine()
	m, store := newTestManager(t, engine, Config{}, nil)
	m.ownerOf = func(string) (int, int, error) { return 0, 0, nil }
	chat := newChat(t, store)
	if _, err := m.Start(context.Background(), chat.ID); err == nil || !strings.Contains(err.Error(), "non-root") {
		t.Fatalf("root-owned storage must be rejected: %v", err)
	}
	if len(engine.created) != 0 {
		t.Fatal("no container may be created for root-owned storage")
	}
}

// A root-owned group (like macOS wheel) falls back to a user-private group
// matching the uid; only a root uid is rejected.
func TestRootGroupFallsBackToUserPrivateGroup(t *testing.T) {
	engine := newFakeEngine()
	m, store := newTestManager(t, engine, Config{}, nil)
	m.ownerOf = func(string) (int, int, error) { return 10501, 0, nil }
	chat := newChat(t, store)
	if _, err := m.Start(context.Background(), chat.ID); err != nil {
		t.Fatal(err)
	}
	env := strings.Join(engine.created[0].Env, "\n")
	if !strings.Contains(env, "FLORA_UID=10501") || !strings.Contains(env, "FLORA_GID=10501") {
		t.Fatalf("gid 0 must fall back to the uid: %q", env)
	}
}

func TestStartPullsOnlyPinnedImages(t *testing.T) {
	engine := newFakeEngine()
	delete(engine.images, testDigest)
	m, store := newTestManager(t, engine, Config{}, nil)
	chat := newChat(t, store)
	if _, err := m.Start(context.Background(), chat.ID); err != nil {
		t.Fatal(err)
	}
	if len(engine.pulled) != 1 || engine.pulled[0] != testDigest {
		t.Fatalf("pulls: %v", engine.pulled)
	}

	// A mutable tag is never pulled; it must exist and match the expected ID.
	engine2 := newFakeEngine()
	m2, store2 := newTestManager(t, engine2, Config{ImageRef: "flora/agent:dev", ImageDigest: testDigest, ImageID: testImageID}, nil)
	chat2 := newChat(t, store2)
	if _, err := m2.Start(context.Background(), chat2.ID); err == nil || !strings.Contains(err.Error(), "mutable tag") {
		t.Fatalf("missing local tag must fail without pulling: %v", err)
	}
	if len(engine2.pulled) != 0 {
		t.Fatalf("mutable tag pulled: %v", engine2.pulled)
	}

	// A present tag whose content ID drifts from the expected ID fails.
	engine3 := newFakeEngine()
	engine3.images["flora/agent:dev"] = true
	engine3.imageID = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
	m3, store3 := newTestManager(t, engine3, Config{ImageRef: "flora/agent:dev", ImageDigest: testDigest, ImageID: testImageID}, nil)
	chat3 := newChat(t, store3)
	if _, err := m3.Start(context.Background(), chat3.ID); err == nil || !strings.Contains(err.Error(), "expected") {
		t.Fatalf("image ID drift must fail: %v", err)
	}
}

// A container created but never bound (BindRuntime failure or process death
// in the window) is found by its deterministic name on retry, validated as
// owned by this chat, and adopted. No second container is created.
func TestStartAdoptsOwnedOrphan(t *testing.T) {
	engine := newFakeEngine()
	m, store := newTestManager(t, engine, Config{}, nil)
	chat := newChat(t, store)
	paths, err := store.Paths(context.Background(), chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	orphan := docker.ContainerSpec{
		Name:   containerName(chat.ID),
		Image:  testDigest,
		Env:    []string{"OPENCODE_SERVER_PASSWORD=orphan-secret"},
		Labels: map[string]string{labelManaged: "true", labelChatID: chat.ID},
		Binds:  []string{paths.Workspace + ":/workspace", paths.RuntimeState + ":/home/flora"},
	}
	if _, err := engine.ContainerCreate(context.Background(), orphan); err != nil {
		t.Fatal(err)
	}
	endpoint, err := m.Start(context.Background(), chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(engine.created) != 1 {
		t.Fatalf("the orphan must be adopted, not recreated: %d created", len(engine.created))
	}
	if endpoint.Password != "orphan-secret" {
		t.Fatal("the adopted container keeps its own endpoint password")
	}
	saved, err := store.Chat(context.Background(), chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if saved.ContainerID != endpoint.ContainerID {
		t.Fatal("adoption must bind the existing container")
	}
}

// A container occupying the chat's name without the chat's exact identity is
// never adopted or removed; the start fails with an explanation.
func TestStartRejectsForeignNameCollision(t *testing.T) {
	for name, mutate := range map[string]func(*fakeEngine, string){
		"wrong chat label": func(e *fakeEngine, id string) { e.containers[id].labels[labelChatID] = "other" },
		"wrong image": func(e *fakeEngine, _ string) {
			e.imageID = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
		},
		"extra mount": func(e *fakeEngine, id string) {
			e.containers[id].binds = append(e.containers[id].binds, "/etc:/host-etc")
		},
	} {
		t.Run(name, func(t *testing.T) {
			engine := newFakeEngine()
			m, store := newTestManager(t, engine, Config{}, nil)
			chat := newChat(t, store)
			paths, err := store.Paths(context.Background(), chat.ID)
			if err != nil {
				t.Fatal(err)
			}
			spec := docker.ContainerSpec{
				Name:   containerName(chat.ID),
				Image:  testDigest,
				Labels: map[string]string{labelManaged: "true", labelChatID: chat.ID},
				Binds:  []string{paths.Workspace + ":/workspace", paths.RuntimeState + ":/home/flora"},
			}
			id, err := engine.ContainerCreate(context.Background(), spec)
			if err != nil {
				t.Fatal(err)
			}
			mutate(engine, id)
			if _, err := m.Start(context.Background(), chat.ID); err == nil || !strings.Contains(err.Error(), "refusing to adopt") {
				t.Fatalf("foreign container must be rejected: %v", err)
			}
			if len(engine.created) != 1 {
				t.Fatal("no replacement container may be created")
			}
		})
	}
}

func TestConcurrentStartsCreateOneContainer(t *testing.T) {
	engine := newFakeEngine()
	m, store := newTestManager(t, engine, Config{}, nil)
	chat := newChat(t, store)
	var wg sync.WaitGroup
	errs := make([]error, 4)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = m.Start(context.Background(), chat.ID)
		}(i)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(engine.created) != 1 {
		t.Fatalf("concurrent same-chat starts must create exactly one container: %d", len(engine.created))
	}
}

func TestConcurrentStartsRespectCapacity(t *testing.T) {
	engine := newFakeEngine()
	m, store := newTestManager(t, engine, Config{MaxRunning: 1}, nil)
	first := newChat(t, store)
	second := newChat(t, store)
	var wg sync.WaitGroup
	results := make([]error, 2)
	chats := []string{first.ID, second.ID}
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, results[i] = m.Start(context.Background(), chats[i])
		}(i)
	}
	wg.Wait()
	var capacity *CapacityError
	succeeded, rejected := 0, 0
	for _, err := range results {
		if err == nil {
			succeeded++
		} else if errors.As(err, &capacity) {
			rejected++
		} else {
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if succeeded != 1 || rejected != 1 {
		t.Fatalf("capacity 1 across two chats: %d succeeded, %d rejected", succeeded, rejected)
	}
}

func TestCapacityRejectsRestartOfStoppedContainer(t *testing.T) {
	engine := newFakeEngine()
	m, store := newTestManager(t, engine, Config{MaxRunning: 1}, nil)
	chat := newChat(t, store)
	if _, err := m.Start(context.Background(), chat.ID); err != nil {
		t.Fatal(err)
	}
	if err := m.Stop(context.Background(), chat.ID); err != nil {
		t.Fatal(err)
	}
	other := newChat(t, store)
	if _, err := m.Start(context.Background(), other.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Start(context.Background(), chat.ID); err == nil {
		t.Fatal("restarting into a full limit must be rejected")
	}
}

func TestSetupFailureBlocksStartupAndRetry(t *testing.T) {
	engine := newFakeEngine()
	m, store := newTestManager(t, engine, Config{}, nil)
	chat := newChat(t, store)
	endpoint, err := m.Start(context.Background(), chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	// Make the next start exit during setup.
	engine.mu.Lock()
	engine.containers[endpoint.ContainerID].startExitCode = 23
	engine.mu.Unlock()
	if err := m.Stop(context.Background(), chat.ID); err != nil {
		t.Fatal(err)
	}
	paths, err := store.Paths(context.Background(), chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(paths.RuntimeState, "setup"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(paths.RuntimeState, "setup", "exit-status"), []byte("23\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(paths.RuntimeState, "setup", "output.log"), []byte("dependency install failed\n"), 0600); err != nil {
		t.Fatal(err)
	}
	_, err = m.Start(context.Background(), chat.ID)
	var setupErr *SetupError
	if !errors.As(err, &setupErr) {
		t.Fatalf("want setup error, got %v", err)
	}
	if setupErr.ExitCode != 23 || !strings.Contains(setupErr.OutputTail, "dependency install failed") {
		t.Fatalf("setup error: %+v", setupErr)
	}
	// The failure is persisted as chat activity with output and exit status.
	activities, err := store.Activities(context.Background(), chat.ID, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, a := range activities {
		if a.Kind == "setup" && strings.Contains(string(a.Payload), `"exit_code":23`) {
			found = true
		}
	}
	if !found {
		t.Fatal("setup failure was not recorded as activity")
	}
	// Explicit retry: the entrypoint reran setup and succeeded.
	engine.mu.Lock()
	engine.containers[endpoint.ContainerID].startExitCode = 0
	engine.mu.Unlock()
	if _, err := m.Start(context.Background(), chat.ID); err != nil {
		t.Fatalf("explicit retry must succeed: %v", err)
	}
}

// An externally stopped or killed container without a recorded setup result
// is not a setup failure and persists no setup activity.
func TestStoppedContainerIsNotSetupFailure(t *testing.T) {
	engine := newFakeEngine()
	m, store := newTestManager(t, engine, Config{}, nil)
	chat := newChat(t, store)
	endpoint, err := m.Start(context.Background(), chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	engine.mu.Lock()
	engine.containers[endpoint.ContainerID].running = false
	engine.containers[endpoint.ContainerID].startExitCode = 143
	engine.mu.Unlock()
	_, err = m.Start(context.Background(), chat.ID)
	var stoppedErr *StoppedError
	if !errors.As(err, &stoppedErr) {
		t.Fatalf("want stopped error, got %v", err)
	}
	var setupErr *SetupError
	if errors.As(err, &setupErr) {
		t.Fatal("a stopped container must not be reported as setup failure")
	}
	activities, err := store.Activities(context.Background(), chat.ID, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range activities {
		if a.Kind == "setup" {
			t.Fatal("no setup activity may be recorded for an external stop")
		}
	}
}

// A leftover exit status of 0 from an earlier successful setup must not turn
// a later runtime exit into a bogus setup failure.
func TestStaleSetupSuccessIsNotSetupFailure(t *testing.T) {
	for _, tc := range []struct {
		name     string
		exitCode int
		want     string
	}{
		{"runtime crash", 1, "runtime"},
		{"external stop", 143, "stopped"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			engine := newFakeEngine()
			m, store := newTestManager(t, engine, Config{}, nil)
			chat := newChat(t, store)
			endpoint, err := m.Start(context.Background(), chat.ID)
			if err != nil {
				t.Fatal(err)
			}
			// Record the earlier successful setup, then make the next start's
			// runtime exit immediately.
			paths, err := store.Paths(context.Background(), chat.ID)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(filepath.Join(paths.RuntimeState, "setup"), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(paths.RuntimeState, "setup", "exit-status"), []byte("0\n"), 0600); err != nil {
				t.Fatal(err)
			}
			engine.mu.Lock()
			engine.containers[endpoint.ContainerID].running = false
			engine.containers[endpoint.ContainerID].startExitCode = tc.exitCode
			engine.mu.Unlock()
			_, err = m.Start(context.Background(), chat.ID)
			var setupErr *SetupError
			if errors.As(err, &setupErr) {
				t.Fatalf("stale setup success must not classify as setup failure: %+v", setupErr)
			}
			if tc.want == "runtime" {
				var startErr *RuntimeStartError
				if !errors.As(err, &startErr) || startErr.ExitCode != 1 {
					t.Fatalf("want runtime-start error exit 1, got %v", err)
				}
			} else {
				var stoppedErr *StoppedError
				if !errors.As(err, &stoppedErr) {
					t.Fatalf("want stopped error, got %v", err)
				}
			}
			activities, err := store.Activities(context.Background(), chat.ID, 0, 100)
			if err != nil {
				t.Fatal(err)
			}
			for _, a := range activities {
				if a.Kind == "setup" {
					t.Fatal("no setup activity may be recorded when setup did not fail")
				}
			}
		})
	}
}

func TestReadinessIsBounded(t *testing.T) {
	engine := newFakeEngine()
	m, store := newTestManager(t, engine, Config{ReadyTimeout: 300 * time.Millisecond}, nil)
	m.health = func(context.Context, string, string) bool { return false }
	chat := newChat(t, store)
	start := time.Now()
	_, err := m.Start(context.Background(), chat.ID)
	if err == nil || !strings.Contains(err.Error(), "did not become ready") {
		t.Fatalf("hung endpoint must fail within the readiness bound: %v", err)
	}
	if time.Since(start) > 5*time.Second {
		t.Fatal("readiness bound was not enforced")
	}
}

func TestStopPreservesContainer(t *testing.T) {
	engine := newFakeEngine()
	m, store := newTestManager(t, engine, Config{}, nil)
	chat := newChat(t, store)
	endpoint, err := m.Start(context.Background(), chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	m.BeginActivity(endpoint.ContainerID)
	if err := m.Stop(context.Background(), chat.ID); err != nil {
		t.Fatal(err)
	}
	if len(engine.stopped) != 1 || engine.stopped[0] != endpoint.ContainerID {
		t.Fatalf("stopped: %v", engine.stopped)
	}
	if engine.containers[endpoint.ContainerID].running {
		t.Fatal("container must be stopped")
	}
	saved, _ := store.Chat(context.Background(), chat.ID)
	if saved.ContainerID != endpoint.ContainerID {
		t.Fatal("stop must preserve the container binding and workspace")
	}
}

func TestActivitySweepStopsOverLimitContainers(t *testing.T) {
	engine := newFakeEngine()
	m, store := newTestManager(t, engine, Config{ActivityTimeout: time.Minute}, nil)
	chat := newChat(t, store)
	endpoint, err := m.Start(context.Background(), chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Now()
	m.now = func() time.Time { return base }
	m.BeginActivity(endpoint.ContainerID)
	m.BeginActivity(endpoint.ContainerID)
	stopped, err := m.SweepActivity(context.Background())
	if err != nil || len(stopped) != 0 {
		t.Fatalf("within limit: %v %v", stopped, err)
	}
	m.now = func() time.Time { return base.Add(2 * time.Minute) }
	stopped, err = m.SweepActivity(context.Background())
	if err != nil || len(stopped) != 1 || stopped[0] != endpoint.ContainerID {
		t.Fatalf("over limit: %v %v", stopped, err)
	}
	if engine.containers[endpoint.ContainerID].running {
		t.Fatal("over-limit container must be stopped")
	}
	// A new active period starts fresh after the sweep.
	m.now = func() time.Time { return base.Add(3 * time.Minute) }
	m.BeginActivity(endpoint.ContainerID)
	stopped, err = m.SweepActivity(context.Background())
	if err != nil || len(stopped) != 0 {
		t.Fatalf("new activity period must not be swept: %v %v", stopped, err)
	}
}

func TestRunActivityEnforcementSweepsOnInterval(t *testing.T) {
	engine := newFakeEngine()
	m, store := newTestManager(t, engine, Config{ActivityTimeout: time.Millisecond}, nil)
	chat := newChat(t, store)
	endpoint, err := m.Start(context.Background(), chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	m.BeginActivity(endpoint.ContainerID)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- m.RunActivityEnforcement(ctx, 10*time.Millisecond) }()
	deadline := time.After(5 * time.Second)
	for {
		engine.mu.Lock()
		running := engine.containers[endpoint.ContainerID].running
		engine.mu.Unlock()
		if !running {
			break
		}
		select {
		case <-deadline:
			t.Fatal("enforcement loop did not stop the over-limit container")
		case <-time.After(10 * time.Millisecond):
		}
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestEndpointRecovery(t *testing.T) {
	engine := newFakeEngine()
	preparations := 0
	access := checkoutFunc(func(context.Context, storage.Chat, storage.Paths, string) error {
		preparations++
		return nil
	})
	m, store := newTestManager(t, engine, Config{}, access)
	chat := newChat(t, store)
	endpoint, err := m.Start(context.Background(), chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := m.Endpoint(context.Background(), chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered != endpoint {
		t.Fatalf("recovery must rebuild the endpoint: %+v vs %+v", recovered, endpoint)
	}
	if preparations != 1 {
		t.Fatal("endpoint lookup prepared access again")
	}
	if _, err := m.Start(context.Background(), chat.ID); err != nil {
		t.Fatal(err)
	}
	if preparations != 2 {
		t.Fatal("explicit start did not prepare access again")
	}
	if err := m.Stop(context.Background(), chat.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Endpoint(context.Background(), chat.ID); err == nil {
		t.Fatal("stopped container has no endpoint")
	}
}
