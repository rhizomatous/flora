package storage

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestMCPSnapshotEncryptionRotationAndRestart(t *testing.T) {
	root := filepath.Join(t.TempDir(), "data")
	s := openTest(t, root)
	server := MCPServer{Name: "fixture", URL: "http://127.0.0.1:1234/mcp", Enabled: true, Timeout: 1000, HeaderNames: []string{"Authorization"}, Headers: map[string]string{"Authorization": "Bearer fake-secret-123"}}
	must(t, s.SaveMCP(ctx, server, true))
	wantError(t, s.SaveMCP(ctx, server, true), ErrConflict)
	p, c := fixture(t, s)
	var config, headers string
	must(t, s.db.QueryRow("SELECT config,headers FROM mcp_servers WHERE scope='defaults'").Scan(&config, &headers))
	if strings.Contains(config, "fake-secret") || strings.Contains(headers, "fake-secret") || !strings.HasPrefix(headers, "flora:v1:") {
		t.Fatal("plaintext credential saved")
	}
	raw, _ := json.Marshal(server)
	if strings.Contains(string(raw), "fake-secret") {
		t.Fatal("secret exposed by JSON")
	}
	server.URL = "https://new.example/mcp"
	server.Headers = map[string]string{"Authorization": "Bearer rotated-fake-secret"}
	must(t, s.SaveMCP(ctx, server, false))
	c2, err := s.CreateChat(ctx, p.ID, "New defaults", image, "1.2.27")
	must(t, err)
	first, err := s.MCPServers(ctx, c.ID)
	must(t, err)
	second, err := s.MCPServers(ctx, c2.ID)
	must(t, err)
	if first[0].Headers["Authorization"] != "Bearer fake-secret-123" || first[0].URL == second[0].URL {
		t.Fatal("snapshot changed with defaults")
	}
	server.Headers = nil
	must(t, s.SaveMCP(ctx, server, false))
	saved, err := s.MCPServers(ctx, "")
	must(t, err)
	if saved[0].Headers["Authorization"] != "Bearer rotated-fake-secret" {
		t.Fatal("blank replaced saved header")
	}
	must(t, s.RotateCredentialKey(ctx, filepath.Join(filepath.Dir(root), "rotated.key")))
	must(t, s.Close())
	s, err = OpenWithKeyFile(ctx, root, filepath.Join(filepath.Dir(root), "rotated.key"))
	must(t, err)
	defer s.Close()
	first, err = s.MCPServers(ctx, c.ID)
	must(t, err)
	if first[0].Headers["Authorization"] != "Bearer fake-secret-123" {
		t.Fatal("rotation lost snapshot")
	}
	must(t, s.DeleteMCP(ctx, "fixture"))
	first, err = s.MCPServers(ctx, c.ID)
	must(t, err)
	if len(first) != 1 {
		t.Fatal("default deletion changed snapshot")
	}
	must(t, s.db.QueryRow("SELECT headers FROM mcp_servers WHERE scope=?", "chat:"+c.ID).Scan(&headers))
	_, err = s.db.Exec("UPDATE mcp_servers SET headers=? WHERE scope=?", headers, "chat:"+c2.ID)
	must(t, err)
	_, err = s.MCPServers(ctx, c2.ID)
	if !errors.Is(err, ErrSecrets) {
		t.Fatal("cross-record ciphertext accepted")
	}
	must(t, s.Close())
	_, err = OpenWithKeyFile(ctx, root, filepath.Join(filepath.Dir(root), "rotated.key"))
	if !errors.Is(err, ErrSecrets) {
		t.Fatal("startup accepted modified MCP ciphertext")
	}
}
func TestMCPValidation(t *testing.T) {
	base := MCPServer{Name: "fixture", URL: "https://example.com/mcp", Timeout: 5000, HeaderNames: []string{}}
	for _, mutate := range []func(*MCPServer){func(m *MCPServer) { m.Name = "bad_name" }, func(m *MCPServer) { m.URL = "https://user:pass@example.com" }, func(m *MCPServer) { m.URL = "https://example.com?token=secret" }, func(m *MCPServer) { m.Timeout = 999 }, func(m *MCPServer) { m.HeaderNames = []string{"authorization", "Authorization"} }, func(m *MCPServer) { m.HeaderNames = []string{"Content-Length"} }, func(m *MCPServer) {
		m.HeaderNames = []string{"Authorization"}
		m.Headers = map[string]string{"Authorization": "{env:SECRET}"}
	}} {
		m := base
		mutate(&m)
		if m.Validate() == nil {
			t.Fatalf("accepted invalid configuration: %+v", m)
		}
	}
}

func TestMCPConfigIntegrityAndMissingVerifier(t *testing.T) {
	for _, change := range []string{"endpoint", "verifier"} {
		t.Run(change, func(t *testing.T) {
			root := t.TempDir()
			s := openTest(t, root)
			server := MCPServer{Name: "private-tools", URL: "https://example.com/mcp", Enabled: true, Timeout: 5000}
			must(t, s.SaveMCP(ctx, server, true))
			if change == "endpoint" {
				_, err := s.db.Exec(`UPDATE mcp_servers SET config=replace(config,'example.com','attacker.invalid')`)
				must(t, err)
			} else {
				_, err := s.db.Exec("DELETE FROM credential_encryption")
				must(t, err)
			}
			must(t, s.Close())
			reopened, err := Open(ctx, root)
			if err == nil {
				reopened.Close()
				t.Fatal("startup accepted modified MCP configuration or missing key verifier")
			}
		})
	}
}
