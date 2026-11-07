package provisioning

import (
	"context"
	"errors"
	"fmt"
	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"strings"
	"testing"
	"time"
)

func TestSavedRuntimeSnapshotsLiveCapAndTimeout(t *testing.T) {
	ctx := context.Background()
	engine := newFakeEngine()
	m, s := newTestManager(t, engine, Config{UseSettings: true}, nil)
	old := newChat(t, s)
	p := storage.DefaultPreferences()
	p.MaxRunning = 2
	p.CPUs = 3
	p.MemoryBytes = 1 << 30
	p.PidsLimit = 128
	p.SetupSeconds = 42
	p.ActivitySeconds = 120
	if err := s.SavePreferences(ctx, p); err != nil {
		t.Fatal(err)
	}
	fresh := newChat(t, s)
	oldEndpoint, err := m.Start(ctx, old.ID)
	if err != nil {
		t.Fatal(err)
	}
	freshEndpoint, err := m.Start(ctx, fresh.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(engine.created) != 2 {
		t.Fatal("missing containers")
	}
	for _, spec := range engine.created {
		if spec.Name == containerName(old.ID) {
			if spec.NanoCPUs != 2e9 || spec.MemoryBytes != 8<<30 || spec.PidsLimit != 512 {
				t.Fatal("old resources changed")
			}
		} else {
			if spec.NanoCPUs != 3e9 || spec.MemoryBytes != 1<<30 || spec.PidsLimit != 128 {
				t.Fatal("new resources ignored")
			}
			found := false
			for _, v := range spec.Env {
				if v == "SETUP_TIMEOUT_SECONDS=42" {
					found = true
				}
			}
			if !found {
				t.Fatal("new setup timeout ignored")
			}
		}
	}
	p.MaxRunning = 1
	if err := s.SavePreferences(ctx, p); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Start(ctx, old.ID); err != nil {
		t.Fatal("lower cap rejected already running", err)
	}
	blocked := newChat(t, s)
	var capErr *CapacityError
	if _, err := m.Start(ctx, blocked.ID); !errors.As(err, &capErr) || capErr.Limit != 1 || capErr.Running != 2 {
		t.Fatal("new start ignored lower cap", err)
	}
	if len(engine.stopped) != 0 {
		t.Fatal("lower cap stopped existing containers")
	}
	now := time.Now()
	m.now = func() time.Time { return now }
	m.BeginActivity(freshEndpoint.ContainerID)
	now = now.Add(60 * time.Second)
	if m.ActivityExpired(freshEndpoint.ContainerID) {
		t.Fatal("activity expired early")
	}
	p.ActivitySeconds = 30
	if err := s.SavePreferences(ctx, p); err != nil {
		t.Fatal(err)
	}
	if !m.ActivityExpired(freshEndpoint.ContainerID) {
		t.Fatal("live timeout change ignored")
	}
	stopped, err := m.SweepActivity(ctx)
	if err != nil || len(stopped) != 1 || stopped[0] != freshEndpoint.ContainerID {
		t.Fatal("live timeout not enforced", err)
	}
	info, err := engine.ContainerInspect(ctx, oldEndpoint.ContainerID)
	if err != nil || !info.State.Running {
		t.Fatal("idle container stopped")
	}
}

func TestCredentialRotationOnlyChangesNewContainerEnvironment(t *testing.T) {
	ctx := context.Background()
	engine := newFakeEngine()
	m, s := newTestManager(t, engine, Config{UseSettings: true}, nil)
	c := storage.Credentials{Provider: "openai", Model: "fixed-model", GitHubToken: "github_pat_fixture", ProviderKey: "old-provider-fixture"}
	if err := s.SaveCredentials(ctx, c); err != nil {
		t.Fatal(err)
	}
	old := newChat(t, s)
	first, err := m.Start(ctx, old.ID)
	if err != nil {
		t.Fatal(err)
	}
	c.ProviderKey = "new-provider-fixture"
	if err := s.SaveCredentials(ctx, c); err != nil {
		t.Fatal(err)
	}
	if err := m.Stop(ctx, old.ID); err != nil {
		t.Fatal(err)
	}
	restarted, err := m.Start(ctx, old.ID)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.ContainerID != first.ContainerID || restarted.ProviderKey != "old-provider-fixture" {
		t.Fatal("rotation rewrote existing container")
	}
	fresh := newChat(t, s)
	next, err := m.Start(ctx, fresh.ID)
	if err != nil {
		t.Fatal(err)
	}
	if next.ProviderKey != "new-provider-fixture" {
		t.Fatal("new container missed rotation")
	}
	for _, id := range []string{first.ContainerID, next.ContainerID} {
		info, err := engine.ContainerInspect(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(info.EnvValue("OPENCODE_CONFIG_CONTENT"), `"model":"openai/fixed-model"`) {
			t.Fatal("rotation changed installed model")
		}
	}
}

type failingImageEngine struct {
	Engine
	pull bool
}

func (e failingImageEngine) ImagePull(context.Context, string) error {
	return errors.New("daemon included provider-fixture github_pat_fixture")
}
func (e failingImageEngine) ImageInspect(ctx context.Context, ref string) (docker.Image, error) {
	if e.pull {
		return e.Engine.ImageInspect(ctx, ref)
	}
	return docker.Image{}, errors.New("daemon included provider-fixture github_pat_fixture")
}

func TestImageDependencyDiagnosticsNeverExposeDaemonBody(t *testing.T) {
	for _, pull := range []bool{false, true} {
		t.Run(fmt.Sprintf("pull=%t", pull), func(t *testing.T) {
			engine := newFakeEngine()
			engine.images = map[string]bool{}
			m, _ := newTestManager(t, engine, Config{}, nil)
			m.engine = failingImageEngine{Engine: engine, pull: pull}
			_, err := m.resolveImage(context.Background())
			var diagnostic *DependencyError
			if !errors.As(err, &diagnostic) || strings.Contains(err.Error(), "fixture") || !strings.Contains(strings.ToLower(err.Error()), "check") {
				t.Fatal("unsafe or unhelpful image diagnostic", err)
			}
		})
	}
}

func TestExplicitCapacityFlagOverridesSavedCap(t *testing.T) {
	ctx := context.Background()
	engine := newFakeEngine()
	m, s := newTestManager(t, engine, Config{UseSettings: true, MaxRunningOverride: 1}, nil)
	p := storage.DefaultPreferences()
	p.MaxRunning = 20
	if err := s.SavePreferences(ctx, p); err != nil {
		t.Fatal(err)
	}
	first, second := newChat(t, s), newChat(t, s)
	if _, err := m.Start(ctx, first.ID); err != nil {
		t.Fatal(err)
	}
	var full *CapacityError
	if _, err := m.Start(ctx, second.ID); !errors.As(err, &full) || full.Limit != 1 {
		t.Fatal("flag lost precedence", err)
	}
}
