package provisioning

import (
	"context"
	"strings"
	"testing"
)

func TestOwnedNetworkLifecycleAndDrift(t *testing.T) {
	for _, drift := range []string{"mode", "mapping", "missing-mapping"} {
		for _, operation := range []string{"start", "stop", "recover"} {
			t.Run(drift+"/"+operation, func(t *testing.T) {
				engine := newFakeEngine()
				network := strings.Repeat("a", 64)
				manager, store := newTestManager(t, engine, Config{NetworkID: network, BrokerGateway: "172.29.80.1"}, nil)
				chat := newChat(t, store)
				ctx := context.Background()
				ep, err := manager.Start(ctx, chat.ID)
				if err != nil {
					t.Fatal(err)
				}
				spec := engine.created[0]
				if spec.NetworkID != network || len(spec.ExtraHosts) != 1 || spec.ExtraHosts[0] != "flora-github.internal:172.29.80.1" {
					t.Fatal("network settings not passed to Docker")
				}
				if err := manager.Stop(ctx, chat.ID); err != nil {
					t.Fatal(err)
				}
				if _, err := manager.Start(ctx, chat.ID); err != nil {
					t.Fatal(err)
				}
				if _, err := manager.Endpoint(ctx, chat.ID); err != nil {
					t.Fatal(err)
				}
				c := engine.containers[ep.ContainerID]
				switch drift {
				case "mode":
					c.networkID = strings.Repeat("b", 64)
				case "mapping":
					c.extraHosts = []string{"flora-github.internal:172.17.0.1"}
				case "missing-mapping":
					c.extraHosts = nil
				}
				stops := len(engine.stopped)
				switch operation {
				case "start":
					_, err = manager.Start(ctx, chat.ID)
				case "stop":
					err = manager.Stop(ctx, chat.ID)
				case "recover":
					_, err = manager.Endpoint(ctx, chat.ID)
				}
				if err == nil {
					t.Fatal("accepted drifted container")
				}
				if len(engine.created) != 1 || len(engine.stopped) != stops {
					t.Fatal("operated on drifted container")
				}
			})
		}
	}
}

func TestOwnedNetworkMembership(t *testing.T) {
	engine := newFakeEngine()
	manager, store := newTestManager(t, engine, Config{NetworkID: strings.Repeat("a", 64), BrokerGateway: "172.29.80.1"}, nil)
	chat := newChat(t, store)
	ep, err := manager.Start(context.Background(), chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	info, err := engine.ContainerInspect(context.Background(), ep.ContainerID)
	if err != nil {
		t.Fatal(err)
	}
	paths, err := store.Paths(context.Background(), chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, networks := range []map[string]string{nil, {"wrong": strings.Repeat("b", 64)}, {"right": manager.cfg.NetworkID, "extra": strings.Repeat("b", 64)}} {
		info.NetworkSettings.Networks = networks
		if err := manager.validateOwned(info, chat, paths, testImageID); err == nil {
			t.Fatal("accepted changed membership")
		}
	}
	info.NetworkSettings.Networks = map[string]string{"pending": ""}
	if err := manager.validateOwned(info, chat, paths, testImageID); err == nil {
		t.Fatal("running container accepted unresolved membership")
	}
	info.State.Running, info.State.Status = false, "created"
	if err := manager.validateOwned(info, chat, paths, testImageID); err != nil {
		t.Fatal("created container with exact NetworkMode rejected before endpoint allocation", err)
	}
	info.State.Status = "exited"
	if err := manager.validateOwned(info, chat, paths, testImageID); err == nil {
		t.Fatal("stopped container accepted unresolved membership")
	}
}

func TestOwnedNetworkConfigRejectsPartialAndUnsafeValues(t *testing.T) {
	for _, cfg := range []Config{
		{},
		{NetworkID: "named-network", BrokerGateway: "172.29.80.1"},
		{NetworkID: strings.Repeat("a", 64)},
		{BrokerGateway: "172.29.80.1"},
		{NetworkID: strings.Repeat("a", 64), BrokerGateway: "8.8.8.8"},
		{NetworkID: strings.Repeat("a", 64), BrokerGateway: "fd00::1"},
	} {
		cfg.ImageRef, cfg.HarnessVersion = testDigest, "1.2.27"
		if _, err := cfg.withDefaults(); err == nil {
			t.Fatal("accepted invalid network configuration")
		}
	}
}
