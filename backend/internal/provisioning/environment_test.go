package provisioning

import (
	"context"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestEnvironmentDeliveredAndRestartFrozen(t *testing.T) {
	ctx := context.Background()
	engine := newFakeEngine()
	m, s := newTestManager(t, engine, Config{UseSettings: true}, nil)
	old := newChat(t, s)
	changes := []storage.EnvironmentChange{{Name: "TASK_REGION", Action: "set", Value: "fixture-region"}, {Name: "SERVICE_TOKEN", Action: "replace", Value: "fixture-service-secret", Secret: true}}
	if err := s.SaveEnvironment(ctx, "installation", "", changes); err != nil {
		t.Fatal(err)
	}
	c := newChat(t, s)
	first, err := m.Start(ctx, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	info, err := engine.ContainerInspect(ctx, first.ContainerID)
	if err != nil {
		t.Fatal(err)
	}
	if info.EnvValue("TASK_REGION") != "fixture-region" || info.EnvValue("SERVICE_TOKEN") != "fixture-service-secret" {
		t.Fatal("container did not receive configured environment")
	}
	changes[1].Value = "fixture-replaced-secret"
	if err := s.SaveEnvironment(ctx, "installation", "", changes); err != nil {
		t.Fatal(err)
	}
	if err := m.Stop(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	restarted, err := m.Start(ctx, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	info, err = engine.ContainerInspect(ctx, restarted.ContainerID)
	if err != nil {
		t.Fatal(err)
	}
	if first.ContainerID != restarted.ContainerID || info.EnvValue("SERVICE_TOKEN") != "fixture-service-secret" {
		t.Fatal("restart rewrote saved environment")
	}
	endpoint, err := m.Start(ctx, old.ID)
	if err != nil {
		t.Fatal(err)
	}
	info, err = engine.ContainerInspect(ctx, endpoint.ContainerID)
	if err != nil {
		t.Fatal(err)
	}
	if info.EnvValue("SERVICE_TOKEN") != "" {
		t.Fatal("existing chat inherited new secret")
	}
}
