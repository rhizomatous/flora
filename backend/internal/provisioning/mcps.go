package provisioning

import (
	"context"
	"net/http"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
)

// disposeMCPs asks the running runtime to close its owned MCP connections before
// Docker stops it. Failure never prevents stopping the container itself.
func (m *Manager) disposeMCPs(ctx context.Context, chatID string, info docker.ContainerInfo) {
	servers, err := m.store.MCPServers(ctx, chatID)
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
