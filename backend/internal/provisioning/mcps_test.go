package provisioning

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestMCPSnapshotDeliveredWithoutProviderSettings(t *testing.T) {
	engine := newFakeEngine()
	manager, store := newTestManager(t, engine, Config{}, nil)
	ctx := context.Background()
	original := storage.MCPServer{Name: "tools", URL: "https://fixture.example/mcp", Enabled: true, Timeout: 5000, HeaderNames: []string{"Authorization"}, Headers: map[string]string{"Authorization": "Bearer fake-original"}}
	if err := store.SaveMCP(ctx, original, true); err != nil {
		t.Fatal(err)
	}
	chat := newChat(t, store)
	changed := original
	changed.URL = "https://changed.example/mcp"
	changed.Headers = map[string]string{"Authorization": "Bearer fake-changed"}
	if err := store.SaveMCP(ctx, changed, false); err != nil {
		t.Fatal(err)
	}
	endpoint, err := manager.Start(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	info, err := engine.ContainerInspect(ctx, endpoint.ContainerID)
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		MCP map[string]struct {
			Type, URL string
			OAuth     bool
			Timeout   int
			Headers   map[string]string
		} `json:"mcp"`
	}
	if err = json.Unmarshal([]byte(info.EnvValue("OPENCODE_CONFIG_CONTENT")), &config); err != nil {
		t.Fatal(err)
	}
	record := config.MCP["tools"]
	if record.Type != "remote" || record.OAuth || record.URL != original.URL || record.Headers["Authorization"] != "Bearer fake-original" || record.Timeout != 5000 {
		t.Fatal("runtime configuration lost or changed snapshot")
	}
	if err = manager.Stop(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = manager.Start(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	if len(engine.created) != 1 {
		t.Fatal("restart replaced container")
	}
}
