package chat

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"strings"
	"time"

	"github.com/rhizomatous/flora/backend/internal/mcp"
)

// checkMCPs verifies original tool identities before the runtime normalizes them,
// then checks the runtime's own connections from inside the chat container.
func (s *Service) checkMCPs(ctx context.Context, rt *runtime, chatID string) (string, error) {
	servers, err := s.Store.MCPServers(ctx, chatID)
	if err != nil {
		return "MCP credentials unavailable.", err
	}
	enabled := false
	for _, server := range servers {
		if !server.Enabled {
			continue
		}
		enabled = true
		result := mcp.Probe(ctx, server)
		raw, _ := json.Marshal(result)
		_ = s.Store.AppendActivity(ctx, chatID, rand.Text(), "mcp", raw)
		if result.Status != "connected" {
			return server.Name + ": " + result.Message, nil
		}
	}
	if !enabled {
		return "", nil
	}
	check, cancel := context.WithTimeout(ctx, 95*time.Second)
	defer cancel()
	var statuses map[string]struct {
		Status string `json:"status"`
		Error  string `json:"error"`
	}
	if err = rt.call(check, "GET", "/mcp", nil, &statuses); err != nil {
		return "MCP runtime connection check failed. Check container networking and restart the chat.", nil
	}
	for _, server := range servers {
		if !server.Enabled {
			continue
		}
		status := statuses[server.Name]
		if status.Status != "connected" {
			message := "Runtime could not connect. Check container networking, endpoint and credentials."
			lower := strings.ToLower(status.Error)
			switch {
			case strings.Contains(lower, "401") || strings.Contains(lower, "403") || status.Status == "needs_auth":
				message = "Runtime credentials rejected. Check server permissions."
			case strings.Contains(lower, "timeout") || strings.Contains(lower, "timed out"):
				message = "Runtime connection timed out. Check container networking and the server timeout."
			case strings.Contains(lower, "tools"):
				message = "Runtime tool discovery failed. Check tool permissions."
			}
			return server.Name + ": " + message, nil
		}
	}
	return "", nil
}
