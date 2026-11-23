package storage

import (
	"context"
	"encoding/json"
	"os"
	"sort"

	"github.com/rhizomatous/flora/backend/internal/agentfiles"
)

const MCPRuntimeFile = ".config/opencode/opencode.json"

// RuntimeMCPServers reads the active runtime's connection file for validation and
// credential redaction. Installation settings replace this file on the next start.
func (s *Store) RuntimeMCPServers(ctx context.Context, chatID string) ([]MCPServer, error) {
	paths, err := s.Paths(ctx, chatID)
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(paths.RuntimeState)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	raw, err := agentfiles.Read(root, MCPRuntimeFile, 2<<20)
	if os.IsNotExist(err) {
		return s.MCPServers(ctx)
	}
	if err != nil {
		return nil, err
	}
	var config struct {
		MCP map[string]struct {
			URL     string            `json:"url"`
			Enabled bool              `json:"enabled"`
			Timeout int               `json:"timeout"`
			Headers map[string]string `json:"headers"`
		} `json:"mcp"`
	}
	if err = json.Unmarshal(raw, &config); err != nil {
		return nil, ErrInvalid
	}
	servers := []MCPServer{}
	for name, value := range config.MCP {
		server := MCPServer{Name: name, URL: value.URL, Enabled: value.Enabled, Timeout: value.Timeout, Headers: value.Headers, HeaderNames: []string{}}
		for name := range value.Headers {
			server.HeaderNames = append(server.HeaderNames, name)
		}
		sort.Strings(server.HeaderNames)
		if server.Validate() != nil {
			return nil, ErrInvalid
		}
		servers = append(servers, server)
	}
	sort.Slice(servers, func(i, j int) bool { return servers[i].Name < servers[j].Name })
	return servers, nil
}
