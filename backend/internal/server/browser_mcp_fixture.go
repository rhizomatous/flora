//go:build browserfixture

package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func seedMCPBrowser(ctx context.Context, store *storage.Store) (func(), error) {
	fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/denied" {
			w.WriteHeader(401)
			return
		}
		if r.Header.Get("Authorization") != "Bearer fixture-only-token" {
			w.WriteHeader(403)
			return
		}
		if r.Method == "DELETE" {
			w.WriteHeader(204)
			return
		}
		var input struct {
			ID     int    `json:"id"`
			Method string `json:"method"`
		}
		if json.NewDecoder(r.Body).Decode(&input) != nil {
			w.WriteHeader(400)
			return
		}
		if input.Method == "notifications/initialized" {
			w.WriteHeader(202)
			return
		}
		var result any
		switch input.Method {
		case "initialize":
			result = map[string]any{"serverInfo": map[string]string{"name": "fixture", "version": "1"}, "protocolVersion": "2025-03-26", "capabilities": map[string]any{"tools": map[string]any{}}}
			w.Header().Set("Mcp-Session-Id", "fixture-only-session")
		case "tools/list":
			result = map[string]any{"tools": []map[string]any{{"name": "read_notes", "description": "Read fixture garden notes", "inputSchema": map[string]any{"type": "object"}}, {"name": "find_plants", "description": "Find plants in fixture data", "inputSchema": map[string]any{"type": "object"}}}}
		default:
			w.WriteHeader(404)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": input.ID, "result": result})
	}))
	for _, record := range []struct{ name, path string }{{"garden-fixture", "/mcp"}, {"credentials-fixture", "/denied"}} {
		err := store.SaveMCP(ctx, storage.MCPServer{Name: record.name, URL: fixture.URL + record.path, Enabled: true, Timeout: 5000, HeaderNames: []string{"Authorization"}, Headers: map[string]string{"Authorization": "Bearer fixture-only-token"}}, true)
		if err != nil {
			fixture.Close()
			return nil, err
		}
	}
	return fixture.Close, nil
}
