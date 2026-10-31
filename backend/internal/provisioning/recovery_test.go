package provisioning

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/docker"
)

type oomEngine struct{ *fakeEngine }

func (e oomEngine) ContainerInspect(ctx context.Context, id string) (docker.ContainerInfo, error) {
	info, err := e.fakeEngine.ContainerInspect(ctx, id)
	info.State.OOMKilled = true
	return info, err
}

func TestEndpointClassifiesExitWithoutRestarting(t *testing.T) {
	for _, kind := range []string{"crash", "oom", "reboot", "missing", "foreign"} {
		t.Run(kind, func(t *testing.T) {
			engine := newFakeEngine()
			manager, store := newTestManager(t, engine, Config{}, nil)
			c := newChat(t, store)
			ctx := context.Background()
			endpoint, err := manager.Start(ctx, c.ID)
			if err != nil {
				t.Fatal(err)
			}
			engine.mu.Lock()
			container := engine.containers[endpoint.ContainerID]
			container.running = false
			container.exitCode = 1
			if kind == "reboot" {
				container.exitCode = 0
			}
			if kind == "missing" {
				delete(engine.containers, endpoint.ContainerID)
			}
			if kind == "foreign" {
				container.labels[labelChatID] = "other"
			}
			engine.mu.Unlock()
			if kind == "oom" {
				manager.engine = oomEngine{engine}
			}
			_, err = manager.Endpoint(ctx, c.ID)
			var ended *ExecutionEndedError
			if kind == "foreign" {
				if err == nil || errors.As(err, &ended) {
					t.Fatal("foreign container was trusted")
				}
			} else {
				if !errors.As(err, &ended) {
					t.Fatalf("exit not classified: %v", err)
				}
				if kind == "oom" && !strings.Contains(ended.Reason, "out of memory") {
					t.Fatal("OOM information lost")
				}
			}
			engine.mu.Lock()
			if len(engine.created) != 1 || container.running || len(engine.stopped) != 0 || len(engine.pulled) != 0 {
				t.Error("endpoint lookup changed execution")
			}
			engine.mu.Unlock()
		})
	}
}

func TestEndpointAdoptsOwnedUnboundContainerWithoutStarting(t *testing.T) {
	engine := newFakeEngine()
	manager, store := newTestManager(t, engine, Config{}, nil)
	c := newChat(t, store)
	ctx := context.Background()
	paths, err := store.Paths(ctx, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	id, err := engine.ContainerCreate(ctx, manager.containerSpec(c, paths, "fixture-password", 1000, 1000))
	if err != nil {
		t.Fatal(err)
	}
	_, err = manager.Endpoint(ctx, c.ID)
	var ended *ExecutionEndedError
	if !errors.As(err, &ended) {
		t.Fatal("stopped orphan was not classified")
	}
	saved, err := store.Chat(ctx, c.ID)
	if err != nil || saved.ContainerID != id || len(engine.created) != 1 {
		t.Fatal("owned orphan not bound")
	}
}
