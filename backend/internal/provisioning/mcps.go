package provisioning

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"github.com/rhizomatous/flora/backend/internal/agentfiles"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"net/http"
	"os"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
)

// disposeMCPs asks the running runtime to close its owned MCP connections before
// Docker stops it. Failure never prevents stopping the container itself.
func (m *Manager) disposeMCPs(ctx context.Context, chatID string, info docker.ContainerInfo) {
	servers, err := m.store.RuntimeMCPServers(ctx, chatID)
	if err != nil || len(servers) == 0 || !info.State.Running {
		return
	}
	address := info.LoopbackAddress(runtimePort)
	if address == "" {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, "POST", "http://"+address+"/instance/dispose", nil)
	if err != nil {
		return
	}
	request.SetBasicAuth("opencode", info.EnvValue("OPENCODE_SERVER_PASSWORD"))
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	response, err := client.Do(request)
	if err == nil {
		response.Body.Close()
	}
}

// prepareMCPs replaces the runtime's managed configuration before a stopped
// container starts. Running containers keep their active connections until stop.
func (m *Manager) prepareMCPs(ctx context.Context, paths storage.Paths, uid, gid int) error {
	servers, err := m.store.MCPServers(ctx)
	if err != nil {
		return err
	}
	connections := map[string]any{}
	for _, server := range servers {
		connection := map[string]any{"type": "remote", "url": server.URL, "enabled": server.Enabled, "timeout": server.Timeout, "oauth": false}
		if len(server.Headers) > 0 {
			connection["headers"] = server.Headers
		}
		connections[server.Name] = connection
	}
	root, err := os.OpenRoot(paths.RuntimeState)
	if err != nil {
		return err
	}
	defer root.Close()
	config := map[string]json.RawMessage{}
	previous, readErr := agentfiles.Read(root, storage.MCPRuntimeFile, 2<<20)
	if readErr == nil {
		if err = json.Unmarshal(previous, &config); err != nil {
			return err
		}
		if config == nil {
			config = map[string]json.RawMessage{}
		}
	} else if !os.IsNotExist(readErr) {
		return readErr
	}
	config["mcp"], err = json.Marshal(connections)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(config)
	if err != nil {
		return err
	}
	if err = root.MkdirAll(".config/opencode", 0700); err != nil {
		return err
	}
	temporary := ".config/opencode/config-" + rand.Text()
	file, err := root.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer root.Remove(temporary)
	if _, err = file.Write(raw); err != nil {
		file.Close()
		return err
	}
	if os.Geteuid() == 0 {
		if err = file.Chown(uid, gid); err != nil {
			file.Close()
			return err
		}
		if err = root.Chown(".config", uid, gid); err != nil {
			file.Close()
			return err
		}
		if err = root.Chown(".config/opencode", uid, gid); err != nil {
			file.Close()
			return err
		}
	}
	if err = file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return root.Rename(temporary, storage.MCPRuntimeFile)
}
