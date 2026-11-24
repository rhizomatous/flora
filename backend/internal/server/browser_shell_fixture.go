//go:build browserfixture

package server

import (
	"context"
	"fmt"
	"net"
	"net/http/httptest"
	"os"
	"path/filepath"
	"time"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/chat"
	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/testfixture"
	"github.com/rhizomatous/flora/backend/internal/webassets"
)

// newShellBrowserInstance uses the real provisioner and a local pinned agent
// image. It seeds only a project and account; shell input and output are live.
func newShellBrowserInstance() (_ *BrowserInstance, err error) {
	image := os.Getenv("FLORA_SHELL_PREVIEW_IMAGE")
	if image == "" {
		return nil, fmt.Errorf("shell preview requires FLORA_SHELL_PREVIEW_IMAGE and a local Docker daemon")
	}
	directory, err := os.MkdirTemp("", "flora-shell-preview-")
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	cleanup := []func(){func() { os.RemoveAll(directory) }, cancel}
	instance := &BrowserInstance{Close: func() {
		for i := len(cleanup) - 1; i >= 0; i-- {
			cleanup[i]()
		}
	}}
	defer func() {
		if err != nil {
			instance.Close()
		}
	}()
	store, err := storage.Open(ctx, filepath.Join(directory, "data"))
	if err != nil {
		return nil, err
	}
	cleanup = append(cleanup, func() { store.Close() })
	authentication := auth.New(store)
	if _, _, err = testfixture.Bootstrap(ctx, authentication, "browser test password"); err != nil {
		return nil, err
	}
	engine, err := docker.New(os.Getenv("FLORA_SHELL_PREVIEW_SOCKET"))
	if err != nil {
		return nil, err
	}
	cleanup = append(cleanup, func() { engine.Close() })
	img, err := engine.ImageInspect(ctx, image)
	if err != nil {
		return nil, err
	}
	network, err := engine.NetworkInspect(ctx, "bridge")
	if err != nil {
		return nil, err
	}
	manager, err := provisioning.New(engine, store, provisioning.Config{NetworkID: network.ID, BrokerGateway: network.Gateways[0], ImageRef: image, ImageDigest: "preview/agent@" + img.ID, ImageID: img.ID, HarnessVersion: "1.2.27", ReadyTimeout: time.Minute}, nil)
	if err != nil {
		return nil, err
	}
	project, err := store.CreateProject(ctx, "Shell preview", storage.Configuration{Repositories: []storage.Repository{{Name: "preview/workspace", URL: "https://github.com/example/workspace", BaseBranch: "main", Role: "core"}}})
	if err != nil {
		return nil, err
	}
	digest, harness := manager.Identity()
	c, err := store.CreateChat(ctx, project.ID, "Explore the workspace", digest, harness)
	if err != nil {
		return nil, err
	}
	// Cleanup is registered before start because readiness may fail after Docker
	// creates the uniquely named container.
	cleanup = append(cleanup, func() {
		stop, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = engine.ContainerRemove(stop, "flora-chat-"+c.ID, true)
	})
	if _, err = manager.Start(ctx, c.ID); err != nil {
		return nil, err
	}
	paths, err := store.Paths(ctx, c.ID)
	if err != nil {
		return nil, err
	}
	if err = os.WriteFile(filepath.Join(paths.Workspace, "hello.txt"), []byte("Welcome to an isolated Flora shell.\n"), 0644); err != nil {
		return nil, err
	}
	if err = store.Transition(ctx, c.ID, "", storage.Idle, "Machine ready"); err != nil {
		return nil, err
	}
	other, err := store.CreateChat(ctx, project.ID, "Missing machine", digest, harness)
	if err != nil {
		return nil, err
	}
	service := chat.New(ctx, store, manager)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = service.EnforceTimeouts(ctx)
			}
		}
	}()
	cleanup = append(cleanup, func() { cancel(); <-done })
	srv := httptest.NewUnstartedServer(nil)
	origin := "http://localhost:" + fmt.Sprint(srv.Listener.Addr().(*net.TCPAddr).Port)
	assets := webassets.FS()
	if directory := os.Getenv("FLORA_SHELL_PREVIEW_ASSETS"); directory != "" {
		assets = os.DirFS(directory)
	}
	srv.Config.Handler = New(assets, authentication, settings.New(store), origin, service)
	srv.Start()
	cleanup = append(cleanup, func() { srv.CloseClientConnections(); srv.Close() })
	instance.URL = origin
	instance.ChatID = c.ID
	instance.OtherChatID = other.ID
	return instance, nil
}
