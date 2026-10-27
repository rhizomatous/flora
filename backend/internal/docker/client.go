// Package docker is a minimal Docker Engine API client over HTTP. It talks to
// the daemon socket directly; the Docker CLI is never required at runtime.
package docker

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// DefaultSocket is the standard Linux daemon socket. macOS hosts typically
// forward the same path to their VM (OrbStack and Docker Desktop both do).
const DefaultSocket = "/var/run/docker.sock"

// APIVersion is the minimum Engine API version this client targets
// (Docker 25.0 and later).
const APIVersion = "v1.44"

// maxErrorBody bounds daemon error messages read into memory.
const maxErrorBody = 1 << 20

type Client struct {
	http    *http.Client
	version string
}

// New returns a client for the daemon at socketPath. An empty socketPath uses
// DefaultSocket. The client targets APIVersion.
func New(socketPath string) *Client {
	if socketPath == "" {
		socketPath = DefaultSocket
	}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socketPath)
		},
	}
	return &Client{http: &http.Client{Transport: transport}, version: APIVersion}
}

// NewWithTransport builds a client on an arbitrary transport and API version.
// Tests use it to run against an in-process fake daemon.
func NewWithTransport(rt http.RoundTripper, apiVersion string) *Client {
	return &Client{http: &http.Client{Transport: rt}, version: apiVersion}
}

// Error is a daemon error response.
type Error struct {
	StatusCode int
	Message    string
}

func (e *Error) Error() string {
	return fmt.Sprintf("docker engine: status %d: %s", e.StatusCode, e.Message)
}

func IsNotFound(err error) bool {
	var e *Error
	return errors.As(err, &e) && e.StatusCode == http.StatusNotFound
}

// do issues one versioned API request. expected lists the success status
// codes; 304 Not Modified counts as success where the daemon uses it for
// idempotent start/stop.
func (c *Client) do(ctx context.Context, method, path string, query url.Values, body any, expected ...int) (json.RawMessage, error) {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(raw)
	}
	u := url.URL{Scheme: "http", Host: "docker", Path: "/" + c.version + path, RawQuery: query.Encode()}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	for _, code := range expected {
		if resp.StatusCode == code {
			return io.ReadAll(io.LimitReader(resp.Body, 64<<20))
		}
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBody))
	var parsed struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil || parsed.Message == "" {
		parsed.Message = strings.TrimSpace(string(raw))
	}
	return nil, &Error{StatusCode: resp.StatusCode, Message: parsed.Message}
}

// Ping verifies the daemon is reachable and speaks the Engine API.
func (c *Client) Ping(ctx context.Context) error {
	u := url.URL{Scheme: "http", Host: "docker", Path: "/_ping"}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("docker engine unreachable: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, maxErrorBody))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("docker engine ping: status %d", resp.StatusCode)
	}
	return nil
}

type Image struct {
	ID          string   `json:"Id"`
	RepoTags    []string `json:"RepoTags"`
	RepoDigests []string `json:"RepoDigests"`
}

// ImageInspect reads a local image by name:tag or name@digest reference.
func (c *Client) ImageInspect(ctx context.Context, ref string) (Image, error) {
	var img Image
	raw, err := c.do(ctx, http.MethodGet, "/images/"+url.PathEscape(ref)+"/json", nil, nil, http.StatusOK)
	if err != nil {
		return img, err
	}
	return img, json.Unmarshal(raw, &img)
}

// ImagePull pulls a reference from its registry and waits for completion.
// The reference may carry a tag or a digest.
func (c *Client) ImagePull(ctx context.Context, ref string) error {
	q := url.Values{}
	q.Set("fromImage", ref)
	raw, err := c.do(ctx, http.MethodPost, "/images/create", q, nil, http.StatusOK)
	if err != nil {
		return err
	}
	// The pull stream is newline-delimited progress JSON; an "error" entry
	// means the pull failed even though the HTTP status was 200.
	for _, line := range bytes.Split(raw, []byte("\n")) {
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var entry struct {
			Error string `json:"error"`
		}
		if err := json.Unmarshal(line, &entry); err == nil && entry.Error != "" {
			return fmt.Errorf("docker image pull: %s", entry.Error)
		}
	}
	return nil
}

// ContainerSpec describes one container to create. Only the fields Flora sets
// are modeled; everything else takes the daemon's defaults. In particular the
// daemon keeps privileged mode off, its default capability set, its default
// bridge network with outbound access, and no host namespace or device sharing.
type ContainerSpec struct {
	Name   string
	Image  string
	Env    []string
	Labels map[string]string
	// Binds are "hostPath:containerPath" bind mounts. Never include the
	// daemon socket, host root, or another chat's directories.
	Binds []string
	// LoopbackPort publishes that container TCP port on an ephemeral
	// loopback-only host port. Zero publishes nothing.
	LoopbackPort int
	NanoCPUs     int64
	MemoryBytes  int64
	PidsLimit    int64
}

type createBody struct {
	Image        string              `json:"Image"`
	Env          []string            `json:"Env,omitempty"`
	Labels       map[string]string   `json:"Labels,omitempty"`
	ExposedPorts map[string]struct{} `json:"ExposedPorts,omitempty"`
	HostConfig   hostConfig          `json:"HostConfig"`
}

type hostConfig struct {
	Binds        []string                 `json:"Binds,omitempty"`
	NanoCPUs     int64                    `json:"NanoCPUs,omitempty"`
	Memory       int64                    `json:"Memory,omitempty"`
	PidsLimit    int64                    `json:"PidsLimit,omitempty"`
	PortBindings map[string][]portBinding `json:"PortBindings,omitempty"`
}

type portBinding struct {
	HostIP   string `json:"HostIp"`
	HostPort string `json:"HostPort"`
}

// ContainerCreate creates a stopped container and returns its ID.
func (c *Client) ContainerCreate(ctx context.Context, spec ContainerSpec) (string, error) {
	body := createBody{
		Image:  spec.Image,
		Env:    spec.Env,
		Labels: spec.Labels,
		HostConfig: hostConfig{
			Binds:     spec.Binds,
			NanoCPUs:  spec.NanoCPUs,
			Memory:    spec.MemoryBytes,
			PidsLimit: spec.PidsLimit,
		},
	}
	if spec.LoopbackPort > 0 {
		port := strconv.Itoa(spec.LoopbackPort) + "/tcp"
		body.ExposedPorts = map[string]struct{}{port: {}}
		// An empty HostPort asks the daemon for an ephemeral port on 127.0.0.1.
		body.HostConfig.PortBindings = map[string][]portBinding{port: {{HostIP: "127.0.0.1", HostPort: ""}}}
	}
	q := url.Values{}
	q.Set("name", spec.Name)
	raw, err := c.do(ctx, http.MethodPost, "/containers/create", q, body, http.StatusCreated)
	if err != nil {
		return "", err
	}
	var created struct {
		ID string `json:"Id"`
	}
	if err := json.Unmarshal(raw, &created); err != nil || created.ID == "" {
		return "", fmt.Errorf("docker container create: invalid response")
	}
	return created.ID, nil
}

// ContainerStart starts a stopped container. Starting an already running
// container is a no-op.
func (c *Client) ContainerStart(ctx context.Context, id string) error {
	_, err := c.do(ctx, http.MethodPost, "/containers/"+url.PathEscape(id)+"/start", nil, nil, http.StatusNoContent, http.StatusNotModified)
	return err
}

// ContainerStop stops a running container, giving it timeoutSeconds before
// SIGKILL. Stopping an already stopped container is a no-op.
func (c *Client) ContainerStop(ctx context.Context, id string, timeoutSeconds int) error {
	q := url.Values{}
	q.Set("t", strconv.Itoa(timeoutSeconds))
	_, err := c.do(ctx, http.MethodPost, "/containers/"+url.PathEscape(id)+"/stop", q, nil, http.StatusNoContent, http.StatusNotModified)
	return err
}

// ContainerKill sends a signal to a running container.
func (c *Client) ContainerKill(ctx context.Context, id, signal string) error {
	q := url.Values{}
	q.Set("signal", signal)
	_, err := c.do(ctx, http.MethodPost, "/containers/"+url.PathEscape(id)+"/kill", q, nil, http.StatusNoContent)
	return err
}

// ContainerRemove removes a container. force kills it first if running.
func (c *Client) ContainerRemove(ctx context.Context, id string, force bool) error {
	q := url.Values{}
	if force {
		q.Set("force", "true")
	}
	_, err := c.do(ctx, http.MethodDelete, "/containers/"+url.PathEscape(id), q, nil, http.StatusNoContent)
	return err
}

type ContainerState struct {
	Status   string `json:"Status"`
	Running  bool   `json:"Running"`
	ExitCode int    `json:"ExitCode"`
}

type ContainerInfo struct {
	ID     string         `json:"Id"`
	Name   string         `json:"Name"`
	State  ContainerState `json:"State"`
	Config struct {
		Env    []string          `json:"Env"`
		Labels map[string]string `json:"Labels"`
	} `json:"Config"`
	HostConfig struct {
		Binds      []string `json:"Binds"`
		Privileged bool     `json:"Privileged"`
		NanoCPUs   int64    `json:"NanoCPUs"`
		Memory     int64    `json:"Memory"`
		PidsLimit  int64    `json:"PidsLimit"`
	} `json:"HostConfig"`
	NetworkSettings struct {
		Ports map[string][]struct {
			HostIP   string `json:"HostIp"`
			HostPort string `json:"HostPort"`
		} `json:"Ports"`
	} `json:"NetworkSettings"`
}

// ContainerInspect reads one container's full state and configuration.
func (c *Client) ContainerInspect(ctx context.Context, id string) (ContainerInfo, error) {
	var info ContainerInfo
	raw, err := c.do(ctx, http.MethodGet, "/containers/"+url.PathEscape(id)+"/json", nil, nil, http.StatusOK)
	if err != nil {
		return info, err
	}
	return info, json.Unmarshal(raw, &info)
}

// LoopbackAddress returns the host loopback host:port publishing the given
// container port, or "" when the port is not published.
func (info ContainerInfo) LoopbackAddress(containerPort int) string {
	for _, binding := range info.NetworkSettings.Ports[strconv.Itoa(containerPort)+"/tcp"] {
		if binding.HostIP == "127.0.0.1" || binding.HostIP == "0.0.0.0" || binding.HostIP == "" {
			return net.JoinHostPort("127.0.0.1", binding.HostPort)
		}
	}
	return ""
}

// EnvValue returns the value of a NAME=value entry from the container's
// configured environment, or "" when absent.
func (info ContainerInfo) EnvValue(name string) string {
	prefix := name + "="
	for _, entry := range info.Config.Env {
		if strings.HasPrefix(entry, prefix) {
			return strings.TrimPrefix(entry, prefix)
		}
	}
	return ""
}

type ContainerSummary struct {
	ID     string            `json:"Id"`
	Names  []string          `json:"Names"`
	Image  string            `json:"Image"`
	State  string            `json:"State"`
	Labels map[string]string `json:"Labels"`
}

// ContainerList lists containers matching every label filter. When running is
// true, only running containers match.
func (c *Client) ContainerList(ctx context.Context, running bool, labels map[string]string) ([]ContainerSummary, error) {
	filters := map[string][]string{"label": {}}
	for k, v := range labels {
		filters["label"] = append(filters["label"], k+"="+v)
	}
	if running {
		filters["status"] = []string{"running"}
	}
	encoded, err := json.Marshal(filters)
	if err != nil {
		return nil, err
	}
	q := url.Values{}
	q.Set("all", "true")
	q.Set("filters", string(encoded))
	raw, err := c.do(ctx, http.MethodGet, "/containers/json", q, nil, http.StatusOK)
	if err != nil {
		return nil, err
	}
	var list []ContainerSummary
	return list, json.Unmarshal(raw, &list)
}

// NewPassword returns a random per-container endpoint password.
func NewPassword() (string, error) {
	var raw [24]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw[:]), nil
}
