package provisioning

import (
	"context"
	"errors"
	"github.com/rhizomatous/flora/backend/internal/docker"
	"testing"
)

func TestWakeNeverCreatesMissingContainer(t *testing.T) {
	engine := newFakeEngine()
	m, store := newTestManager(t, engine, Config{}, nil)
	c := newChat(t, store)
	_, err := m.Wake(context.Background(), c.ID)
	var ended *ExecutionEndedError
	if !errors.As(err, &ended) || !ended.Missing || len(engine.created) != 0 {
		t.Fatalf("wake: %v, creates: %d", err, len(engine.created))
	}
}

type observedRuntimeEngine struct {
	Engine
	info docker.ContainerInfo
	err  error
}

func (e observedRuntimeEngine) ContainerInspect(context.Context, string) (docker.ContainerInfo, error) {
	return e.info, e.err
}
func TestRuntimeStateIsObservedAndUsageIsNeverInvented(t *testing.T) {
	ctx := context.Background()
	engine := newFakeEngine()
	m, store := newTestManager(t, engine, Config{}, nil)
	c := newChat(t, store)
	endpoint, err := m.Start(ctx, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	info, err := engine.ContainerInspect(ctx, endpoint.ContainerID)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		status string
		exit   int
		oom    bool
		want   string
	}{{"running", 0, false, "running"}, {"created", 0, false, "starting"}, {"restarting", 0, false, "starting"}, {"exited", 0, false, "stopped"}, {"exited", 1, false, "failed"}, {"exited", 0, true, "failed"}, {"paused", 0, false, "unknown"}} {
		t.Run(tc.status+tc.want, func(t *testing.T) {
			info.State = docker.ContainerState{Status: tc.status, ExitCode: tc.exit, OOMKilled: tc.oom}
			m.engine = observedRuntimeEngine{Engine: engine, info: info}
			r, err := m.Runtime(ctx, c.ID)
			if err != nil || r.State != tc.want || r.Usage != nil || r.ObservedAt.IsZero() {
				t.Fatalf("%+v %v", r, err)
			}
			if tc.want == "running" && r.CollectionError == "" {
				t.Fatal("unavailable measurements reported as healthy")
			}
		})
	}
	m.engine = observedRuntimeEngine{Engine: engine, err: errors.New("secret daemon detail")}
	r, err := m.Runtime(ctx, c.ID)
	if err != nil || r.State != "unknown" || r.CPU != nil || r.Usage != nil || r.CollectionError == "" {
		t.Fatalf("%+v %v", r, err)
	}
}
