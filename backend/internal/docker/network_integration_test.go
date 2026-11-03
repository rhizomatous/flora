package docker

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

// TestOwnedBridgeDocker runs only against the disposable fixture's nested Engine.
// It creates one labeled container and removes only the returned immutable ID.
func TestOwnedBridgeDocker(t *testing.T) {
	id := os.Getenv("FLORA_DOCKER_NETWORK_ID")
	if id == "" {
		t.Skip("requires the disposable owned-network fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	engine, err := New(os.Getenv("FLORA_DOCKER_NETWORK_SOCKET"))
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	network, err := engine.NetworkInspect(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	gateway := os.Getenv("FLORA_DOCKER_NETWORK_GATEWAY")
	if network.ID != id || network.Driver != "bridge" || network.Internal || len(network.Gateways) != 1 || network.Gateways[0] != gateway {
		t.Fatalf("network inspection mismatch: %+v", network)
	}
	container, err := engine.ContainerCreate(ctx, ContainerSpec{
		Name: "flora-sdk-owned-network-fixture", Image: os.Getenv("FLORA_DOCKER_NETWORK_IMAGE"),
		NetworkID: id, ExtraHosts: []string{"flora-github.internal:" + gateway},
		Labels: map[string]string{"flora.fixture": "owned-network-sdk"}, LoopbackPort: 4096, PidsLimit: 128,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 20*time.Second)
		defer stop()
		if err := engine.ContainerRemove(cleanup, container, true); err != nil {
			t.Error(err)
		}
	}()
	if err := engine.ContainerStart(ctx, container); err != nil {
		t.Fatal(err)
	}
	for _, running := range []bool{true, false} {
		if !running {
			if err := engine.ContainerStop(ctx, container, 2); err != nil {
				t.Fatal(err)
			}
		}
		info, err := engine.ContainerInspect(ctx, container)
		if err != nil {
			t.Fatal(err)
		}
		if info.HostConfig.NetworkMode != id || len(info.NetworkSettings.Networks) != 1 || len(info.HostConfig.ExtraHosts) != 1 || info.HostConfig.ExtraHosts[0] != "flora-github.internal:"+gateway {
			t.Fatal("create/inspect lost owned network identity or host mapping")
		}
		for _, actual := range info.NetworkSettings.Networks {
			if actual != id {
				t.Fatal("attached to wrong bridge")
			}
		}
		if running {
			if !strings.HasPrefix(info.LoopbackAddress(4096), "127.0.0.1:") {
				t.Fatal("runtime port was not published on loopback")
			}
			ca, err := os.ReadFile(os.Getenv("FLORA_DOCKER_NETWORK_CA"))
			if err != nil {
				t.Fatal(err)
			}
			var out, stderr bytes.Buffer
			code, err := engine.Exec(ctx, container, "root", []string{"sh", "-c", "cat >/tmp/ca.crt && curl --silent --show-error --cacert /tmp/ca.crt --output /dev/null --write-out '%{http_code}' https://flora-github.internal/"}, bytes.NewReader(ca), &out, &stderr)
			if err != nil || code != 0 || out.String() != "401" {
				t.Fatalf("broker route: exit=%d error=%v stderr=%s response=%s", code, err, &stderr, &out)
			}
		}
	}
}
