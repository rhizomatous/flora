package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestProbeFixtures(t *testing.T) {
	for _, mode := range []string{"json", "sse", "auth", "empty", "tools-error", "collision", "timeout", "redirect", "invalid", "pages"} {
		t.Run(mode, func(t *testing.T) {
			var closed atomic.Bool
			fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "DELETE" {
					closed.Store(true)
					w.WriteHeader(204)
					return
				}
				if mode == "auth" {
					w.WriteHeader(401)
					w.Write([]byte("Bearer fake-private-secret"))
					return
				}
				if mode == "redirect" {
					http.Redirect(w, r, "http://127.0.0.1:1/leak", 302)
					return
				}
				if mode == "timeout" {
					select {
					case <-r.Context().Done():
					case <-time.After(1200 * time.Millisecond):
					}
					return
				}
				if mode == "invalid" {
					w.Write([]byte("Bearer fake-private-secret"))
					return
				}
				var req struct {
					ID     int    `json:"id"`
					Method string `json:"method"`
				}
				json.NewDecoder(r.Body).Decode(&req)
				if req.Method == "notifications/initialized" {
					w.WriteHeader(202)
					return
				}
				var result any = map[string]any{"serverInfo": map[string]string{"name": "fixture", "version": "1"}, "protocolVersion": "2025-03-26", "capabilities": map[string]any{"tools": map[string]any{}}}
				if req.Method == "initialize" {
					w.Header().Set("Mcp-Session-Id", "fixture-session")
				}
				if req.Method == "tools/list" {
					if r.Header.Get("Mcp-Session-Id") != "fixture-session" {
						t.Error("missing session")
					}
					tools := []map[string]any{{"name": "read", "inputSchema": map[string]any{"type": "object"}}}
					switch mode {
					case "empty":
						tools = nil
					case "collision":
						tools = []map[string]any{{"name": "read.file"}, {"name": "read_file"}}
					case "tools-error":
						w.WriteHeader(403)
						return
					}
					result = map[string]any{"tools": tools}
					if mode == "pages" {
						result = map[string]any{"tools": tools, "nextCursor": "repeat"}
					}
				}
				b, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
				if mode == "sse" {
					w.Header().Set("Content-Type", "text/event-stream")
					w.Write([]byte("event: message\ndata: " + string(b) + "\n\n"))
				} else {
					w.Header().Set("Content-Type", "application/json")
					w.Write(b)
				}
			}))
			defer fixture.Close()
			d := Probe(context.Background(), storage.MCPServer{Name: "fixture", URL: fixture.URL, Enabled: true, Timeout: 1000, HeaderNames: []string{"Authorization"}, Headers: map[string]string{"Authorization": "Bearer fake-private-secret"}})
			if strings.Contains(d.Message, "fake-private-secret") {
				t.Fatal("secret leaked")
			}
			if mode == "json" || mode == "sse" {
				if d.Status != "connected" || len(d.Tools) != 1 || !closed.Load() {
					t.Fatalf("bad success/cleanup: %+v closed=%v", d, closed.Load())
				}
			} else {
				if d.Status != "failed" || d.Message == "" {
					t.Fatalf("missing failure: %+v", d)
				}
			}
		})
	}
	t.Run("unreachable", func(t *testing.T) {
		s := httptest.NewServer(http.NotFoundHandler())
		url := s.URL
		s.Close()
		d := Probe(context.Background(), storage.MCPServer{Name: "fixture", URL: url, Enabled: true, Timeout: 1000})
		if !strings.Contains(d.Message, "unreachable") {
			t.Fatal(d)
		}
	})
	t.Run("disabled", func(t *testing.T) {
		start := time.Now()
		d := Probe(context.Background(), storage.MCPServer{Name: "fixture"})
		if d.Status != "disabled" || time.Since(start) > time.Second {
			t.Fatal(d)
		}
	})
}
