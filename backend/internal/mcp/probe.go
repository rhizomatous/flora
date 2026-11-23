// Package mcp checks Streamable HTTP connections without invoking tools.
package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/rhizomatous/flora/backend/internal/redaction"
	"github.com/rhizomatous/flora/backend/internal/storage"
	sse "github.com/tmaxmax/go-sse"
)

type Diagnostic struct {
	Name    string   `json:"name"`
	Status  string   `json:"status"`
	Message string   `json:"message"`
	Tools   []string `json:"tools"`
}

var normalize = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

type connection struct {
	client           *http.Client
	server           storage.MCPServer
	session, version string
	id               int
}

func (c *connection) request(ctx context.Context, method string, body any) (*http.Response, error) {
	var data io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		data = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.server.URL, data)
	if err != nil {
		return nil, errors.New("Invalid endpoint.")
	}
	for k, v := range c.server.Headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if c.session != "" {
		req.Header.Set("Mcp-Session-Id", c.session)
	}
	if c.version != "" {
		req.Header.Set("MCP-Protocol-Version", c.version)
	}
	res, err := c.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, errors.New("Connection or tool discovery timed out. Increase the timeout or check the server.")
		}
		return nil, errors.New("Server unreachable. Check the endpoint, networking and TLS certificate.")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		res.Body.Close()
		switch res.StatusCode {
		case 401, 403:
			return nil, errors.New("Credentials rejected. Check the saved headers and server permissions.")
		case 404, 405:
			return nil, errors.New("Streamable HTTP endpoint unavailable. Check the URL and transport.")
		}
		return nil, fmt.Errorf("Server rejected the connection (HTTP %d).", res.StatusCode)
	}
	return res, nil
}
func (c *connection) call(ctx context.Context, method string, params any, out any) (err error) {
	defer func() {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			err = errors.New("Connection or tool discovery timed out. Increase the timeout or check the server.")
		}
	}()

	c.id++
	id := c.id
	res, err := c.request(ctx, "POST", map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if method == "initialize" {
		c.session = res.Header.Get("Mcp-Session-Id")
	}
	type envelope struct {
		ID     int             `json:"id"`
		Result json.RawMessage `json:"result"`
		Error  json.RawMessage `json:"error"`
	}
	var value envelope
	reader := io.LimitReader(res.Body, 1<<20)
	if strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		found := false
		for event, e := range sse.Read(reader, &sse.ReadConfig{MaxEventSize: 1 << 20}) {
			if e != nil {
				return errors.New("Incomplete tool server response.")
			}
			if json.Unmarshal([]byte(event.Data), &value) == nil && value.ID == id {
				found = true
				break
			}
		}
		if !found {
			return errors.New("Server did not answer the MCP request.")
		}
	} else if json.NewDecoder(reader).Decode(&value) != nil {
		return errors.New("Invalid MCP response. Check the endpoint and transport.")
	}
	if value.ID != id || len(value.Error) > 0 || len(value.Result) == 0 {
		return errors.New("MCP request rejected. Check protocol and tool-discovery permissions.")
	}
	if json.Unmarshal(value.Result, out) != nil {
		return errors.New("Invalid tool-discovery response.")
	}
	return nil
}

// Probe uses a short-lived MCP session and always attempts session termination.
// Vendor bodies, transport errors, URLs and credentials never enter diagnostics.
func Probe(ctx context.Context, server storage.MCPServer) (d Diagnostic) {
	defer func() {
		var secrets []string
		for _, value := range server.Headers {
			secrets = append(secrets, value, normalize.ReplaceAllString(value, "_"))
		}
		for i, tool := range d.Tools {
			d.Tools[i] = redaction.Text(tool, secrets...)
		}
	}()
	d = Diagnostic{Name: server.Name, Status: "disabled", Message: "Disabled", Tools: []string{}}
	if !server.Enabled {
		return d
	}
	d.Status = "failed"
	if err := server.Validate(); err != nil {
		d.Message = err.Error()
		return d
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(server.Timeout)*time.Millisecond)
	defer cancel()
	c := &connection{server: server, client: &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	defer c.client.CloseIdleConnections()
	defer func() {
		if c.session != "" {
			cleanup, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			res, _ := c.request(cleanup, "DELETE", nil)
			if res != nil {
				res.Body.Close()
			}
		}
	}()
	var init struct {
		ProtocolVersion string `json:"protocolVersion"`
		Capabilities    struct {
			Tools json.RawMessage `json:"tools"`
		} `json:"capabilities"`
	}
	if err := c.call(ctx, "initialize", map[string]any{"protocolVersion": "2025-11-25", "capabilities": map[string]any{}, "clientInfo": map[string]string{"name": "flora-check", "version": "1"}}, &init); err != nil {
		d.Message = err.Error()
		return d
	}
	if init.ProtocolVersion != "2024-10-07" && init.ProtocolVersion != "2024-11-05" && init.ProtocolVersion != "2025-03-26" && init.ProtocolVersion != "2025-06-18" && init.ProtocolVersion != "2025-11-25" {
		d.Message = "Unsupported MCP protocol version."
		return d
	}
	c.version = init.ProtocolVersion
	res, err := c.request(ctx, "POST", map[string]any{"jsonrpc": "2.0", "method": "notifications/initialized"})
	if err != nil {
		d.Message = err.Error()
		return d
	}
	res.Body.Close()
	if len(init.Capabilities.Tools) == 0 {
		d.Message = "Server does not offer tools."
		return d
	}
	seen := map[string]bool{}
	cursor := ""
	for page := 0; page < 16; page++ {
		var list struct {
			Tools []struct {
				Name string `json:"name"`
			} `json:"tools"`
			NextCursor string `json:"nextCursor"`
		}
		params := map[string]string{}
		if cursor != "" {
			params["cursor"] = cursor
		}
		if err = c.call(ctx, "tools/list", params, &list); err != nil {
			d.Message = "Tool discovery failed. " + err.Error()
			return d
		}
		for _, tool := range list.Tools {
			key := normalize.ReplaceAllString(tool.Name, "_")
			if tool.Name == "" || len(tool.Name) > 128 || seen[key] {
				d.Message = "Tool names collide or are invalid after runtime normalization. Rename the tools on the server."
				d.Tools = []string{}
				return d
			}
			seen[key] = true
			d.Tools = append(d.Tools, server.Name+"_"+key)
			if len(d.Tools) > 512 {
				d.Message = "Server exceeds the 512-tool limit."
				d.Tools = []string{}
				return d
			}
		}
		if list.NextCursor == "" {
			if len(d.Tools) == 0 {
				d.Message = "Server connected but no tools are available. Check tool permissions."
				return d
			}
			d.Status = "connected"
			d.Message = fmt.Sprintf("Connected · %d tools", len(d.Tools))
			return d
		}
		cursor = list.NextCursor
	}
	d.Message = "Tool discovery exceeded the page limit."
	return d
}
