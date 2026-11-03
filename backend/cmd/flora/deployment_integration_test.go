package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cgi"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/githubbroker"
	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

// This test runs only inside a disposable Linux container with its own Engine.
// It starts the actual binary, then uses the same broker listener and manager
// against local Git/gh fixtures. No provider or upstream GitHub calls are made.
func TestDeploymentEngine(t *testing.T) {
	if os.Getenv("FLORA_DEPLOYMENT_TEST") != "1" {
		t.Skip("requires disposable nested Engine")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	engine, err := docker.New("")
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	image := os.Getenv("FLORA_TEST_IMAGE")
	img, err := engine.ImageInspect(ctx, image)
	if err != nil {
		t.Fatal(err)
	}
	// A fixture-only recorded name, with exact local content-ID validation.
	// This is not a registry manifest digest or a releasable image identity.
	fixtureIdentity := "fixture/agent@" + img.ID
	data := filepath.Join(t.TempDir(), "data")
	if err := privateDir(data); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(data, "deployment")
	d, device, err := prepareDeployment(ctx, engine, dir, browserDomain, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = exec.Command("docker", "network", "rm", d.NetworkID).Run() })
	roots := issueBrowserCertificate(t, filepath.Join(dir, "certificates"))
	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, ServerName: browserDomain}, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", net.JoinHostPort(d.Addresses[0], "443"))
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second}
	var logs bytes.Buffer
	start := func() *exec.Cmd {
		cmd := exec.CommandContext(ctx, "/flora", "-hostname", browserDomain, "-data-dir", data, "-agent-image", image, "-agent-image-id", img.ID, "-agent-image-digest", fixtureIdentity)
		cmd.Stdout, cmd.Stderr = &logs, &logs
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(15 * time.Second)
		for {
			r, err := client.Get("https://" + browserDomain + "/api/health")
			if err == nil {
				_ = r.Body.Close()
				if r.StatusCode == 200 {
					break
				}
			}
			if time.Now().After(deadline) {
				_ = cmd.Process.Kill()
				_ = cmd.Wait()
				t.Fatalf("application did not start: %s", &logs)
			}
			time.Sleep(100 * time.Millisecond)
		}
		return cmd
	}
	stop := func(cmd *exec.Cmd) {
		transport.CloseIdleConnections()
		_ = cmd.Process.Signal(syscall.SIGTERM)
		if err := cmd.Wait(); err != nil {
			t.Fatalf("application stop: %v %s", err, &logs)
		}
	}
	cmd := start()
	defer func() {
		if cmd.ProcessState == nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	}()
	request := func(path, origin, body string, cookie *http.Cookie) (*http.Response, []byte) {
		t.Helper()
		req, _ := http.NewRequest("POST", "https://"+browserDomain+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", origin)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		r, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		b, err := io.ReadAll(r.Body)
		_ = r.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		return r, b
	}
	code, err := privateRead(filepath.Join(dir, "enrollment-code"))
	if err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{"password":"fixture-password-long","enrollmentCode":%q}`, code)
	r, _ := request("/api/auth/bootstrap", "https://attacker.example.com", body, nil)
	if r.StatusCode != 403 {
		t.Fatalf("cross-site enrollment: %d", r.StatusCode)
	}
	r, _ = request("/api/auth/bootstrap", "https://"+browserDomain, `{"password":"fixture-password-long"}`, nil)
	if r.StatusCode != 403 {
		t.Fatalf("unprotected enrollment: %d", r.StatusCode)
	}
	r, result := request("/api/auth/bootstrap", "https://"+browserDomain, body, nil)
	if r.StatusCode != 201 && r.StatusCode != 200 {
		t.Fatalf("enrollment: %d %s", r.StatusCode, result)
	}
	cookies := r.Cookies()
	if len(cookies) == 0 || !cookies[0].Secure || !cookies[0].HttpOnly {
		t.Fatal("missing secure session cookie")
	}
	unauthorized, err := client.Get("https://" + browserDomain + "/api/chats/unknown/events")
	if err != nil {
		t.Fatal(err)
	}
	_ = unauthorized.Body.Close()
	if unauthorized.StatusCode != 401 {
		t.Fatal("unauthenticated SSE exposed")
	}
	stop(cmd)
	cmd = start()
	r, _ = request("/api/auth/bootstrap", "https://"+browserDomain, body, nil)
	if r.StatusCode != 409 {
		t.Fatalf("enrollment replay after restart: %d", r.StatusCode)
	}
	stop(cmd)
	if bytes.Contains(logs.Bytes(), code) {
		t.Fatal("enrollment code leaked to logs")
	}
	ca, cert, key, err := brokerAuthority(dir)
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(ctx, data)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	const upstreamToken = "fixture-only-token-never-in-agent"
	if err := store.SaveCredentials(ctx, storage.Credentials{GitHubToken: upstreamToken, Provider: "anthropic", Model: "fixture", ProviderKey: "unused"}); err != nil {
		t.Fatal(err)
	}
	upstream := localGitHub(t, upstreamToken)
	// New's transport clone retains this test-only dialer. Production binary
	// startup above used its ordinary transport with no upstream credentials.
	original := http.DefaultTransport
	fixtureTransport := original.(*http.Transport).Clone()
	fixtureTransport.Proxy = nil
	fixtureTransport.DialTLSContext = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", upstream.Listener.Addr().String())
	}
	http.DefaultTransport = fixtureTransport
	brokerCtx, stopBroker := context.WithCancel(ctx)
	access, _, err := startGitHub(brokerCtx, store, engine, githubbroker.CheckoutConfig{Host: brokerName, CACert: string(ca), UseChatAuthor: true}, net.JoinHostPort(d.Gateway, "443"), "", "", brokerListenerConfig{Device: device, TLS: brokerTLS(cert, key)})
	http.DefaultTransport = original
	defer fixtureTransport.CloseIdleConnections()
	defer stopBroker()
	if err != nil {
		t.Fatal(err)
	}
	cfg := provisioning.Config{ImageRef: image, ImageDigest: fixtureIdentity, ImageID: img.ID, HarnessVersion: "1.2.27", NetworkID: d.NetworkID, BrokerGateway: d.Gateway, AgentUID: d.AgentUID, AgentGID: d.AgentGID}
	manager, err := provisioning.New(engine, store, cfg, access)
	if err != nil {
		t.Fatal(err)
	}
	project, err := store.CreateProject(ctx, "fixture", storage.Configuration{Repositories: []storage.Repository{{Name: "octo/demo", URL: "https://github.com/octo/demo.git", BaseBranch: "main", Role: "core"}}})
	if err != nil {
		t.Fatal(err)
	}
	digest, harness := manager.Identity()
	chat, err := store.CreateChat(ctx, project.ID, "fixture", digest, harness)
	if err != nil {
		t.Fatal(err)
	}
	endpoint, err := manager.Start(ctx, chat.ID)
	if err != nil {
		paths, _ := store.Paths(ctx, chat.ID)
		log, _ := os.ReadFile(filepath.Join(paths.Logs, "checkout.log"))
		t.Fatalf("provisioning: %v %s", err, log)
	}
	defer engine.ContainerRemove(context.Background(), endpoint.ContainerID, true)
	run := func(script string) string {
		t.Helper()
		var output bytes.Buffer
		status, err := engine.Exec(ctx, endpoint.ContainerID, "flora", []string{"sh", "-c", ". /home/flora/.flora-github.env\n" + script}, nil, &output, &output)
		if err != nil || status != 0 {
			t.Fatalf("agent command: %v exit=%d %s", err, status, &output)
		}
		return strings.TrimSpace(output.String())
	}
	run("git fetch origin && test -f hello.txt && printf retained > edit.txt && sudo sh -c 'printf layer > /owned-layer'")
	if run("gh api repos/octo/demo --jq .private") != "true" {
		t.Fatal("stock gh metadata failed")
	}
	if run("curl --silent --show-error --cacert /home/flora/.flora-github-ca.pem --output /dev/null --write-out '%{http_code}' https://flora-github.internal/") != "401" {
		t.Fatal("broker accepted unauthenticated agent request")
	}
	info, err := engine.ContainerInspect(ctx, endpoint.ContainerID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(info.LoopbackAddress(4096), "127.0.0.1:") || len(info.NetworkSettings.Networks) != 1 || info.HostConfig.NetworkMode != d.NetworkID {
		t.Fatal("runtime port or owned network differs")
	}
	raw, _ := json.Marshal(info)
	if bytes.Contains(raw, []byte(upstreamToken)) || strings.Contains(string(raw), "broker-ca.pem") || strings.Contains(string(raw), "docker.sock") {
		t.Fatal("host secret or Docker socket delivered to agent")
	}
	if err := manager.Stop(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	manager, err = provisioning.New(engine, store, cfg, access)
	if err != nil {
		t.Fatal(err)
	}
	resumed, err := manager.Start(ctx, chat.ID)
	if err != nil || resumed.ContainerID != endpoint.ContainerID {
		t.Fatal("retained container replaced", err)
	}
	if run("cat edit.txt /owned-layer") != "retainedlayer" {
		t.Fatal("workspace or writable layer lost")
	}
	if err := access.Revoke(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	run("if gh api repos/octo/demo >/dev/null 2>&1; then exit 1; fi")
	// Another network has a route to the private gateway, but not the bound
	// ingress device. It must not reach even the broker's unauthenticated route.
	out, err := exec.CommandContext(ctx, "docker", "run", "--rm", "--entrypoint", "curl", image, "--connect-timeout", "2", "--max-time", "3", "--insecure", "https://"+d.Gateway+"/").CombinedOutput()
	if err == nil {
		t.Fatalf("foreign bridge reached private broker: %s", out)
	}
	if _, _, err := prepareDeployment(ctx, engine, dir, browserDomain, ""); err != nil {
		t.Fatal("same deployment restart", err)
	}
	if err := exec.CommandContext(ctx, "docker", "network", "connect", "bridge", endpoint.ContainerID).Run(); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Start(ctx, chat.ID); err == nil {
		t.Fatal("extra network accepted")
	}
	t.Log("Actual binary: protected HTTPS enrollment and restart. Production bridge/broker/manager: clone, fetch, stock gh, revocation, retained workspace/layer, foreign ingress and network drift checks passed.")
}

func localGitHub(t *testing.T, token string) *httptest.Server {
	t.Helper()
	root, seed := t.TempDir(), t.TempDir()
	git := func(dir string, args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Fixture", "GIT_AUTHOR_EMAIL=fixture@example.com", "GIT_COMMITTER_NAME=Fixture", "GIT_COMMITTER_EMAIL=fixture@example.com")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git fixture: %v %s", err, out)
		}
	}
	repo := filepath.Join(root, "octo", "demo.git")
	git(root, "init", "--bare", "--initial-branch=main", repo)
	git(seed, "init", "--initial-branch=main")
	if err := os.WriteFile(filepath.Join(seed, "hello.txt"), []byte("hello"), 0600); err != nil {
		t.Fatal(err)
	}
	git(seed, "add", ".")
	git(seed, "commit", "-m", "fixture")
	git(seed, "push", repo, "main")
	gitBin, err := exec.LookPath("git")
	if err != nil {
		t.Fatal(err)
	}
	backend := &cgi.Handler{Path: gitBin, Args: []string{"http-backend"}, Dir: root, Env: []string{"GIT_PROJECT_ROOT=" + root, "GIT_HTTP_EXPORT_ALL=1", "REMOTE_USER=fixture"}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, ".git/") {
			_, pass, ok := r.BasicAuth()
			if !ok || pass != token {
				http.Error(w, "unauthorized", 401)
				return
			}
			backend.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+token {
			http.Error(w, "unauthorized", 401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"full_name":"octo/demo","private":true,"default_branch":"main"}`)
	}))
	t.Cleanup(server.Close)
	return server
}
