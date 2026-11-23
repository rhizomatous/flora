package server

import (
	"errors"
	"net/http"

	"github.com/rhizomatous/flora/backend/internal/mcp"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func (a *api) mcpRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/mcps", func(w http.ResponseWriter, r *http.Request) {
		servers, err := a.settings.Store.MCPServers(r.Context())
		if err != nil {
			failure(w, 500, "MCP settings unavailable.")
			return
		}
		jsonResponse(w, 200, servers)
	})
	for _, method := range []string{"POST", "PUT"} {
		mux.HandleFunc(method+" /api/mcps", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Name        string            `json:"name"`
				URL         string            `json:"url"`
				Enabled     bool              `json:"enabled"`
				Timeout     int               `json:"timeout"`
				HeaderNames []string          `json:"headerNames"`
				Headers     map[string]string `json:"headers"`
			}
			if !decodeLimit(w, r, &in, 80<<10) {
				return
			}
			server := storage.MCPServer{Name: in.Name, URL: in.URL, Enabled: in.Enabled, Timeout: in.Timeout, HeaderNames: in.HeaderNames, Headers: in.Headers}
			if err := server.Validate(); err != nil {
				failure(w, 400, err.Error())
				return
			}
			if err := a.settings.Store.SaveMCP(r.Context(), server, r.Method == "POST"); err != nil {
				if errors.Is(err, storage.ErrConflict) {
					failure(w, 409, "A server with this name already exists.")
				} else if errors.Is(err, storage.ErrNotFound) {
					failure(w, 404, "Server no longer exists.")
				} else if errors.Is(err, storage.ErrMCPHeaders) || errors.Is(err, storage.ErrMCPLimit) {
					failure(w, 400, err.Error())
				} else {
					failure(w, 500, "MCP settings unavailable. Check storage and the credential encryption key.")
				}
				return
			}
			jsonResponse(w, 200, map[string]bool{"ok": true})
		})
	}
	mux.HandleFunc("DELETE /api/mcps/{name}", func(w http.ResponseWriter, r *http.Request) {
		if err := a.settings.Store.DeleteMCP(r.Context(), r.PathValue("name")); err != nil {
			failure(w, 500, "Could not remove MCP server.")
			return
		}
		jsonResponse(w, 200, map[string]bool{"ok": true})
	})
	check := func(w http.ResponseWriter, r *http.Request) {
		servers, err := a.settings.Store.MCPServers(r.Context())
		if err != nil {
			failure(w, 500, "MCP settings unavailable.")
			return
		}
		for _, server := range servers {
			if server.Name == r.PathValue("name") {
				jsonResponse(w, 200, mcp.Probe(r.Context(), server))
				return
			}
		}
		failure(w, 404, "Server no longer exists.")
	}

	mux.HandleFunc("POST /api/mcps/{name}/check", check)
}
