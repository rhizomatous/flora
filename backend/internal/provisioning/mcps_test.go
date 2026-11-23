package provisioning

import (
	"context"
	"encoding/json"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"os"
	"path/filepath"
	"testing"
)

func TestMCPLatestSettingsAtStart(t *testing.T) {
	engine := newFakeEngine()
	manager, store := newTestManager(t, engine, Config{}, nil)
	ctx := context.Background()
	server := storage.MCPServer{Name: "tools", URL: "https://fixture.example/mcp", Enabled: true, Timeout: 5000, HeaderNames: []string{"Authorization"}, Headers: map[string]string{"Authorization": "Bearer fake-original"}}
	if err := store.SaveMCP(ctx, server, true); err != nil {
		t.Fatal(err)
	}
	chat := newChat(t, store)
	paths, err := store.Paths(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Join(paths.RuntimeState, ".config/opencode"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(paths.RuntimeState, storage.MCPRuntimeFile), []byte(`{"autoupdate":false,"mcp":{}}`), 0600); err != nil {
		t.Fatal(err)
	}
	server.URL = "https://changed.example/mcp"
	server.Headers["Authorization"] = "Bearer fake-changed"
	if err := store.SaveMCP(ctx, server, false); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Start(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(paths.RuntimeState, storage.MCPRuntimeFile))
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err = json.Unmarshal(raw, &config); err != nil || config["autoupdate"] != false {
		t.Fatal("unrelated runtime configuration changed", err)
	}
	active, err := store.RuntimeMCPServers(ctx, chat.ID)
	if err != nil || len(active) != 1 || active[0].URL != server.URL || active[0].Headers["Authorization"] != "Bearer fake-changed" {
		t.Fatal("start did not load latest settings", err)
	}
	if err := store.DeleteMCP(ctx, server.Name); err != nil {
		t.Fatal(err)
	}
	if _, err = manager.Start(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	active, err = store.RuntimeMCPServers(ctx, chat.ID)
	if err != nil || len(active) != 1 {
		t.Fatal("running connection changed", err)
	}
	if err = manager.Stop(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = manager.Start(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	active, err = store.RuntimeMCPServers(ctx, chat.ID)
	if err != nil || len(active) != 0 {
		t.Fatal("restart retained removed server", err)
	}
	if len(engine.created) != 1 {
		t.Fatal("restart replaced the container")
	}
}
