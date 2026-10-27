// Package docker adapts the Docker Go SDK to Flora's provisioning operations.
// It connects to the daemon socket without requiring the Docker CLI at runtime.
package docker

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"

	"github.com/containerd/errdefs"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/network"
	"github.com/moby/moby/client"
)

const DefaultSocket = "/var/run/docker.sock"

// APIVersion pins the supported daemon contract to Docker 25.0 and later.
const APIVersion = "1.44"

type Client struct {
	sdk *client.Client
}

// New connects to socketPath, or DefaultSocket when empty. It does not read
// Docker environment overrides, so callers always select the daemon explicitly.
func New(socketPath string) (*Client, error) {
	if socketPath == "" {
		socketPath = DefaultSocket
	}
	sdk, err := client.New(client.WithHost("unix://"+socketPath), client.WithAPIVersion(APIVersion))
	if err != nil {
		return nil, err
	}
	return &Client{sdk: sdk}, nil
}

// NewWithTransport connects through a caller-supplied HTTP transport.
func NewWithTransport(rt http.RoundTripper, apiVersion string) (*Client, error) {
	sdk, err := client.New(client.WithHTTPClient(&http.Client{Transport: rt}), client.WithAPIVersion(apiVersion))
	if err != nil {
		return nil, err
	}
	return &Client{sdk: sdk}, nil
}

// Close releases idle daemon connections after callers finish using the client.
func (c *Client) Close() error { return c.sdk.Close() }

func IsNotFound(err error) bool { return errdefs.IsNotFound(err) }

func (c *Client) Ping(ctx context.Context) error {
	_, err := c.sdk.Ping(ctx, client.PingOptions{})
	return err
}

type Image struct {
	ID          string
	RepoTags    []string
	RepoDigests []string
}

func (c *Client) ImageInspect(ctx context.Context, ref string) (Image, error) {
	img, err := c.sdk.ImageInspect(ctx, ref)
	if err != nil {
		return Image{}, err
	}
	return Image{ID: img.ID, RepoTags: img.RepoTags, RepoDigests: img.RepoDigests}, nil
}

// ImagePull waits for the complete progress stream, including errors reported
// after the daemon has already sent a successful HTTP status.
func (c *Client) ImagePull(ctx context.Context, ref string) error {
	response, err := c.sdk.ImagePull(ctx, ref, client.ImagePullOptions{})
	if err != nil {
		return err
	}
	defer response.Close()
	return response.Wait(ctx)
}

// ContainerSpec contains only the settings Flora supplies. The daemon keeps
// privileged mode off and uses its default capabilities and bridge network.
type ContainerSpec struct {
	Name   string
	Image  string
	Env    []string
	Labels map[string]string
	// Binds must contain only this chat's workspace and runtime-state paths.
	Binds []string
	// LoopbackPort publishes an ephemeral loopback-only TCP port. Zero disables it.
	LoopbackPort int
	NanoCPUs     int64
	MemoryBytes  int64
	PidsLimit    int64
}

func (c *Client) ContainerCreate(ctx context.Context, spec ContainerSpec) (string, error) {
	config := &container.Config{Image: spec.Image, Env: spec.Env, Labels: spec.Labels}
	host := &container.HostConfig{
		Binds:     spec.Binds,
		Resources: container.Resources{NanoCPUs: spec.NanoCPUs, Memory: spec.MemoryBytes, PidsLimit: &spec.PidsLimit},
	}
	if spec.LoopbackPort != 0 {
		port, err := network.ParsePort(strconv.Itoa(spec.LoopbackPort) + "/tcp")
		if err != nil {
			return "", err
		}
		config.ExposedPorts = network.PortSet{port: {}}
		host.PortBindings = network.PortMap{port: {{HostIP: netip.MustParseAddr("127.0.0.1"), HostPort: ""}}}
	}
	created, err := c.sdk.ContainerCreate(ctx, client.ContainerCreateOptions{Name: spec.Name, Config: config, HostConfig: host})
	if err != nil {
		return "", err
	}
	if created.ID == "" {
		return "", fmt.Errorf("docker container create: missing container ID")
	}
	return created.ID, nil
}

// ContainerStart accepts an already-running container as success.
func (c *Client) ContainerStart(ctx context.Context, id string) error {
	_, err := c.sdk.ContainerStart(ctx, id, client.ContainerStartOptions{})
	return err
}

// ContainerStop gives the process timeoutSeconds before SIGKILL and accepts
// an already-stopped container as success.
func (c *Client) ContainerStop(ctx context.Context, id string, timeoutSeconds int) error {
	_, err := c.sdk.ContainerStop(ctx, id, client.ContainerStopOptions{Timeout: &timeoutSeconds})
	return err
}

func (c *Client) ContainerKill(ctx context.Context, id, signal string) error {
	_, err := c.sdk.ContainerKill(ctx, id, client.ContainerKillOptions{Signal: signal})
	return err
}

func (c *Client) ContainerRemove(ctx context.Context, id string, force bool) error {
	_, err := c.sdk.ContainerRemove(ctx, id, client.ContainerRemoveOptions{Force: force})
	return err
}

type ContainerState struct {
	Status   string
	Running  bool
	ExitCode int
}

type PortBinding struct {
	HostIP   string
	HostPort string
}

// ContainerInfo keeps the inspected fields used to verify ownership and readiness.
type ContainerInfo struct {
	ID     string
	Name   string
	Image  string // immutable image content ID
	State  ContainerState
	Config struct {
		Env    []string
		Labels map[string]string
	}
	HostConfig struct {
		Binds      []string
		Privileged bool
		NanoCPUs   int64
		Memory     int64
		PidsLimit  int64
	}
	NetworkSettings struct {
		Ports map[string][]PortBinding
	}
}

func (c *Client) ContainerInspect(ctx context.Context, id string) (ContainerInfo, error) {
	result, err := c.sdk.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	if err != nil {
		return ContainerInfo{}, err
	}
	inspected := result.Container
	if inspected.State == nil {
		return ContainerInfo{}, fmt.Errorf("docker container inspect %s: missing state", id)
	}
	info := ContainerInfo{ID: inspected.ID, Name: inspected.Name, Image: inspected.Image}
	info.State = ContainerState{Status: string(inspected.State.Status), Running: inspected.State.Running, ExitCode: inspected.State.ExitCode}
	if inspected.Config != nil {
		info.Config.Env, info.Config.Labels = inspected.Config.Env, inspected.Config.Labels
	}
	if host := inspected.HostConfig; host != nil {
		info.HostConfig.Binds, info.HostConfig.Privileged = host.Binds, host.Privileged
		info.HostConfig.NanoCPUs, info.HostConfig.Memory = host.NanoCPUs, host.Memory
		if host.PidsLimit != nil {
			info.HostConfig.PidsLimit = *host.PidsLimit
		}
	}
	info.NetworkSettings.Ports = make(map[string][]PortBinding)
	if inspected.NetworkSettings != nil {
		for port, bindings := range inspected.NetworkSettings.Ports {
			for _, binding := range bindings {
				hostIP := ""
				if binding.HostIP.IsValid() {
					hostIP = binding.HostIP.String()
				}
				info.NetworkSettings.Ports[port.String()] = append(info.NetworkSettings.Ports[port.String()], PortBinding{HostIP: hostIP, HostPort: binding.HostPort})
			}
		}
	}
	return info, nil
}

// LoopbackAddress returns the local address publishing containerPort, or empty
// when it is not published on a host IPv4 loopback or wildcard address.
func (info ContainerInfo) LoopbackAddress(containerPort int) string {
	for _, binding := range info.NetworkSettings.Ports[strconv.Itoa(containerPort)+"/tcp"] {
		if binding.HostIP == "127.0.0.1" || binding.HostIP == "0.0.0.0" || binding.HostIP == "" {
			return net.JoinHostPort("127.0.0.1", binding.HostPort)
		}
	}
	return ""
}

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
	ID     string
	Names  []string
	Image  string
	State  string
	Labels map[string]string
}

// ContainerList matches all supplied labels, including stopped containers unless
// running is true. Running candidates are inspected because the daemon's list
// snapshot can still show a container as running after Stop has completed.
func (c *Client) ContainerList(ctx context.Context, running bool, labels map[string]string) ([]ContainerSummary, error) {
	filters := make(client.Filters)
	for k, v := range labels {
		filters.Add("label", k+"="+v)
	}
	if running {
		filters.Add("status", "running")
	}
	result, err := c.sdk.ContainerList(ctx, client.ContainerListOptions{All: true, Filters: filters})
	if err != nil {
		return nil, err
	}
	list := make([]ContainerSummary, 0, len(result.Items))
	for _, item := range result.Items {
		if running {
			info, err := c.ContainerInspect(ctx, item.ID)
			if IsNotFound(err) {
				continue
			}
			if err != nil {
				return nil, err
			}
			if !info.State.Running {
				continue
			}
		}
		list = append(list, ContainerSummary{ID: item.ID, Names: item.Names, Image: item.Image, State: string(item.State), Labels: item.Labels})
	}
	return list, nil
}

// NewPassword returns a random per-container endpoint password.
func NewPassword() (string, error) {
	var raw [24]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw[:]), nil
}
