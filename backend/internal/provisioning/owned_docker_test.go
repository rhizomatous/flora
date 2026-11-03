package provisioning

import (
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

// TestProvisioningOwnedDocker uses the installer's real bridge and pinned image.
// It makes no model requests or upstream GitHub operations.
func TestProvisioningOwnedDocker(t *testing.T) {
	network := os.Getenv("FLORA_OWNED_NETWORK_ID")
	if network == "" {
		t.Skip("requires the disposable systemd installer fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	engine, err := docker.New("")
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	store, err := storage.Open(ctx, filepath.Join(t.TempDir(), "data"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	cfg := Config{ImageRef: os.Getenv("FLORA_PROVISIONING_TEST_IMAGE"), HarnessVersion: "1.2.27", NetworkID: network, BrokerGateway: os.Getenv("FLORA_OWNED_NETWORK_GATEWAY")}
	manager, err := New(engine, store, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	project, err := store.CreateProject(ctx, "owned network", storage.Configuration{Repositories: []storage.Repository{{Name: "fixture", URL: "https://github.com/example/fixture", BaseBranch: "main", Role: "core"}}, SetupCommand: "printf preserved-edit >> /workspace/owned.txt"})
	if err != nil {
		t.Fatal(err)
	}
	image, harness := manager.Identity()
	chat, err := store.CreateChat(ctx, project.ID, "owned lifecycle", image, harness)
	if err != nil {
		t.Fatal(err)
	}
	ep, err := manager.Start(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 20*time.Second)
		defer stop()
		if err := engine.ContainerRemove(cleanup, ep.ContainerID, true); err != nil {
			t.Error(err)
		}
	}()
	paths, err := store.Paths(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Stop(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	resumed, err := manager.Start(ctx, chat.ID)
	if err != nil || resumed.ContainerID != ep.ContainerID {
		t.Fatalf("resume replaced container: %v", err)
	}
	edits, err := os.ReadFile(filepath.Join(paths.Workspace, "owned.txt"))
	if err != nil || string(edits) != "preserved-edit" {
		t.Fatalf("workspace/setup changed: %q %v", edits, err)
	}
	recovered, err := New(engine, store, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := recovered.Endpoint(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	// Attaching an extra network must block all operations on this container.
	if out, err := exec.CommandContext(ctx, "docker", "network", "connect", "bridge", ep.ContainerID).CombinedOutput(); err != nil {
		t.Fatalf("attach drift fixture: %v %s", err, out)
	}
	if _, err := recovered.Endpoint(ctx, chat.ID); err == nil {
		t.Fatal("recovery accepted extra network")
	}
	if _, err := recovered.Start(ctx, chat.ID); err == nil {
		t.Fatal("start accepted extra network")
	}
	if err := recovered.Stop(ctx, chat.ID); err == nil {
		t.Fatal("stop accepted extra network")
	}
	code, err := engine.Exec(ctx, ep.ContainerID, "root", []string{"true"}, nil, io.Discard, io.Discard)
	if err != nil || code != 0 {
		t.Fatal("refused stop still stopped the drifted container")
	}
}
