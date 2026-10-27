package provisioning

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

const testDigest = "flora/agent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

type fakeContainer struct {
	running     bool
	exitCode    int
	exitOnStart bool
	env         []string
	port        string
}

type fakeEngine struct {
	images     map[string]bool
	containers map[string]*fakeContainer
	runningIDs []string
	created    []docker.ContainerSpec
	pulled     []string
	stopped    []string
	nextID     int
	failCreate error
}

func newFakeEngine() *fakeEngine {
	return &fakeEngine{
		images:     map[string]bool{testDigest: true},
		containers: map[string]*fakeContainer{},
	}
}

func (f *fakeEngine) ImageInspect(_ context.Context, ref string) (docker.Image, error) {
	if f.images[ref] {
		return docker.Image{ID: "sha256:img"}, nil
	}
	return docker.Image{}, &docker.Error{StatusCode: 404, Message: "no such image"}
}

func (f *fakeEngine) ImagePull(_ context.Context, ref string) error {
	f.pulled = append(f.pulled, ref)
	f.images[ref] = true
	return nil
}

func (f *fakeEngine) ContainerCreate(_ context.Context, spec docker.ContainerSpec) (string, error) {
	if f.failCreate != nil {
		return "", f.failCreate
	}
	f.nextID++
	id := "container-" + string(rune('0'+f.nextID))
	f.created = append(f.created, spec)
	f.containers[id] = &fakeContainer{env: spec.Env, port: "49152"}
	return id, nil
}

func (f *fakeEngine) ContainerStart(_ context.Context, id string) error {
	c := f.containers[id]
	if c.exitOnStart {
		c.running = false
		c.exitCode = 23
		return nil
	}
	c.running = true
	return nil
}

func (f *fakeEngine) ContainerStop(_ context.Context, id string, _ int) error {
	f.stopped = append(f.stopped, id)
	if c, ok := f.containers[id]; ok {
		c.running = false
	}
	return nil
}

func (f *fakeEngine) ContainerInspect(_ context.Context, id string) (docker.ContainerInfo, error) {
	c, ok := f.containers[id]
	if !ok {
		return docker.ContainerInfo{}, &docker.Error{StatusCode: 404, Message: "no such container"}
	}
	var info docker.ContainerInfo
	info.ID = id
	info.State.Running = c.running
	info.State.ExitCode = c.exitCode
	if c.running {
		info.State.Status = "running"
	} else {
		info.State.Status = "exited"
	}
	info.Config.Env = c.env
	if c.port != "" {
		info.NetworkSettings.Ports = map[string][]struct {
			HostIP   string `json:"HostIp"`
			HostPort string `json:"HostPort"`
		}{"4096/tcp": {{HostIP: "127.0.0.1", HostPort: c.port}}}
	}
	return info, nil
}

func (f *fakeEngine) ContainerList(_ context.Context, running bool, labels map[string]string) ([]docker.ContainerSummary, error) {
	if labels[labelManaged] != "true" {
		return nil, errors.New("capacity listing must filter to managed containers")
	}
	var list []docker.ContainerSummary
	for _, id := range f.runningIDs {
		list = append(list, docker.ContainerSummary{ID: id, State: "running"})
	}
	return list, nil
}

func newTestManager(t *testing.T, engine *fakeEngine, cfg Config, checkout CheckoutFunc) (*Manager, *storage.Store) {
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
	if _, err := New(newFakeEngine(), store, Config{ImageRef: "flora/agent:latest", HarnessVersion: "1.2.27"}, nil); err == nil {
		t.Fatal("unpinned image identity must fail")
	}
	m, err := New(newFakeEngine(), store, Config{ImageRef: testDigest, HarnessVersion: "1.2.27"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if m.cfg.MaxRunning != 10 || m.cfg.SetupTimeout != 10*time.Minute || m.cfg.ActivityTimeout != time.Hour {
		t.Fatalf("PRD defaults not applied: %+v", m.cfg)
	}
	if m.cfg.NanoCPUs != 2e9 || m.cfg.MemoryBytes != 8<<30 || m.cfg.PidsLimit != 512 {
		t.Fatalf("PRD resource defaults not applied: %+v", m.cfg)
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
	checkout := func(_ context.Context, dir string, repos []storage.Repository) error {
		workspace = dir
		checkedOut = repos
		return nil
	}
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
	for _, want := range []string{"OPENCODE_SERVER_PASSWORD=", "ANTHROPIC_API_KEY=test-key", "SETUP_COMMAND=git init /workspace", "SETUP_TIMEOUT_SECONDS=600"} {
		if !strings.Contains(env, want) {
			t.Fatalf("env missing %q in %q", want, env)
		}
	}
	// Checkout ran before creation and received only the core repository.
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
	// A second start reuses the container and skips checkout.
	if _, err := m.Start(context.Background(), chat.ID); err != nil {
		t.Fatal(err)
	}
	if len(engine.created) != 1 || len(checkedOut) != 1 {
		t.Fatalf("restart must not recreate or re-checkout: %d %d", len(engine.created), len(checkedOut))
	}
}

func TestStartPullsMissingImage(t *testing.T) {
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
}

func TestCapacityCountsIdleRunningContainers(t *testing.T) {
	engine := newFakeEngine()
	m, store := newTestManager(t, engine, Config{MaxRunning: 2}, nil)
	engine.runningIDs = []string{"other-1", "other-2"}
	chat := newChat(t, store)
	_, err := m.Start(context.Background(), chat.ID)
	var capacity *CapacityError
	if !errors.As(err, &capacity) {
		t.Fatalf("want capacity error, got %v", err)
	}
	if capacity.Limit != 2 || capacity.Running != 2 || !strings.Contains(capacity.Error(), "stop a chat") {
		t.Fatalf("explanation: %v", capacity)
	}
	if len(engine.created) != 0 {
		t.Fatal("no container may be created over the limit")
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
	engine.runningIDs = []string{"other-chat"}
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
	engine.containers[endpoint.ContainerID].exitOnStart = true
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
	engine.containers[endpoint.ContainerID].exitOnStart = false
	if _, err := m.Start(context.Background(), chat.ID); err != nil {
		t.Fatalf("explicit retry must succeed: %v", err)
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

func TestEndpointRecovery(t *testing.T) {
	engine := newFakeEngine()
	m, store := newTestManager(t, engine, Config{}, nil)
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
	if err := m.Stop(context.Background(), chat.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Endpoint(context.Background(), chat.ID); err == nil {
		t.Fatal("stopped container has no endpoint")
	}
}
