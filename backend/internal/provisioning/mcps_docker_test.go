package provisioning

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestMCPDockerLifecycle(t *testing.T) {
	image := os.Getenv("FLORA_PROVISIONING_TEST_IMAGE")
	if image == "" {
		t.Skip("set FLORA_PROVISIONING_TEST_IMAGE to a local pinned agent image")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	var initialized, closed atomic.Int32
	var credential atomic.Value
	credential.Store("Bearer fake-container-secret")
	fixture := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != credential.Load().(string) {
			w.WriteHeader(403)
			return
		}
		if r.Method == "GET" {
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, ": ready\n\n")
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			closed.Add(1)
			return
		}
		if r.Method == "DELETE" {
			closed.Add(1)
			w.WriteHeader(204)
			return
		}
		var req struct {
			ID     int    `json:"id"`
			Method string `json:"method"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		var result any
		switch req.Method {
		case "initialize":
			initialized.Add(1)
			w.Header().Set("Mcp-Session-Id", fmt.Sprint("fixture-", initialized.Load()))
			result = map[string]any{"serverInfo": map[string]string{"name": "fixture", "version": "1"}, "protocolVersion": "2025-03-26", "capabilities": map[string]any{"tools": map[string]any{}}}
		case "notifications/initialized":
			w.WriteHeader(202)
			return
		case "tools/list":
			result = map[string]any{"tools": []map[string]any{{"name": "read_notes", "inputSchema": map[string]string{"type": "object"}}}}
		default:
			w.WriteHeader(404)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
	}))
	fixture.Listener.Close()
	listener, err := net.Listen("tcp4", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	fixture.Listener = listener
	fixture.Start()
	defer fixture.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	engine, err := docker.New("")
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	img, err := engine.ImageInspect(ctx, image)
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err = store.SaveEnvironment(ctx, "installation", "", []storage.EnvironmentChange{{Name: "SERVICE_TOKEN", Action: "replace", Value: "fake-environment-token", Secret: true}}); err != nil {
		t.Fatal(err)
	}
	access := checkoutFunc(func(ctx context.Context, _ storage.Chat, _ storage.Paths, id string) error {
		_, err := engine.Exec(ctx, id, "0", []string{"sh", "-c", ": > /home/flora/.flora-github.env; touch /var/lib/flora-checkout.ready"}, nil, io.Discard, io.Discard)
		return err
	})
	network, err := engine.NetworkInspect(ctx, "bridge")
	if err != nil {
		t.Fatal(err)
	}
	manager, err := New(engine, store, Config{NetworkID: network.ID, BrokerGateway: network.Gateways[0], ImageRef: image, ImageDigest: testDigest, ImageID: img.ID, HarnessVersion: "1.2.27", ReadyTimeout: 45 * time.Second}, access)
	if err != nil {
		t.Fatal(err)
	}
	host := "host.docker.internal"
	if runtime.GOOS == "linux" {
		host = network.Gateways[0]
	}
	server := storage.MCPServer{Name: "garden", URL: fmt.Sprintf("http://%s:%d/mcp", host, port), Enabled: true, Timeout: 5000, HeaderNames: []string{"Authorization"}, Headers: map[string]string{"Authorization": "Bearer fake-container-secret"}}
	if err = store.SaveMCP(ctx, server, true); err != nil {
		t.Fatal(err)
	}
	chat := newChat(t, store)
	endpoint, err := manager.Start(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	info, err := engine.ContainerInspect(ctx, endpoint.ContainerID)
	if err != nil {
		t.Fatal(err)
	}
	if info.EnvValue("SERVICE_TOKEN") != "fake-environment-token" {
		t.Fatal("MCP provisioning lost the environment secret")
	}
	defer func() {
		clean, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		engine.ContainerRemove(clean, endpoint.ContainerID, true)
	}()
	call := func(path string, out any) {
		t.Helper()
		req, _ := http.NewRequestWithContext(ctx, "GET", endpoint.URL+path, nil)
		req.SetBasicAuth(endpoint.Username, endpoint.Password)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != 200 || json.NewDecoder(res.Body).Decode(out) != nil {
			t.Fatalf("runtime %s failed", path)
		}
	}
	var statuses map[string]struct {
		Status string `json:"status"`
		Error  string `json:"error"`
	}
	call("/mcp", &statuses)
	if statuses["garden"].Status != "connected" {
		t.Fatalf("runtime did not connect: %+v", statuses)
	}
	server.URL = fmt.Sprintf("http://%s:%d/updated", host, port)
	server.Headers["Authorization"] = "Bearer changed-fake-secret"
	if err = store.SaveMCP(ctx, server, false); err != nil {
		t.Fatal(err)
	}
	active, err := store.RuntimeMCPServers(ctx, chat.ID)
	if err != nil || len(active) != 1 || active[0].Headers["Authorization"] != "Bearer fake-container-secret" {
		t.Fatal("running connection changed before restart", err)
	}
	if err = manager.Stop(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for closed.Load() < 1 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if closed.Load() < 1 {
		t.Fatal("runtime did not close its MCP connection")
	}
	if err = store.SaveEnvironment(ctx, "installation", "", []storage.EnvironmentChange{{Name: "SERVICE_TOKEN", Action: "replace", Value: "fake-updated-environment-token", Secret: true}}); err != nil {
		t.Fatal(err)
	}
	credential.Store("Bearer changed-fake-secret")
	endpoint, err = manager.Start(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	info, err = engine.ContainerInspect(ctx, endpoint.ContainerID)
	if err != nil {
		t.Fatal(err)
	}
	if info.EnvValue("SERVICE_TOKEN") != "fake-environment-token" {
		t.Fatal("MCP refresh changed the saved environment")
	}
	statuses = nil
	call("/mcp", &statuses)
	if statuses["garden"].Status != "connected" || initialized.Load() < 2 {
		t.Fatal("restart did not load updated MCP credentials")
	}
	active, err = store.RuntimeMCPServers(ctx, chat.ID)
	if err != nil || len(active) != 1 || active[0].URL != server.URL || active[0].Headers["Authorization"] != "Bearer changed-fake-secret" {
		t.Fatal("restart did not load updated endpoint and headers", err)
	}
	if err = store.DeleteMCP(ctx, server.Name); err != nil {
		t.Fatal(err)
	}
	if err = manager.Stop(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	endpoint, err = manager.Start(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	statuses = nil
	call("/mcp", &statuses)
	if len(statuses) != 0 {
		t.Fatal("restart retained removed MCP server")
	}
	if err = manager.Stop(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
}
