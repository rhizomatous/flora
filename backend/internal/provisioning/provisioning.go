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
	"syscall"
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
	// A name@sha256:... reference is pulled when absent. Any other reference
	// (a local tag or ID) must already exist locally and requires ImageID;
	// mutable tags are never pulled.
	ImageRef string
	// ImageDigest is the pinned name@sha256:... identity recorded on each
	// chat. When empty it defaults to ImageRef and must then carry a digest.
	// When ImageRef is digest-pinned, ImageDigest must equal it.
	ImageDigest string
	// ImageID is the expected image content ID (sha256:...). It is required
	// when ImageRef is not digest-pinned, and whenever set the actual local
	// image must match it, so a mutable tag cannot silently drift from the
	// identity recorded on chats.
	ImageID string
	// HarnessVersion is the OpenCode version recorded on each chat.
	HarnessVersion string
	// ProviderAPIKey is injected as ANTHROPIC_API_KEY. It may be empty in
	// tests; model calls then fail inside the container until replaced.
	ProviderAPIKey string

	MaxRunning   int
	SetupTimeout time.Duration
	// SetupKillGrace bounds how long setup may ignore the timeout's SIGTERM
	// before it is SIGKILLed, so a stuck command cannot hold a capacity slot
	// forever without a result.
	SetupKillGrace  time.Duration
	ActivityTimeout time.Duration
	// ReadyTimeout bounds one Start call's wait for the runtime to become
	// healthy. It defaults to SetupTimeout plus one minute, since readiness
	// includes a full setup run and the OpenCode boot.
	ReadyTimeout time.Duration
	NanoCPUs     int64
	MemoryBytes  int64
	PidsLimit    int64
}

func (c Config) withDefaults() (Config, error) {
	if c.ImageRef == "" || c.HarnessVersion == "" {
		return c, errors.New("provisioning: image reference and harness version are required")
	}
	if c.ImageDigest == "" {
		c.ImageDigest = c.ImageRef
	}
	name, digest, pinned := strings.Cut(c.ImageDigest, "@sha256:")
	if name == "" || !pinned || !hexHash(digest) {
		return c, fmt.Errorf("provisioning: image identity %q must be a name@sha256 digest reference", c.ImageDigest)
	}
	refPinned := strings.Contains(c.ImageRef, "@sha256:")
	if refPinned && c.ImageDigest != c.ImageRef {
		return c, fmt.Errorf("provisioning: recorded image identity %q must equal the pinned reference %q", c.ImageDigest, c.ImageRef)
	}
	if !refPinned && c.ImageID == "" {
		return c, fmt.Errorf("provisioning: non-pinned image reference %q requires the expected image ID", c.ImageRef)
	}
	if c.ImageID != "" {
		id, ok := strings.CutPrefix(c.ImageID, "sha256:")
		if !ok || !hexHash(id) {
			return c, fmt.Errorf("provisioning: image ID %q must be a sha256: content ID", c.ImageID)
		}
	}
	if c.MaxRunning <= 0 {
		c.MaxRunning = DefaultMaxRunning
	}
	if c.SetupTimeout <= 0 {
		c.SetupTimeout = DefaultSetupTimeout
	}
	if c.SetupKillGrace <= 0 {
		c.SetupKillGrace = 30 * time.Second
	}
	if c.ActivityTimeout <= 0 {
		c.ActivityTimeout = DefaultActivityTimeout
	}
	if c.ReadyTimeout <= 0 {
		c.ReadyTimeout = c.SetupTimeout + time.Minute
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

func hexHash(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, c := range value {
		if !strings.ContainsRune("0123456789abcdef", c) {
			return false
		}
	}
	return true
}

// Engine is the subset of the Docker Engine API the manager uses. It exists
// so tests can substitute a fake; *docker.Client implements it.
type Engine interface {
	ImageInspect(ctx context.Context, ref string) (docker.Image, error)
	ImagePull(ctx context.Context, ref string) error
	ContainerCreate(ctx context.Context, spec docker.ContainerSpec) (string, error)
	ContainerStart(ctx context.Context, id string) error
	ContainerStop(ctx context.Context, id string, timeoutSeconds int) error
	ContainerInspect(ctx context.Context, idOrName string) (docker.ContainerInfo, error)
	ContainerList(ctx context.Context, running bool, labels map[string]string) ([]docker.ContainerSummary, error)
}

// CheckoutFunc prepares a chat workspace before its first container start,
// typically by downloading the project's core repositories. Implementations
// must be idempotent against an existing workspace. A nil callback leaves the
// workspace empty; core repository download is wired in by the chat lifecycle.
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

// StoppedError reports that a container exited before the runtime became
// ready without recording a setup result, which means it was stopped or
// killed externally (or the entrypoint never ran). It is not a setup failure
// and starting again does not count as a setup retry.
type StoppedError struct {
	ChatID   string
	ExitCode int
}

func (e *StoppedError) Error() string {
	return fmt.Sprintf("container exited (code %d) before the runtime became ready, without a setup result; it was stopped or killed outside setup", e.ExitCode)
}

// RuntimeStartError reports that a container exited with a nonzero code
// before the runtime became ready even though setup did not fail. The OpenCode
// server or entrypoint itself failed; the saved setup output is unrelated to
// this exit.
type RuntimeStartError struct {
	ChatID   string
	ExitCode int
}

func (e *RuntimeStartError) Error() string {
	return fmt.Sprintf("runtime exited (code %d) before becoming ready; setup did not fail, so inspect the container logs", e.ExitCode)
}

type Manager struct {
	engine   Engine
	store    *storage.Store
	cfg      Config
	checkout CheckoutFunc
	health   func(ctx context.Context, url, password string) bool
	// ownerOf reports the uid/gid owning a storage path. Tests override it;
	// production stats the real directory.
	ownerOf func(path string) (uid, gid int, err error)

	mu          sync.Mutex
	locks       map[string]*sync.Mutex
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
		ownerOf:     storageOwner,
		locks:       map[string]*sync.Mutex{},
		activeSince: map[string]time.Time{},
		now:         time.Now,
	}, nil
}

// storageOwner reports the uid/gid owning a storage directory. The agent user
// inside the container is mapped to this identity so the backend keeps
// ownership of its files and the agent can edit them.
func storageOwner(path string) (int, int, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, 0, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, 0, fmt.Errorf("provisioning: cannot determine the owner of %s on this platform", path)
	}
	return int(stat.Uid), int(stat.Gid), nil
}

// Identity returns the pinned image digest and harness version to record when
// creating a chat.
func (m *Manager) Identity() (imageDigest, harnessVersion string) {
	return m.cfg.ImageDigest, m.cfg.HarnessVersion
}

// lockChat serializes Start and Stop calls for one chat. Callers re-read the
// chat's stored binding only after acquiring this lock, so a concurrent or
// retried Start cannot create a second container for the same chat.
func (m *Manager) lockChat(chatID string) func() {
	m.mu.Lock()
	lock, ok := m.locks[chatID]
	if !ok {
		lock = &sync.Mutex{}
		m.locks[chatID] = lock
	}
	m.mu.Unlock()
	lock.Lock()
	return lock.Unlock
}

// Start makes a chat's container running and its runtime endpoint reachable.
// On the first start it checks out the workspace, creates the container, and
// binds it. If an earlier attempt created the container but died before
// binding it, Start adopts that container after validating it is exactly the
// one this chat owns; it never creates a second container for one chat. A
// failed or timed-out setup blocks startup with a SetupError; calling Start
// again is the explicit retry. Starting beyond the running-container limit
// fails with a CapacityError. The wait for runtime readiness is bounded by
// the configured ReadyTimeout.
func (m *Manager) Start(ctx context.Context, chatID string) (Endpoint, error) {
	unlock := m.lockChat(chatID)
	defer unlock()
	chat, err := m.store.Chat(ctx, chatID)
	if err != nil {
		return Endpoint{}, err
	}
	paths, err := m.store.Paths(ctx, chatID)
	if err != nil {
		return Endpoint{}, err
	}
	uid, gid, err := m.ownerOf(paths.Workspace)
	if err != nil {
		return Endpoint{}, err
	}
	if uid == 0 {
		return Endpoint{}, errors.New("provisioning: storage is owned by root; run Flora as a non-root service user so the agent never runs as root")
	}
	if gid == 0 {
		// Some platforms (notably macOS) put user files in a root-owned group
		// like wheel. The agent instead gets a user-private group matching the
		// uid; ownership semantics are unchanged since access is by owner.
		gid = uid
	}
	containerID := chat.ContainerID
	if containerID == "" {
		imageID, err := m.resolveImage(ctx)
		if err != nil {
			return Endpoint{}, err
		}
		info, err := m.engine.ContainerInspect(ctx, containerName(chatID))
		switch {
		case err == nil:
			if err := validateOwned(info, chat, paths, imageID); err != nil {
				return Endpoint{}, err
			}
			if err := m.store.BindRuntime(ctx, chatID, info.ID, ""); err != nil {
				return Endpoint{}, err
			}
			containerID = info.ID
		case docker.IsNotFound(err):
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
			spec := m.containerSpec(chat, paths, password, uid, gid)
			// Hold the lock across the capacity check, creation, and start
			// so concurrent starts cannot overbook the running-container limit.
			var id string
			m.mu.Lock()
			if err = m.checkCapacity(ctx); err == nil {
				if id, err = m.engine.ContainerCreate(ctx, spec); err == nil {
					err = m.engine.ContainerStart(ctx, id)
				}
			}
			m.mu.Unlock()
			if err != nil {
				return Endpoint{}, err
			}
			if err := m.store.BindRuntime(ctx, chatID, id, ""); err != nil {
				return Endpoint{}, err
			}
			containerID = id
		default:
			return Endpoint{}, err
		}
	}
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
	}
	return m.awaitReady(ctx, chatID, paths, containerID)
}

func containerName(chatID string) string { return "flora-chat-" + chatID }

// validateOwned checks that a container found under the chat's deterministic
// name is exactly the container this chat would have created: management and
// chat labels, image content, and mounts must all match. A name collision
// with anything else is an operator error, never silently adopted or removed.
func validateOwned(info docker.ContainerInfo, chat storage.Chat, paths storage.Paths, imageID string) error {
	if info.Name != "/"+containerName(chat.ID) {
		return fmt.Errorf("provisioning: container name %q does not match chat %s", info.Name, chat.ID)
	}
	if info.Config.Labels[labelManaged] != "true" || info.Config.Labels[labelChatID] != chat.ID {
		return fmt.Errorf("provisioning: container %s lacks this chat's ownership labels; refusing to adopt it", info.Name)
	}
	if info.Image != imageID {
		return fmt.Errorf("provisioning: container %s runs image %s, expected %s; refusing to adopt it", info.Name, info.Image, imageID)
	}
	want := map[string]bool{
		paths.Workspace + ":/workspace":     false,
		paths.RuntimeState + ":/home/flora": false,
	}
	for _, bind := range info.HostConfig.Binds {
		if _, ok := want[bind]; !ok {
			return fmt.Errorf("provisioning: container %s has unexpected mount %q; refusing to adopt it", info.Name, bind)
		}
		want[bind] = true
	}
	for bind, seen := range want {
		if !seen {
			return fmt.Errorf("provisioning: container %s is missing mount %q; refusing to adopt it", info.Name, bind)
		}
	}
	return nil
}

// resolveImage returns the content ID of the configured image, pulling it
// first when the reference is digest-pinned and absent. A mutable tag is
// never pulled; it must exist locally and match the configured image ID.
func (m *Manager) resolveImage(ctx context.Context) (string, error) {
	img, err := m.engine.ImageInspect(ctx, m.cfg.ImageRef)
	if docker.IsNotFound(err) {
		if !strings.Contains(m.cfg.ImageRef, "@sha256:") {
			return "", fmt.Errorf("provisioning: image %q is not present locally and the reference is not digest-pinned; refusing to pull a mutable tag", m.cfg.ImageRef)
		}
		if err := m.engine.ImagePull(ctx, m.cfg.ImageRef); err != nil {
			return "", fmt.Errorf("pull agent image: %w", err)
		}
		img, err = m.engine.ImageInspect(ctx, m.cfg.ImageRef)
	}
	if err != nil {
		return "", fmt.Errorf("inspect agent image: %w", err)
	}
	if m.cfg.ImageID != "" && img.ID != m.cfg.ImageID {
		return "", fmt.Errorf("provisioning: local image %q has ID %s, expected %s; rebuild or repin the image", m.cfg.ImageRef, img.ID, m.cfg.ImageID)
	}
	return img.ID, nil
}

// checkCapacity enforces the running-container limit. Idle running containers
// count toward the limit (PRD 2.6). Callers hold m.mu across the check and
// the subsequent create or start.
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

func (m *Manager) containerSpec(chat storage.Chat, paths storage.Paths, password string, uid, gid int) docker.ContainerSpec {
	env := []string{
		"OPENCODE_SERVER_PASSWORD=" + password,
		"FLORA_UID=" + strconv.Itoa(uid),
		"FLORA_GID=" + strconv.Itoa(gid),
	}
	if m.cfg.ProviderAPIKey != "" {
		env = append(env, "ANTHROPIC_API_KEY="+m.cfg.ProviderAPIKey)
	}
	if chat.Configuration.SetupCommand != "" {
		env = append(env, "SETUP_COMMAND="+chat.Configuration.SetupCommand)
	}
	env = append(env, "SETUP_TIMEOUT_SECONDS="+strconv.Itoa(int(m.cfg.SetupTimeout.Seconds())))
	env = append(env, "SETUP_KILL_GRACE_SECONDS="+strconv.Itoa(int(m.cfg.SetupKillGrace.Seconds())))
	return docker.ContainerSpec{
		Name:  containerName(chat.ID),
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
// container exits (setup failure or external stop), or the readiness bound
// expires.
func (m *Manager) awaitReady(ctx context.Context, chatID string, paths storage.Paths, containerID string) (Endpoint, error) {
	ctx, cancel := context.WithTimeout(ctx, m.cfg.ReadyTimeout)
	defer cancel()
	for {
		info, err := m.engine.ContainerInspect(ctx, containerID)
		if err != nil {
			return Endpoint{}, err
		}
		if !info.State.Running {
			return Endpoint{}, m.containerExited(ctx, chatID, paths, info)
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
			return Endpoint{}, fmt.Errorf("runtime did not become ready within %s: %w", m.cfg.ReadyTimeout, ctx.Err())
		case <-time.After(readyPollStep):
		}
	}
}

// containerExited classifies an exited container. Only a recorded nonzero
// setup exit status is a SetupError; just then is the saved output persisted
// as setup activity. A clean exit or a stop/kill signal is a StoppedError.
// Any other nonzero exit with no recorded setup failure is a RuntimeStartError:
// a leftover success status from an earlier setup must not turn a later
// runtime exit into a bogus "setup failed with exit 0".
func (m *Manager) containerExited(ctx context.Context, chatID string, paths storage.Paths, info docker.ContainerInfo) error {
	dir := filepath.Join(paths.RuntimeState, "setup")
	exitCode := info.State.ExitCode
	setupFailed := false
	if raw, err := os.ReadFile(filepath.Join(dir, "exit-status")); err == nil {
		if parsed, err := strconv.Atoi(strings.TrimSpace(string(raw))); err == nil && parsed != 0 {
			exitCode = parsed
			setupFailed = true
		}
	}
	if !setupFailed {
		if exitCode == 0 || exitCode == 137 || exitCode == 143 {
			return &StoppedError{ChatID: chatID, ExitCode: exitCode}
		}
		return &RuntimeStartError{ChatID: chatID, ExitCode: exitCode}
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
//
// Stop serializes with Start per chat, so it can wait behind an in-progress
// Start for up to the readiness bound. A caller that needs a prompt stop
// while a Start is still waiting for readiness must first cancel that Start's
// context; user-facing interrupt wiring is a later layer's job.
func (m *Manager) Stop(ctx context.Context, chatID string) error {
	unlock := m.lockChat(chatID)
	defer unlock()
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
// (PRD 4.7) measures from the beginning of the active period. The chat
// lifecycle must call this when agent work starts and EndActivity when it
// finishes; without those calls no container is ever swept. Active periods
// are process-local: after a Flora restart they restart from zero, so a
// restarted process never stops a container early for activity it did not
// observe.
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
// configured limit and returns their IDs.
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

// RunActivityEnforcement sweeps on the given interval until ctx ends. The
// application starts it alongside the chat lifecycle; it returns the first
// sweep error so the caller can log and restart it.
func (m *Manager) RunActivityEnforcement(ctx context.Context, interval time.Duration) error {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if _, err := m.SweepActivity(ctx); err != nil {
				return err
			}
		}
	}
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
