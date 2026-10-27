package docker

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeDaemon records requests and serves canned Engine API responses.
type fakeDaemon struct {
	t        *testing.T
	requests []string
	handler  http.HandlerFunc
}

func (f *fakeDaemon) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.requests = append(f.requests, r.Method+" "+r.URL.Path)
	f.handler(w, r)
}

func newTestClient(t *testing.T, handler http.HandlerFunc) (*Client, *fakeDaemon) {
	t.Helper()
	fake := &fakeDaemon{t: t, handler: handler}
	server := httptest.NewServer(fake)
	t.Cleanup(server.Close)
	// Route SDK requests to the fake daemon while keeping their paths and queries.
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		r.URL.Scheme = "http"
		r.URL.Host = server.Listener.Addr().String()
		return http.DefaultTransport.RoundTrip(r)
	})
	client, err := NewWithTransport(transport, APIVersion)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	return client, fake
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestPingUnreachable(t *testing.T) {
	client, err := New("/nonexistent/flora-test.sock")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	if err := client.Ping(context.Background()); err == nil {
		t.Fatal("ping against a missing socket must fail")
	}
}

func TestContainerCreateShape(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v"+APIVersion+"/containers/create" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if r.URL.Query().Get("name") != "flora-chat-abc" {
			t.Errorf("missing name query: %s", r.URL.RawQuery)
		}
		var body map[string]any
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Errorf("create body is not JSON: %v", err)
		}
		if body["Image"] != "example/img@sha256:abc" {
			t.Errorf("image: %v", body["Image"])
		}
		host, ok := body["HostConfig"].(map[string]any)
		if !ok {
			t.Errorf("HostConfig missing")
			return
		}
		if host["NanoCpus"] != float64(2e9) || host["Memory"] != float64(8<<30) || host["PidsLimit"] != float64(512) {
			t.Errorf("limits: %v %v %v", host["NanoCpus"], host["Memory"], host["PidsLimit"])
		}
		binds, _ := host["Binds"].([]any)
		if len(binds) != 2 || binds[0] != "/data/workspaces/c1:/workspace" || binds[1] != "/data/runtime-state/c1:/home/flora" {
			t.Errorf("binds: %v", binds)
		}
		if privileged, _ := host["Privileged"].(bool); privileged {
			t.Errorf("privileged mode must be disabled")
		}
		ports, _ := host["PortBindings"].(map[string]any)
		binding, _ := ports["4096/tcp"].([]any)
		entry, _ := binding[0].(map[string]any)
		if entry["HostIp"] != "127.0.0.1" || entry["HostPort"] != "" {
			t.Errorf("port binding must be loopback-only and ephemeral: %v", entry)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"Id":"container123"}`))
	})
	spec := ContainerSpec{
		Name:         "flora-chat-abc",
		Image:        "example/img@sha256:abc",
		Env:          []string{"OPENCODE_SERVER_PASSWORD=x"},
		Labels:       map[string]string{"flora.managed": "true"},
		Binds:        []string{"/data/workspaces/c1:/workspace", "/data/runtime-state/c1:/home/flora"},
		LoopbackPort: 4096,
		NanoCPUs:     2e9,
		MemoryBytes:  8 << 30,
		PidsLimit:    512,
	}
	id, err := client.ContainerCreate(context.Background(), spec)
	if err != nil || id != "container123" {
		t.Fatalf("create: %q %v", id, err)
	}
}

func TestEngineErrors(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"message":"No such image: missing"}`))
	})
	_, err := client.ImageInspect(context.Background(), "missing:latest")
	if !IsNotFound(err) {
		t.Fatalf("want not-found error, got %v", err)
	}
	if !strings.Contains(err.Error(), "No such image") {
		t.Fatalf("daemon message not preserved: %v", err)
	}
}

func TestStartStopIdempotent(t *testing.T) {
	client, fake := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotModified)
	})
	if err := client.ContainerStart(context.Background(), "c1"); err != nil {
		t.Fatalf("304 start must be accepted: %v", err)
	}
	if err := client.ContainerStop(context.Background(), "c1", 10); err != nil {
		t.Fatalf("304 stop must be accepted: %v", err)
	}
	if len(fake.requests) != 2 {
		t.Fatalf("requests: %v", fake.requests)
	}
}

func TestContainerListFilters(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v"+APIVersion+"/containers/json" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		var filters map[string]map[string]bool
		if err := json.Unmarshal([]byte(r.URL.Query().Get("filters")), &filters); err != nil {
			t.Errorf("filters not JSON: %v", err)
		}
		if len(filters["label"]) != 1 || !filters["label"]["flora.managed=true"] || len(filters["status"]) != 1 || !filters["status"]["running"] {
			t.Errorf("filters: %v", filters)
		}
		_, _ = w.Write([]byte(`[{"Id":"a","State":"running","Labels":{"flora.managed":"true"}}]`))
	})
	list, err := client.ContainerList(context.Background(), true, map[string]string{"flora.managed": "true"})
	if err != nil || len(list) != 1 || list[0].ID != "a" {
		t.Fatalf("list: %v %v", list, err)
	}
}

func TestImagePullStreamError(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("fromImage"); got != "docker.io/example/img" {
			t.Errorf("fromImage: %q", got)
		}
		if got := r.URL.Query().Get("tag"); got != "sha256:"+strings.Repeat("a", 64) {
			t.Errorf("digest: %q", got)
		}
		_, _ = w.Write([]byte("{\"status\":\"Pulling\"}\n{\"error\":\"denied\",\"errorDetail\":{\"message\":\"denied\"}}\n"))
	})
	err := client.ImagePull(context.Background(), "example/img@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if err == nil || !strings.Contains(err.Error(), "denied") {
		t.Fatalf("streamed pull error must surface: %v", err)
	}
}

func TestImagePullCompletion(t *testing.T) {
	for _, tc := range []struct {
		name      string
		body      string
		wantError bool
	}{
		{name: "complete", body: "{\"status\":\"Pulling\"}\n{\"status\":\"Done\"}\n"},
		{name: "truncated", body: "{\"status\":\"Pulling\"}\n{", wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.WriteString(w, tc.body)
			})
			err := client.ImagePull(context.Background(), "example/img:fixed")
			if (err != nil) != tc.wantError {
				t.Fatalf("pull: %v, want error: %v", err, tc.wantError)
			}
		})
	}
}

func TestImagePullCancellation(t *testing.T) {
	started := make(chan struct{})
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "{\"status\":\"Pulling\"}\n")
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- client.ImagePull(ctx, "example/img:fixed") }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("pull did not start")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("pull cancellation: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("pull did not stop after cancellation")
	}
}

func TestExplicitDaemonConfiguration(t *testing.T) {
	t.Setenv("DOCKER_HOST", "tcp://unwanted.invalid:2375")
	t.Setenv("DOCKER_API_VERSION", "1.99")
	client, err := New("/tmp/flora-explicit-test.sock")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	if client.sdk.DaemonHost() != "unix:///tmp/flora-explicit-test.sock" || client.sdk.ClientVersion() != APIVersion {
		t.Fatalf("explicit daemon configuration overridden: %s %s", client.sdk.DaemonHost(), client.sdk.ClientVersion())
	}
}

func TestInspectHelpers(t *testing.T) {
	raw := `{
	  "Id": "c1",
	  "Name": "/flora-chat-c1",
	  "Image": "sha256:content",
	  "State": {"Status": "running", "Running": true, "ExitCode": 0},
	  "Config": {"Env": ["A=1", "OPENCODE_SERVER_PASSWORD=secret"], "Labels": {"flora.managed":"true"}},
	  "HostConfig": {"Binds":["/workspace/c1:/workspace"], "Privileged":false, "NanoCpus":2000000000, "Memory":8589934592, "PidsLimit":512},
	  "NetworkSettings": {"Ports": {"4096/tcp": [{"HostIp": "127.0.0.1", "HostPort": "49152"}]}}
	}`
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(raw))
	})
	info, err := client.ContainerInspect(context.Background(), "c1")
	if err != nil {
		t.Fatal(err)
	}
	if !info.State.Running || info.LoopbackAddress(4096) != "127.0.0.1:49152" {
		t.Fatalf("inspect helpers: %+v", info)
	}
	if info.ID != "c1" || info.Name != "/flora-chat-c1" || info.Image != "sha256:content" || info.Config.Labels["flora.managed"] != "true" {
		t.Fatalf("ownership fields lost: %+v", info)
	}
	if len(info.HostConfig.Binds) != 1 || info.HostConfig.Binds[0] != "/workspace/c1:/workspace" || info.HostConfig.Privileged || info.HostConfig.NanoCPUs != 2e9 || info.HostConfig.Memory != 8<<30 || info.HostConfig.PidsLimit != 512 {
		t.Fatalf("host configuration lost: %+v", info.HostConfig)
	}
	if got := info.EnvValue("OPENCODE_SERVER_PASSWORD"); got != "secret" {
		t.Fatalf("env recovery: %q", got)
	}
	if info.LoopbackAddress(8080) != "" {
		t.Fatal("unpublished port must have no address")
	}
}

func TestPasswordRandom(t *testing.T) {
	a, err := NewPassword()
	if err != nil {
		t.Fatal(err)
	}
	b, err := NewPassword()
	if err != nil {
		t.Fatal(err)
	}
	if a == b || len(a) != 48 {
		t.Fatalf("passwords must be unique 24-byte hex: %q %q", a, b)
	}
}
