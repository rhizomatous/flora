package provisioning

import (
	"context"
	"errors"
	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"io"
	"os"
	"testing"
	"time"
)

// Uses local setup commands and the real image, without any provider or GitHub
// requests. Cleanup removes only the random chat containers created by this test.
func TestSettingsDocker(t *testing.T) {
	image := os.Getenv("FLORA_PROVISIONING_TEST_IMAGE")
	if image == "" {
		t.Skip("set FLORA_PROVISIONING_TEST_IMAGE to a locally built agent image")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	engine, err := docker.New("")
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	img, err := engine.ImageInspect(ctx, image)
	if err != nil {
		t.Fatal(err)
	}
	s, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var owned []string
	defer func() {
		clean, stop := context.WithTimeout(context.Background(), 30*time.Second)
		defer stop()
		for _, id := range owned {
			_ = engine.ContainerRemove(clean, id, true)
		}
	}()
	access := checkoutFunc(func(ctx context.Context, _ storage.Chat, _ storage.Paths, id string) error {
		_, err := engine.Exec(ctx, id, "0", []string{"sh", "-c", ": > /home/flora/.flora-github.env; touch /var/lib/flora-checkout.ready"}, nil, io.Discard, io.Discard)
		return err
	})
	network, err := engine.NetworkInspect(ctx, "bridge")
	if err != nil {
		t.Fatal(err)
	}
	m, err := New(engine, s, Config{NetworkID: network.ID, BrokerGateway: network.Gateways[0], ImageRef: image, ImageDigest: testDigest, ImageID: img.ID, HarnessVersion: "1.2.27", UseSettings: true}, access)
	if err != nil {
		t.Fatal(err)
	}
	p := storage.DefaultPreferences()
	p.CPUs = .75
	p.MemoryBytes = 1 << 30
	p.PidsLimit = 128
	p.SetupSeconds = 5
	p.MaxRunning = 2
	if err := s.SavePreferences(ctx, p); err != nil {
		t.Fatal(err)
	}
	create := func(title, setup string) storage.Chat {
		t.Helper()
		project, err := s.CreateProject(ctx, title, storage.Configuration{Repositories: []storage.Repository{{Name: "core", URL: "https://github.com/example/core", BaseBranch: "main", Role: "core"}}, SetupCommand: setup})
		if err != nil {
			t.Fatal(err)
		}
		c, err := s.CreateChat(ctx, project.ID, title, testDigest, "1.2.27")
		if err != nil {
			t.Fatal(err)
		}
		owned = append(owned, containerName(c.ID))
		return c
	}
	first := create("settings resources", "printf settings-ok")
	endpoint, err := m.Start(ctx, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	info, err := engine.ContainerInspect(ctx, endpoint.ContainerID)
	if err != nil {
		t.Fatal(err)
	}
	if info.HostConfig.NanoCPUs != 750000000 || info.HostConfig.Memory != 1<<30 || info.HostConfig.PidsLimit != 128 || info.EnvValue("SETUP_TIMEOUT_SECONDS") != "5" {
		t.Fatal("Docker did not receive saved runtime limits")
	}
	p.CPUs = 1
	p.MemoryBytes = 2 << 30
	p.PidsLimit = 256
	p.SetupSeconds = 2
	p.MaxRunning = 1
	if err := s.SavePreferences(ctx, p); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Start(ctx, first.ID); err != nil {
		t.Fatal("lower cap interrupted existing container", err)
	}
	second := create("settings setup timeout", "sleep 5")
	var full *CapacityError
	if _, err := m.Start(ctx, second.ID); !errors.As(err, &full) {
		t.Fatal("lower saved cap did not reject new start", err)
	}
	if err := m.Stop(ctx, first.ID); err != nil {
		t.Fatal(err)
	}
	var setup *SetupError
	if _, err := m.Start(ctx, second.ID); !errors.As(err, &setup) || setup.ExitCode != 124 {
		t.Fatal("saved setup timeout not enforced", err)
	}
	info, err = engine.ContainerInspect(ctx, containerName(second.ID))
	if err != nil {
		t.Fatal(err)
	}
	if info.HostConfig.NanoCPUs != 1e9 || info.HostConfig.Memory != 2<<30 || info.HostConfig.PidsLimit != 256 {
		t.Fatal("new chat did not receive changed resources")
	}
	if _, err := m.Start(ctx, first.ID); err != nil {
		t.Fatal("saved chat restart failed", err)
	}
	info, err = engine.ContainerInspect(ctx, endpoint.ContainerID)
	if err != nil || info.HostConfig.NanoCPUs != 750000000 || info.EnvValue("SETUP_TIMEOUT_SECONDS") != "5" {
		t.Fatal("restart changed existing container limits", err)
	}
	t.Log("Docker enforced saved resources and setup timeout; lower cap kept the existing container, rejected a new start, and restart preserved the old limits.")
}
