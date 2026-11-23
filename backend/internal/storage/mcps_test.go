package storage

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

func TestMCPEncryptionRotationAndRestart(t *testing.T) {
	root := filepath.Join(t.TempDir(), "data")
	s := openTest(t, root)
	server := MCPServer{Name: "fixture", URL: "https://example.com/mcp", Enabled: true, Timeout: 1000, HeaderNames: []string{"Authorization"}, Headers: map[string]string{"Authorization": "Bearer fake-secret-123"}}
	must(t, s.SaveMCP(ctx, server, true))
	wantError(t, s.SaveMCP(ctx, server, true), ErrConflict)
	must(t, s.SaveEnvironment(ctx, "installation", "", []EnvironmentChange{{Name: "SERVICE_TOKEN", Action: "replace", Value: "fake-environment-secret", Secret: true}}))
	_, chat := fixture(t, s)
	var count int
	must(t, s.db.QueryRow("SELECT COUNT(*) FROM mcp_servers").Scan(&count))
	if count != 1 {
		t.Fatal("chat creation copied MCP records")
	}
	var config, headers string
	must(t, s.db.QueryRow("SELECT config,headers FROM mcp_servers").Scan(&config, &headers))
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
	server.Headers = nil
	must(t, s.SaveMCP(ctx, server, false))
	saved, err := s.MCPServers(ctx)
	must(t, err)
	if saved[0].Headers["Authorization"] != "Bearer rotated-fake-secret" {
		t.Fatal("blank replaced header")
	}
	must(t, s.RotateCredentialKey(ctx, filepath.Join(filepath.Dir(root), "rotated.key")))
	must(t, s.Close())
	s, err = OpenWithKeyFile(ctx, root, filepath.Join(filepath.Dir(root), "rotated.key"))
	must(t, err)
	defer s.Close()
	saved, err = s.MCPServers(ctx)
	must(t, err)
	if saved[0].Headers["Authorization"] != "Bearer rotated-fake-secret" {
		t.Fatal("rotation lost header")
	}
	environment, secrets, err := s.RuntimeEnvironment(ctx, chat.ID)
	must(t, err)
	if len(environment) != 1 || environment[0] != "SERVICE_TOKEN=fake-environment-secret" || len(secrets) != 1 || secrets[0] != "fake-environment-secret" {
		t.Fatal("MCP key rotation lost environment credentials")
	}
	must(t, s.DeleteMCP(ctx, "fixture"))
	saved, err = s.MCPServers(ctx)
	must(t, err)
	if len(saved) != 0 {
		t.Fatal("server not removed")
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

func TestMCPMigrationPreservesEnvironment(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	must(t, s.SaveEnvironment(ctx, "installation", "", []EnvironmentChange{{Name: "SERVICE_TOKEN", Action: "replace", Value: "fake-upgrade-secret", Secret: true}}))
	_, chat := fixture(t, s)
	entries, err := migrations.ReadDir("migrations")
	must(t, err)
	_, err = s.db.Exec("DROP TABLE mcp_servers")
	must(t, err)
	_, err = s.db.Exec(fmt.Sprintf("PRAGMA user_version=%d", migrationIndex(entries, "024_mcps.sql")))
	must(t, err)
	must(t, s.Close())
	s = openTest(t, root)
	servers, err := s.MCPServers(ctx)
	must(t, err)
	if len(servers) != 0 {
		t.Fatal("MCP migration created server records")
	}
	environment, _, err := s.RuntimeEnvironment(ctx, chat.ID)
	must(t, err)
	if len(environment) != 1 || environment[0] != "SERVICE_TOKEN=fake-upgrade-secret" {
		t.Fatal("MCP migration changed environment credentials")
	}
}
