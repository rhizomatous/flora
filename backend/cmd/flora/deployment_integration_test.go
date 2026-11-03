package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cgi"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

// The child runs production main, changing only the vendor HTTP transport to a
// local fixture. There are no manual broker flags or alternate runtime assembly.
func TestDeploymentMain(t *testing.T) {
	if os.Getenv("FLORA_DEPLOYMENT_HELPER") != "1" {
		return
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialTLSContext = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", os.Getenv("FLORA_DEPLOYMENT_UPSTREAM"))
	}
	http.DefaultTransport = transport
	flag.CommandLine = flag.NewFlagSet("flora", flag.ExitOnError)
	for i, arg := range os.Args {
		if arg == "--" {
			os.Args = append([]string{"flora"}, os.Args[i+1:]...)
			break
		}
	}
	main()
}

func TestDeploymentEngine(t *testing.T) {
	if os.Getenv("FLORA_DEPLOYMENT_TEST") != "1" {
		t.Skip("requires disposable Linux Engine")
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
	data := filepath.Join(t.TempDir(), "data")
	dir := filepath.Join(data, "deployment")
	const upstreamToken = "github_pat_fixture_only_token_never_in_agent"
	upstream := localGitHub(t, upstreamToken)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	backend := listener.Addr().String()
	_ = listener.Close()
	target, _ := url.Parse("http://" + backend)
	proxy := httptest.NewTLSServer(httputil.NewSingleHostReverseProxy(target))
	defer proxy.Close()
	client := proxy.Client()
	client.Timeout = 30 * time.Second
	var logs bytes.Buffer
	start := func() *exec.Cmd {
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDeploymentMain$", "--", "-public-url", proxy.URL, "-listen", backend, "-data-dir", data, "-agent-image", image, "-agent-image-id", img.ID, "-agent-image-digest", "fixture/agent@"+img.ID)
		cmd.Env = append(os.Environ(), "FLORA_DEPLOYMENT_HELPER=1", "FLORA_DEPLOYMENT_UPSTREAM="+upstream.Listener.Addr().String())
		cmd.Stdout, cmd.Stderr = &logs, &logs
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if cmd.ProcessState == nil {
				_ = cmd.Process.Kill()
				_ = cmd.Wait()
			}
		})
		deadline := time.Now().Add(20 * time.Second)
		for {
			r, err := client.Get(proxy.URL + "/api/health")
			if err == nil {
				_ = r.Body.Close()
				if r.StatusCode == 200 {
					return cmd
				}
			}
			if time.Now().After(deadline) {
				_ = cmd.Process.Kill()
				_ = cmd.Wait()
				t.Fatalf("application startup: %s", &logs)
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
	stop := func(cmd *exec.Cmd) {
		_ = cmd.Process.Signal(syscall.SIGTERM)
		if err := cmd.Wait(); err != nil {
			t.Fatalf("application stop: %v %s", err, &logs)
		}
	}
	request := func(method, path, origin, body string, cookie *http.Cookie, status int) []byte {
		t.Helper()
		req, _ := http.NewRequest(method, proxy.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", origin)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		r, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		b, _ := io.ReadAll(r.Body)
		if r.StatusCode != status {
			t.Fatalf("%s %s: %d %s", method, path, r.StatusCode, b)
		}
		return b
	}
	cmd := start()
	var d deployment
	saved, err := privateRead(filepath.Join(dir, "deployment.json"))
	if err != nil || json.Unmarshal(saved, &d) != nil {
		t.Fatal("missing managed identity", err)
	}
	t.Cleanup(func() { _ = exec.Command("docker", "network", "rm", d.NetworkID).Run() })
	code, err := privateRead(filepath.Join(dir, "enrollment-code"))
	if err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{"password":"fixture-password-long","enrollmentCode":%q}`, code)
	request("POST", "/api/auth/bootstrap", "https://attacker.example.com", body, nil, 403)
	request("POST", "/api/auth/bootstrap", proxy.URL, `{"password":"fixture-password-long"}`, nil, 403)
	req, _ := http.NewRequest("POST", proxy.URL+"/api/auth/bootstrap", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", proxy.URL)
	r, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = r.Body.Close()
	cookies := r.Cookies()
	if r.StatusCode != 200 || len(cookies) == 0 || !cookies[0].Secure || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("protected enrollment did not set secure session")
	}
	cookie := cookies[0]
	request("GET", "/api/chats/unknown/events", proxy.URL, "", nil, 401)
	request("PUT", "/api/settings", proxy.URL, `{"githubToken":"`+upstreamToken+`","provider":"anthropic","providerKey":"fixture-only-provider-key","model":"fixture"}`, cookie, 200)
	// Hold setup before OpenCode starts, so this networking test never performs
	// inference. Checkout and the broker remain fully usable during setup.
	projectBody := `{"name":"fixture","configuration":{"setupCommand":"sleep 300","repositories":[{"url":"https://github.com/octo/demo.git","baseBranch":"main","role":"core"}]}}`
	var project storage.Project
	if err := json.Unmarshal(request("POST", "/api/projects", proxy.URL, projectBody, cookie, 201), &project); err != nil {
		t.Fatal(err)
	}
	var chat storage.Chat
	if err := json.Unmarshal(request("POST", "/api/projects/"+project.ID+"/chats", proxy.URL, `{"title":"fixture","requestID":"fixture-1","text":"fixture"}`, cookie, 202), &chat); err != nil {
		t.Fatal(err)
	}
	var container string
	deadline := time.Now().Add(60 * time.Second)
	for {
		items, err := engine.ContainerList(ctx, true, map[string]string{"flora.chat-id": chat.ID})
		if err == nil && len(items) == 1 {
			container = items[0].ID
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("container not created: %s", &logs)
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Cleanup(func() { _ = engine.ContainerRemove(context.Background(), container, true) })
	run := func(script string) (string, error) {
		var output bytes.Buffer
		status, err := engine.Exec(ctx, container, "flora", []string{"sh", "-c", ". /home/flora/.flora-github.env\n" + script}, nil, &output, &output)
		if err == nil && status != 0 {
			err = fmt.Errorf("exit %d: %s", status, &output)
		}
		return strings.TrimSpace(output.String()), err
	}
	for {
		if _, err := run("test -f /workspace/hello.txt && git fetch origin"); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("managed checkout did not finish")
		}
		time.Sleep(200 * time.Millisecond)
	}
	for script, want := range map[string]string{
		"id -u":                                fmt.Sprint(d.AgentUID),
		"gh api repos/octo/demo --jq .private": "true",
		"curl --silent --show-error --cacert /home/flora/.flora-github-ca.pem --output /dev/null --write-out '%{http_code}' https://flora-github.internal/": "401",
		"printf retained > /workspace/edit.txt && sudo sh -c 'printf layer > /owned-layer'":                                                                 "",
	} {
		if got, err := run(script); err != nil || got != want {
			t.Fatalf("agent check: %s %v", got, err)
		}
	}
	info, err := engine.ContainerInspect(ctx, container)
	if err != nil || len(info.NetworkSettings.Networks) != 1 || info.HostConfig.NetworkMode != d.NetworkID || !strings.HasPrefix(info.LoopbackAddress(4096), "127.0.0.1:") {
		t.Fatal("runtime network or loopback port differs", err)
	}
	raw, _ := json.Marshal(info)
	for _, secret := range []string{upstreamToken, "broker-ca.pem", "docker.sock", cookie.Value} {
		if bytes.Contains(raw, []byte(secret)) {
			t.Fatal("host secret delivered to agent")
		}
	}
	if out, err := exec.CommandContext(ctx, "docker", "run", "--rm", "--entrypoint", "curl", image, "--connect-timeout", "2", "--max-time", "3", "--insecure", "--resolve", brokerName+":443:"+d.Gateway, "https://"+brokerName+"/").CombinedOutput(); err == nil {
		t.Fatalf("foreign bridge reached broker: %s", out)
	}
	request("POST", "/api/chats/"+chat.ID+"/stop", proxy.URL, `{}`, cookie, 200)
	stop(cmd)
	if bytes.Contains(logs.Bytes(), code) {
		t.Fatal("enrollment code leaked to logs")
	}
	cmd = start()
	request("POST", "/api/auth/bootstrap", proxy.URL, body, nil, 409)
	request("GET", "/api/settings", proxy.URL, "", cookie, 200)
	retained, err := engine.ContainerInspect(ctx, container)
	if err != nil || retained.ID != container || retained.State.Running {
		t.Fatal("restart changed retained stopped container", err)
	}
	stop(cmd)
	if err := engine.ContainerRemove(ctx, container, true); err != nil {
		t.Fatal(err)
	}
	if err := exec.CommandContext(ctx, "docker", "network", "rm", d.NetworkID).Run(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := prepareDeployment(ctx, engine, dir); err == nil {
		t.Fatal("missing recorded network recreated")
	}
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
		w.Header().Set("Content-Type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/v1/models/") {
			_, _ = io.WriteString(w, `{}`)
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+token {
			http.Error(w, "unauthorized", 401)
			return
		}
		if strings.Contains(r.URL.Path, "/branches/") {
			_, _ = io.WriteString(w, `{"name":"main","commit":{"sha":"fixture"}}`)
			return
		}
		_, _ = io.WriteString(w, `{"full_name":"octo/demo","private":true,"default_branch":"main","permissions":{"push":true}}`)
	}))
	t.Cleanup(server.Close)
	return server
}
