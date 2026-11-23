package provisioning

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

type metadataEngine struct {
	*fakeEngine
	port            string
	failStart       bool
	cleanupCanceled bool
}

func (e *metadataEngine) ContainerCreate(ctx context.Context, spec docker.ContainerSpec) (string, error) {
	id, err := e.fakeEngine.ContainerCreate(ctx, spec)
	if err == nil {
		e.mu.Lock()
		e.containers[id].port = e.port
		e.mu.Unlock()
	}
	return id, err
}
func (e *metadataEngine) ContainerStart(ctx context.Context, id string) error {
	if e.failStart {
		return errors.New("start failed")
	}
	return e.fakeEngine.ContainerStart(ctx, id)
}
func (e *metadataEngine) ContainerRemove(ctx context.Context, id string, force bool) error {
	e.cleanupCanceled = ctx.Err() != nil
	return e.fakeEngine.ContainerRemove(ctx, id, force)
}

func TestMetadataContainerIsolationAndCleanup(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if !ok || user != "opencode" || password == "" || (r.URL.Path != "/provider" && r.URL.Path != "/command") || r.Method != "GET" {
			t.Error("unexpected metadata request")
			w.WriteHeader(400)
			return
		}
		if r.URL.Path == "/command" {
			w.Write([]byte(`[]`))
			return
		}
		w.Write([]byte(`{"all":[],"connected":[]}`))
	}))
	defer server.Close()
	_, port, _ := net.SplitHostPort(server.Listener.Addr().String())
	for _, mode := range []string{"success", "commands", "start failure", "canceled readiness"} {
		t.Run(mode, func(t *testing.T) {
			base := newFakeEngine()
			m, store := newTestManager(t, base, Config{}, nil)
			engine := &metadataEngine{fakeEngine: base, port: port, failStart: mode == "start failure"}
			m.engine = engine
			ctx := context.Background()
			if mode == "canceled readiness" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, 10*time.Millisecond)
				defer cancel()
				m.health = func(context.Context, string, string) bool { return false }
			}
			discover := m.ModelMetadata
			if mode == "commands" {
				discover = m.CommandMetadata
			}
			raw, err := discover(ctx, storage.Credentials{Provider: "anthropic", Model: "model", ProviderKey: "provider-key", GitHubToken: "github-must-not-appear"})
			if mode == "success" || mode == "commands" {
				if err != nil || len(raw) == 0 {
					t.Fatal(err)
				}
			} else if err == nil {
				t.Fatal("expected discovery failure")
			}
			if len(base.containers) != 0 || engine.cleanupCanceled {
				t.Fatal("metadata container survived or cleanup inherited cancellation")
			}
			if len(base.created) != 1 {
				t.Fatal("missing metadata instance")
			}
			spec := base.created[0]
			if spec.Image != testImageID || len(spec.Binds) != 0 || len(spec.ExtraHosts) != 0 || spec.User != "1000:1000" || spec.WorkingDir != "/tmp" || !spec.AutoRemove || spec.Labels[labelManaged] != "" || spec.LoopbackPort != 4096 {
				t.Fatal("metadata isolation changed")
			}
			if strings.Join(spec.Entrypoint, " ") != "timeout -k 5 45 opencode" || strings.Join(spec.Command, " ") != "serve --hostname 0.0.0.0 --port 4096" {
				t.Fatal("metadata ran a different process")
			}
			for _, env := range spec.Env {
				if strings.Contains(env, "github-must-not-appear") || strings.HasPrefix(env, "SETUP_") || strings.HasPrefix(env, "FLORA_CHECKOUT") {
					t.Fatal("metadata received checkout or GitHub configuration")
				}
			}
			chats, err := store.Chats(context.Background())
			if err != nil || len(chats) != 0 {
				t.Fatal("discovery created a chat")
			}
		})
	}
}
