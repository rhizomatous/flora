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
	// Rewrite the client's fixed "docker" host to the fake daemon so the
	// production URL construction stays under test.
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		r.URL.Scheme = "http"
		r.URL.Host = server.Listener.Addr().String()
		return http.DefaultTransport.RoundTrip(r)
	})
	client := NewWithTransport(transport, APIVersion)
	return client, fake
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestPingUnreachable(t *testing.T) {
	client := New("/nonexistent/flora-test.sock")
	if err := client.Ping(context.Background()); err == nil {
		t.Fatal("ping against a missing socket must fail")
	}
}

func TestContainerCreateShape(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/"+APIVersion+"/containers/create" {
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
		if host["NanoCPUs"] != float64(2e9) || host["Memory"] != float64(8<<30) || host["PidsLimit"] != float64(512) {
			t.Errorf("limits: %v %v %v", host["NanoCPUs"], host["Memory"], host["PidsLimit"])
		}
		binds, _ := host["Binds"].([]any)
		if len(binds) != 2 || binds[0] != "/data/workspaces/c1:/workspace" || binds[1] != "/data/runtime-state/c1:/home/flora" {
			t.Errorf("binds: %v", binds)
		}
		if _, forbidden := host["Privileged"]; forbidden {
			t.Errorf("privileged flag must not be set")
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
	var engineErr *Error
	if !errors.As(err, &engineErr) || !strings.Contains(engineErr.Message, "No such image") {
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
		if r.URL.Path != "/"+APIVersion+"/containers/json" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		var filters map[string][]string
		if err := json.Unmarshal([]byte(r.URL.Query().Get("filters")), &filters); err != nil {
			t.Errorf("filters not JSON: %v", err)
		}
		if len(filters["label"]) != 1 || filters["label"][0] != "flora.managed=true" || len(filters["status"]) != 1 || filters["status"][0] != "running" {
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
		if got := r.URL.Query().Get("fromImage"); got != "example/img@sha256:abc" {
			t.Errorf("fromImage: %q", got)
		}
		_, _ = w.Write([]byte("{\"status\":\"Pulling\"}\n{\"error\":\"denied\"}\n"))
	})
	err := client.ImagePull(context.Background(), "example/img@sha256:abc")
	if err == nil || !strings.Contains(err.Error(), "denied") {
		t.Fatalf("streamed pull error must surface: %v", err)
	}
}

func TestInspectHelpers(t *testing.T) {
	raw := `{
	  "Id": "c1",
	  "State": {"Status": "running", "Running": true, "ExitCode": 0},
	  "Config": {"Env": ["A=1", "OPENCODE_SERVER_PASSWORD=secret"]},
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
