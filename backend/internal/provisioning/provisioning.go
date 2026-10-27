// Package provisioning owns the lifecycle of one isolated agent container per
// chat: capacity-limited creation, setup verification, private authenticated
// endpoints, and continuous-activity enforcement. It talks to Docker only
// through the Engine API and records facts through the storage package. It
// does not submit runtime work, answer questions, or recover interrupted
// turns; chat message wiring is a later layer.
package provisioning

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

// PRD Defaults and Limits.
const (
	DefaultMaxRunning      = 10
	DefaultSetupTimeout    = 10 * time.Minute
	DefaultActivityTimeout = time.Hour
	DefaultNanoCPUs        = 2 * 1e9
	DefaultMemoryBytes     = 8 << 30
	DefaultPidsLimit       = 512

	runtimePort   = 4096
	labelManaged  = "flora.managed"
	labelChatID   = "flora.chat-id"
	stopTimeout   = 10
	setupTailMax  = 8 << 10
	readyPollStep = 250 * time.Millisecond
)

// Config is the narrow installation-level provisioning configuration.
type Config struct {
	// ImageRef is the daemon-side reference used to pull or create containers.
	ImageRef string
	// ImageDigest is the pinned name@sha256:... identity recorded on each
	// chat. When empty it defaults to ImageRef and must then carry a digest.
	ImageDigest string
	// HarnessVersion is the OpenCode version recorded on each chat.
	HarnessVersion string
	// ProviderAPIKey is injected as ANTHROPIC_API_KEY. It may be empty in
	// tests; model calls then fail inside the container until replaced.
	ProviderAPIKey string

	MaxRunning      int
	SetupTimeout    time.Duration
	ActivityTimeout time.Duration
	NanoCPUs        int64
	MemoryBytes     int64
	PidsLimit       int64
}

func (c Config) withDefaults() (Config, error) {
	if c.ImageRef == "" || c.HarnessVersion == "" {
		return c, errors.New("provisioning: image reference and harness version are required")
	}
	if c.ImageDigest == "" {
		c.ImageDigest = c.ImageRef
	}
	name, digest, pinned := strings.Cut(c.ImageDigest, "@sha256:")
	if name == "" || !pinned || len(digest) != 64 {
		return c, fmt.Errorf("provisioning: image identity %q must be a name@sha256 digest reference", c.ImageDigest)
	}
	if c.MaxRunning <= 0 {
		c.MaxRunning = DefaultMaxRunning
	}
	if c.SetupTimeout <= 0 {
		c.SetupTimeout = DefaultSetupTimeout
	}
	if c.ActivityTimeout <= 0 {
		c.ActivityTimeout = DefaultActivityTimeout
	}
	if c.NanoCPUs <= 0 {
		c.NanoCPUs = DefaultNanoCPUs
	}
	if c.MemoryBytes <= 0 {
		c.MemoryBytes = DefaultMemoryBytes
	}
	if c.PidsLimit <= 0 {
		c.PidsLimit = DefaultPidsLimit
	}
	return c, nil
}

// Engine is the subset of the Docker Engine API the manager uses. It exists
// so tests can substitute a fake; *docker.Client implements it.
type Engine interface {
	ImageInspect(ctx context.Context, ref string) (docker.Image, error)
	ImagePull(ctx context.Context, ref string) error
	ContainerCreate(ctx context.Context, spec docker.ContainerSpec) (string, error)
	ContainerStart(ctx context.Context, id string) error
	ContainerStop(ctx context.Context, id string, timeoutSeconds int) error
	ContainerInspect(ctx context.Context, id string) (docker.ContainerInfo, error)
	ContainerList(ctx context.Context, running bool, labels map[string]string) ([]docker.ContainerSummary, error)
}

// CheckoutFunc prepares a chat workspace before its first container start,
// typically by downloading the project's core repositories. Implementations
// must be idempotent against an existing workspace. Issue #8 wires the real
// implementation; a nil callback leaves the workspace empty.
type CheckoutFunc func(ctx context.Context, workspaceDir string, coreRepos []storage.Repository) error

// Endpoint is a chat container's private authenticated runtime address. The
// password is per-container and is recovered from the container's own
// configuration, so a Flora restart does not lose access.
type Endpoint struct {
	URL         string
	Username    string
	Password    string
	ContainerID string
}

// CapacityError rejects a start when the running-container limit is full.
// Idle running containers count; stopping a chat frees capacity.
type CapacityError struct {
	Limit, Running int
}

func (e *CapacityError) Error() string {
	return fmt.Sprintf("container capacity full: %d of %d running; stop a chat to free capacity", e.Running, e.Limit)
}

// SetupError reports that container setup failed or timed out, so the runtime
// was not started. Output and exit status are persisted in the chat's
// runtime-state directory and activity log; starting again retries setup.
type SetupError struct {
	ChatID     string
	ExitCode   int
	OutputTail string
}

func (e *SetupError) Error() string {
	return fmt.Sprintf("setup failed with exit %d; fix the setup command and start the chat again to retry", e.ExitCode)
}

type Manager struct {
	engine   Engine
	store    *storage.Store
	cfg      Config
	checkout CheckoutFunc
	health   func(ctx context.Context, url, password string) bool

	mu          sync.Mutex
	activeSince map[string]time.Time
	now         func() time.Time
}

func New(engine Engine, store *storage.Store, cfg Config, checkout CheckoutFunc) (*Manager, error) {
	if engine == nil || store == nil {
		return nil, errors.New("provisioning: engine and store are required")
	}
	cfg, err := cfg.withDefaults()
	if err != nil {
		return nil, err
	}
	return &Manager{
		engine:      engine,
		store:       store,
		cfg:         cfg,
		checkout:    checkout,
		health:      healthy,
		activeSince: map[string]time.Time{},
		now:         time.Now,
	}, nil
}

// Identity returns the pinned image digest and harness version to record when
// creating a chat.
func (m *Manager) Identity() (imageDigest, harnessVersion string) {
	return m.cfg.ImageDigest, m.cfg.HarnessVersion
}

// Start makes a chat's container running and its runtime endpoint reachable.
// It creates the container on the first start, running the checkout callback
// first, and reuses the recorded container on later starts. A failed or
// timed-out setup blocks startup with a SetupError; calling Start again is
// the explicit retry. Starting beyond the running-container limit fails with
// a CapacityError.
func (m *Manager) Start(ctx context.Context, chatID string) (Endpoint, error) {
	chat, err := m.store.Chat(ctx, chatID)
	if err != nil {
		return Endpoint{}, err
	}
	paths, err := m.store.Paths(ctx, chatID)
	if err != nil {
		return Endpoint{}, err
	}
	containerID := chat.ContainerID
	if containerID == "" {
		if m.checkout != nil {
			var core []storage.Repository
			for _, r := range chat.Configuration.Repositories {
				if r.Role == "core" {
					core = append(core, r)
				}
			}
			if err := m.checkout(ctx, paths.Workspace, core); err != nil {
				return Endpoint{}, fmt.Errorf("checkout: %w", err)
			}
		}
		password, err := docker.NewPassword()
		if err != nil {
			return Endpoint{}, err
		}
		spec := m.containerSpec(chat, paths, password)
		// Hold the lock across the capacity check, creation, and start so
		// concurrent starts cannot overbook the running-container limit.
		m.mu.Lock()
		id, err := m.createWithinCapacity(ctx, spec)
		if err == nil {
			err = m.engine.ContainerStart(ctx, id)
		}
		m.mu.Unlock()
		if err != nil {
			return Endpoint{}, err
		}
		if err := m.store.BindRuntime(ctx, chatID, id, ""); err != nil {
			return Endpoint{}, err
		}
		containerID = id
	} else {
		info, err := m.engine.ContainerInspect(ctx, containerID)
		if err != nil {
			return Endpoint{}, err
		}
		if !info.State.Running {
			m.mu.Lock()
			err = m.checkCapacity(ctx)
			if err == nil {
				err = m.engine.ContainerStart(ctx, containerID)
			}
			m.mu.Unlock()
			if err != nil {
				return Endpoint{}, err
			}
		} else if err := m.engine.ContainerStart(ctx, containerID); err != nil {
			return Endpoint{}, fmt.Errorf("start container: %w", err)
		}
	}
	return m.awaitReady(ctx, chatID, paths, containerID)
}

// createWithinCapacity enforces the running-container limit around creation.
// Idle running containers count toward the limit (PRD 2.6).
func (m *Manager) createWithinCapacity(ctx context.Context, spec docker.ContainerSpec) (string, error) {
	if err := m.checkCapacity(ctx); err != nil {
		return "", err
	}
	if _, err := m.engine.ImageInspect(ctx, m.cfg.ImageRef); err != nil {
		if !docker.IsNotFound(err) {
			return "", fmt.Errorf("inspect agent image: %w", err)
		}
		if err := m.engine.ImagePull(ctx, m.cfg.ImageRef); err != nil {
			return "", fmt.Errorf("pull agent image: %w", err)
		}
	}
	return m.engine.ContainerCreate(ctx, spec)
}

func (m *Manager) checkCapacity(ctx context.Context) error {
	running, err := m.engine.ContainerList(ctx, true, map[string]string{labelManaged: "true"})
	if err != nil {
		return err
	}
	if len(running) >= m.cfg.MaxRunning {
		return &CapacityError{Limit: m.cfg.MaxRunning, Running: len(running)}
	}
	return nil
}

func (m *Manager) containerSpec(chat storage.Chat, paths storage.Paths, password string) docker.ContainerSpec {
	env := []string{"OPENCODE_SERVER_PASSWORD=" + password}
	if m.cfg.ProviderAPIKey != "" {
		env = append(env, "ANTHROPIC_API_KEY="+m.cfg.ProviderAPIKey)
	}
	if chat.Configuration.SetupCommand != "" {
		env = append(env, "SETUP_COMMAND="+chat.Configuration.SetupCommand)
	}
	env = append(env, "SETUP_TIMEOUT_SECONDS="+strconv.Itoa(int(m.cfg.SetupTimeout.Seconds())))
	return docker.ContainerSpec{
		Name:  "flora-chat-" + chat.ID,
		Image: m.cfg.ImageRef,
		Env:   env,
		Labels: map[string]string{
			labelManaged: "true",
			labelChatID:  chat.ID,
		},
		// Only this chat's workspace and runtime state are mounted. The
		// storage root, other chats' directories, host sockets, and host
		// devices stay out of the container.
		Binds: []string{
			paths.Workspace + ":/workspace",
			paths.RuntimeState + ":/home/flora",
		},
		LoopbackPort: runtimePort,
		NanoCPUs:     m.cfg.NanoCPUs,
		MemoryBytes:  m.cfg.MemoryBytes,
		PidsLimit:    m.cfg.PidsLimit,
	}
}

// awaitReady polls until the runtime answers authenticated health checks, the
// container exits (setup failure), or the context ends.
func (m *Manager) awaitReady(ctx context.Context, chatID string, paths storage.Paths, containerID string) (Endpoint, error) {
	for {
		info, err := m.engine.ContainerInspect(ctx, containerID)
		if err != nil {
			return Endpoint{}, err
		}
		if !info.State.Running {
			return Endpoint{}, m.setupFailure(ctx, chatID, paths, info)
		}
		if addr := info.LoopbackAddress(runtimePort); addr != "" {
			password := info.EnvValue("OPENCODE_SERVER_PASSWORD")
			url := "http://" + addr
			if m.health(ctx, url, password) {
				return Endpoint{URL: url, Username: "opencode", Password: password, ContainerID: containerID}, nil
			}
		}
		select {
		case <-ctx.Done():
			return Endpoint{}, ctx.Err()
		case <-time.After(readyPollStep):
		}
	}
}

// setupFailure persists the saved setup output and exit status as activity
// and reports the blocked startup. The entrypoint writes these files to the
// chat's runtime-state mount before exiting.
func (m *Manager) setupFailure(ctx context.Context, chatID string, paths storage.Paths, info docker.ContainerInfo) error {
	dir := filepath.Join(paths.RuntimeState, "setup")
	exitCode := info.State.ExitCode
	if raw, err := os.ReadFile(filepath.Join(dir, "exit-status")); err == nil {
		if parsed, err := strconv.Atoi(strings.TrimSpace(string(raw))); err == nil {
			exitCode = parsed
		}
	}
	var tail string
	if raw, err := os.ReadFile(filepath.Join(dir, "output.log")); err == nil {
		if len(raw) > setupTailMax {
			raw = raw[len(raw)-setupTailMax:]
		}
		tail = string(raw)
	}
	payload, _ := json.Marshal(map[string]any{
		"exit_code":   exitCode,
		"output_tail": tail,
		"log":         "setup/output.log",
	})
	_ = m.store.AppendActivity(ctx, chatID, newEventID(), "setup", payload)
	return &SetupError{ChatID: chatID, ExitCode: exitCode, OutputTail: tail}
}

// Stop stops a chat's container while preserving its workspace, runtime
// state, and recorded identity (PRD 4.5). Stopping a chat with no container
// is a no-op. The container is kept for an explicit later start; it is never
// transparently restarted.
func (m *Manager) Stop(ctx context.Context, chatID string) error {
	chat, err := m.store.Chat(ctx, chatID)
	if err != nil {
		return err
	}
	if chat.ContainerID == "" {
		return nil
	}
	m.EndActivity(chat.ContainerID)
	return m.engine.ContainerStop(ctx, chat.ContainerID, stopTimeout)
}

// Endpoint recovers the private runtime address of a running chat container,
// including after a Flora restart, from the container's own configuration.
func (m *Manager) Endpoint(ctx context.Context, chatID string) (Endpoint, error) {
	chat, err := m.store.Chat(ctx, chatID)
	if err != nil {
		return Endpoint{}, err
	}
	if chat.ContainerID == "" {
		return Endpoint{}, storage.ErrNotFound
	}
	info, err := m.engine.ContainerInspect(ctx, chat.ContainerID)
	if err != nil {
		return Endpoint{}, err
	}
	if !info.State.Running {
		return Endpoint{}, fmt.Errorf("container for chat is %s, not running", info.State.Status)
	}
	addr := info.LoopbackAddress(runtimePort)
	if addr == "" {
		return Endpoint{}, errors.New("container has no loopback runtime endpoint")
	}
	return Endpoint{URL: "http://" + addr, Username: "opencode", Password: info.EnvValue("OPENCODE_SERVER_PASSWORD"), ContainerID: chat.ContainerID}, nil
}

// BeginActivity marks continuous agent activity on a container. Repeated
// calls while active do not extend the window: the continuous-activity limit
// (PRD 4.7) measures from the beginning of the active period.
func (m *Manager) BeginActivity(containerID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.activeSince[containerID]; !ok {
		m.activeSince[containerID] = m.now()
	}
}

// EndActivity clears a container's active period when work finishes.
func (m *Manager) EndActivity(containerID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.activeSince, containerID)
}

// SweepActivity stops containers whose continuous activity exceeds the
// configured limit and returns their IDs. Callers run it periodically.
func (m *Manager) SweepActivity(ctx context.Context) ([]string, error) {
	m.mu.Lock()
	var overdue []string
	for id, since := range m.activeSince {
		if m.now().Sub(since) > m.cfg.ActivityTimeout {
			overdue = append(overdue, id)
		}
	}
	m.mu.Unlock()
	var stopped []string
	for _, id := range overdue {
		if err := m.engine.ContainerStop(ctx, id, stopTimeout); err != nil {
			return stopped, fmt.Errorf("stop over-limit container %s: %w", id, err)
		}
		m.EndActivity(id)
		stopped = append(stopped, id)
	}
	return stopped, nil
}

// healthy requires an authenticated healthy response from the runtime. The
// client rejects redirects so credentials are never forwarded elsewhere.
func healthy(ctx context.Context, url, password string) bool {
	client := &http.Client{
		Timeout: 5 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"/global/health", nil)
	if err != nil {
		return false
	}
	req.SetBasicAuth("opencode", password)
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var body struct {
		Healthy bool `json:"healthy"`
	}
	return resp.StatusCode == http.StatusOK && json.NewDecoder(resp.Body).Decode(&body) == nil && body.Healthy
}

func newEventID() string {
	id, err := docker.NewPassword()
	if err != nil {
		// Fall back to a timestamp; activity IDs only need uniqueness per chat.
		return "setup-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return "setup-" + id
}
