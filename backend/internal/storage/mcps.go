package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// MCPServer describes one Streamable HTTP connection. Header values are held in
// encrypted records and never included in browser-readable configuration.
type MCPServer struct {
	Name        string            `json:"name"`
	URL         string            `json:"url"`
	Enabled     bool              `json:"enabled"`
	Timeout     int               `json:"timeout"`
	HeaderNames []string          `json:"headerNames"`
	Headers     map[string]string `json:"-"`
}

var ErrMCPHeaders = errors.New("Enter a value for each new header.")
var ErrMCPLimit = errors.New("Use at most 16 MCP servers.")

var mcpName = regexp.MustCompile(`^[a-z][a-z0-9-]{0,47}$`)
var mcpHeader = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9-]{0,63}$`)

func (m MCPServer) Validate() error {
	if m.Name == "new" {
		return errors.New("Choose a server name other than new.")
	}
	if !mcpName.MatchString(m.Name) {
		return errors.New("Use a server name of 1 to 48 lowercase letters, numbers or hyphens, starting with a letter.")
	}
	u, err := url.Parse(m.URL)
	if err != nil || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(m.URL) > 2048 || strings.Contains(m.URL, "{") {
		return errors.New("Enter an HTTP or HTTPS endpoint without credentials, query parameters or substitutions.")
	}
	if m.Timeout < 1000 || m.Timeout > 30000 {
		return errors.New("Timeout must be between 1000 and 30000 milliseconds.")
	}
	if len(m.HeaderNames) > 16 || len(m.Headers) > 16 {
		return errors.New("Use at most 16 headers.")
	}
	seen := map[string]bool{}
	for _, name := range m.HeaderNames {
		key := http.CanonicalHeaderKey(name)
		if !mcpHeader.MatchString(name) || seen[key] || key == "Host" || key == "Content-Length" || key == "Connection" || key == "Accept" || key == "Content-Type" || strings.HasPrefix(key, "Mcp-") {
			return errors.New("Use unique HTTP header names; transport headers are reserved.")
		}
		seen[key] = true
	}
	for name, value := range m.Headers {
		exact := false
		for _, configured := range m.HeaderNames {
			if configured == name {
				exact = true
			}
		}
		if !exact || len(value) > 4096 || strings.ContainsAny(value, "\r\n\x00{") {
			return errors.New("Enter a header value of at most 4096 bytes without line breaks or substitutions.")
		}
	}
	return nil
}
func mcpIdentity(name, config string) string {
	b, _ := json.Marshal([]string{"mcp_servers", name, config})
	return string(b)
}
func readMCPs(ctx context.Context, db interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, box *secretBox) ([]MCPServer, error) {
	rows, err := db.QueryContext(ctx, "SELECT name,config,headers FROM mcp_servers ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []MCPServer{}
	for rows.Next() {
		var name, config, sealed string
		if err = rows.Scan(&name, &config, &sealed); err != nil {
			return nil, err
		}
		var m MCPServer
		if err = json.Unmarshal([]byte(config), &m); err != nil {
			return nil, err
		}
		if m.Name != name || m.Validate() != nil {
			return nil, ErrSecrets
		}
		plain, e := box.open(sealed, mcpIdentity(name, config))
		if e != nil {
			return nil, e
		}
		if err = json.Unmarshal([]byte(plain), &m.Headers); err != nil {
			return nil, ErrSecrets
		}
		result = append(result, m)
	}
	return result, rows.Err()
}
func (s *Store) MCPServers(ctx context.Context) ([]MCPServer, error) {
	s.secretMu.Lock()
	defer s.secretMu.Unlock()
	return readMCPs(ctx, s.db, s.secrets)
}
func writeMCP(ctx context.Context, tx *sql.Tx, box *secretBox, m MCPServer) error {
	raw, _ := json.Marshal(m)
	headers, _ := json.Marshal(m.Headers)
	_, err := tx.ExecContext(ctx, `INSERT INTO mcp_servers(name,config,headers) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET config=excluded.config,headers=excluded.headers`, m.Name, string(raw), box.seal(string(headers), mcpIdentity(m.Name, string(raw))))
	return err
}

// SaveMCP preserves a saved header when its name is retained and its input is
// blank. Removing a header name explicitly deletes that credential.
func (s *Store) SaveMCP(ctx context.Context, m MCPServer, create bool) error {
	if err := m.Validate(); err != nil {
		return err
	}
	s.secretMu.Lock()
	defer s.secretMu.Unlock()
	return s.write(ctx, func(tx *sql.Tx) error {
		all, err := readMCPs(ctx, tx, s.secrets)
		if err != nil {
			return err
		}
		exists := false
		for _, old := range all {
			if old.Name == m.Name {
				exists = true
				for _, name := range m.HeaderNames {
					if m.Headers[name] == "" {
						if m.Headers == nil {
							m.Headers = map[string]string{}
						}
						m.Headers[name] = old.Headers[name]
					}
				}
			}
		}
		if create && exists {
			return ErrConflict
		}
		if !create && !exists {
			return ErrNotFound
		}
		if create && len(all) >= 16 {
			return ErrMCPLimit
		}
		for _, name := range m.HeaderNames {
			if m.Headers[name] == "" {
				return ErrMCPHeaders
			}
		}
		return writeMCP(ctx, tx, s.secrets, m)
	})
}
func (s *Store) DeleteMCP(ctx context.Context, name string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM mcp_servers WHERE name=?", name)
	return err
}

func (s *Store) validateMCPSecrets(ctx context.Context) error {
	_, err := readMCPs(ctx, s.db, s.secrets)
	return err
}
func rotateMCPs(ctx context.Context, tx *sql.Tx, old, next *secretBox) error {
	all, err := readMCPs(ctx, tx, old)
	if err != nil {
		return err
	}
	for _, m := range all {
		if err = writeMCP(ctx, tx, next, m); err != nil {
			return err
		}
	}
	return nil
}
