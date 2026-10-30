package githubbroker

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/cgi"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Fixture", "GIT_AUTHOR_EMAIL=fixture@example.test", "GIT_COMMITTER_NAME=Fixture", "GIT_COMMITTER_EMAIL=fixture@example.test", "GIT_CONFIG_NOSYSTEM=1")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("fixture git %v: %v %s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func fixtureUpstream(t *testing.T, broker *Broker) (string, *atomic.Int32) {
	t.Helper()
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "octo"), 0700); err != nil {
		t.Fatal(err)
	}
	repo := filepath.Join(root, "octo", "demo.git")
	git(t, root, "init", "--bare", "--initial-branch=main", repo)
	git(t, repo, "config", "http.receivepack", "true")
	seed := t.TempDir()
	git(t, seed, "init", "--initial-branch=main")
	if err := os.WriteFile(filepath.Join(seed, "hello.txt"), []byte("hello\n"), 0600); err != nil {
		t.Fatal(err)
	}
	git(t, seed, "add", "hello.txt")
	git(t, seed, "commit", "-m", "fixture")
	git(t, seed, "push", repo, "main")
	sha := git(t, seed, "rev-parse", "HEAD")
	gitBin, err := exec.LookPath("git")
	if err != nil {
		t.Fatal(err)
	}
	backend := &cgi.Handler{Path: gitBin, Args: []string{"http-backend"}, Dir: root, Env: []string{"GIT_PROJECT_ROOT=" + root, "GIT_HTTP_EXPORT_ALL=1", "REMOTE_USER=fixture"}}
	mutations := &atomic.Int32{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, ".git/") {
			user, pass, ok := r.BasicAuth()
			if !ok || user != "x-access-token" || pass != fixtureToken {
				http.Error(w, "fixture upstream authentication failed", 401)
				return
			}
			backend.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+fixtureToken {
			http.Error(w, "fixture upstream authentication failed", 401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/graphql" {
			io.WriteString(w, `{"full_name":"octo/demo","private":true,"default_branch":"main"}`)
			return
		}
		var body struct {
			Query     string                     `json:"query"`
			Variables map[string]json.RawMessage `json:"variables"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		switch {
		case strings.Contains(body.Query, "createPullRequest"):
			var input struct {
				Draft bool `json:"draft"`
			}
			_ = json.Unmarshal(body.Variables["input"], &input)
			if !input.Draft {
				http.Error(w, "fixture requires a draft mutation", 422)
				return
			}
			mutations.Add(1)
			io.WriteString(w, `{"data":{"createPullRequest":{"pullRequest":{"id":"pr-1","number":1,"isDraft":true,"url":"https://host.docker.internal/octo/demo/pull/1"}}}}`)
		case strings.Contains(body.Query, "repository"):
			io.WriteString(w, `{"data":{"repository":{"id":"repo-1","name":"demo","nameWithOwner":"octo/demo","owner":{"login":"octo"},"isPrivate":true,"viewerPermission":"ADMIN","defaultBranchRef":{"name":"main"},"parent":null,"url":"https://host.docker.internal/octo/demo","pullRequests":{"nodes":[]}}}}`)
		default:
			io.WriteString(w, `{"data":{"viewer":{"login":"flora"}}}`)
		}
	}))
	t.Cleanup(upstream.Close)
	target, _ := url.Parse(upstream.URL)
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	t.Cleanup(transport.CloseIdleConnections)
	broker.transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		// Real administrator credentials can never enter the fixture transport.
		user, pass, basic := r.BasicAuth()
		if r.Header.Get("Authorization") != "Bearer "+fixtureToken && !(basic && user == "x-access-token" && pass == fixtureToken) {
			return nil, fmt.Errorf("fixture token required")
		}
		out := r.Clone(r.Context())
		out.URL.Scheme, out.URL.Host = "http", target.Host
		out.Host = target.Host
		return transport.RoundTrip(out)
	})
	return sha, mutations
}

func privateTLS(t *testing.T, handler http.Handler, image string) (string, string) {
	t.Helper()
	bind := "127.0.0.1:0"
	if runtime.GOOS == "linux" {
		bind = "172.17.0.1:0"
	}
	if override := os.Getenv("FLORA_GITHUB_TEST_BIND"); override != "" {
		bind = override
	}
	listener, err := net.Listen("tcp", bind)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	_, port, _ := net.SplitHostPort(listener.Addr().String())
	name := "flora-github-test-relay-" + strings.ToLower(rand.Text())
	t.Cleanup(func() { _ = exec.Command("docker", "rm", "-f", name).Run() })
	args := []string{"run", "--detach", "--name", name}
	if runtime.GOOS == "linux" {
		args = append(args, "--add-host=host.docker.internal:host-gateway")
	}
	args = append(args, "--entrypoint", "sh", image, "-c", "apk add --no-cache socat >/dev/null 2>&1 && exec socat TCP-LISTEN:443,fork TCP:host.docker.internal:"+port)
	if out, err := exec.Command("docker", args...).CombinedOutput(); err != nil {
		t.Fatalf("test TCP relay: %v %s", err, out)
	}
	out, err := exec.Command("docker", "inspect", "--format", "{{.NetworkSettings.Networks.bridge.IPAddress}}", name).CombinedOutput()
	if err != nil {
		t.Fatalf("inspect TCP relay: %v %s", err, out)
	}
	host := strings.TrimSpace(string(out))
	if net.ParseIP(host) == nil {
		t.Fatal("relay has no bridge IP")
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	cert := &x509.Certificate{SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: host}, IPAddresses: []net.IP{net.ParseIP(host)}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, IsCA: true, BasicConstraintsValid: true}
	der, err := x509.CreateCertificate(rand.Reader, cert, cert, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		_ = server.Serve(tls.NewListener(listener, &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}}))
	}()
	t.Cleanup(func() { _ = server.Close() })
	certificatePEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(certificatePEM)
	deadline := time.Now().Add(20 * time.Second)
	for {
		conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 500 * time.Millisecond}, "tcp", net.JoinHostPort(host, "443"), &tls.Config{RootCAs: roots, ServerName: host, MinVersion: tls.VersionTLS12})
		if err == nil {
			_ = conn.Close()
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("test TCP relay did not become ready")
		}
		time.Sleep(100 * time.Millisecond)
	}
	return string(certificatePEM), host
}

// TestCheckoutDocker uses the production image and Engine API without model
// calls. By default all writes go to a local Git fixture. Supplying the live
// token opts into read-only private GitHub clone, fetch and branch resolution.
func TestCheckoutDocker(t *testing.T) {
	image := os.Getenv("FLORA_GITHUB_TEST_IMAGE")
	if image == "" {
		t.Skip("set FLORA_GITHUB_TEST_IMAGE to a locally built agent image")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	s, chat, b := fixture(t)
	liveToken := os.Getenv("FLORA_BROKER_GH_TOKEN")
	live := liveToken != ""
	var expected string
	var mutations *atomic.Int32
	if live {
		if err := b.Revoke(ctx, chat.ID); err != nil {
			t.Fatal(err)
		}
		if err := s.SaveCredentials(ctx, storage.Credentials{GitHubToken: liveToken, Provider: "anthropic", Model: "fixture", ProviderKey: "unused-fixture"}); err != nil {
			t.Fatal(err)
		}
		p, err := s.CreateProject(ctx, "live read-only", storage.Configuration{Repositories: []storage.Repository{{Name: "rhizomatous/flora", URL: "https://github.com/rhizomatous/flora.git", BaseBranch: "main", Role: "core"}}, SetupCommand: "test -d .git && printf ready > setup-ran"})
		if err != nil {
			t.Fatal(err)
		}
		chat, err = s.CreateChat(ctx, p.ID, "live read-only", chat.ImageDigest, "1.2.27")
		if err != nil {
			t.Fatal(err)
		}
	} else {
		expected, mutations = fixtureUpstream(t, b)
		p, err := s.Project(ctx, chat.ProjectID)
		if err != nil {
			t.Fatal(err)
		}
		p.Configuration.SetupCommand = "test -d .git && printf ready > setup-ran"
		if err := s.UpdateProject(ctx, p.ID, p.Name, p.Configuration); err != nil {
			t.Fatal(err)
		}
		chat, err = s.CreateChat(ctx, p.ID, "offline checkout", chat.ImageDigest, "1.2.27")
		if err != nil {
			t.Fatal(err)
		}
	}
	ca, host := privateTLS(t, b, image)
	engine, err := docker.New("")
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	img, err := engine.ImageInspect(ctx, image)
	if err != nil {
		t.Fatal(err)
	}
	access, err := NewAccess(b, engine, CheckoutConfig{Host: host, CACert: ca, AuthorName: "Checkout Fixture", AuthorEmail: "checkout@example.test", Timeout: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	m, err := provisioning.New(engine, s, provisioning.Config{ImageRef: image, ImageDigest: chat.ImageDigest, ImageID: img.ID, HarnessVersion: "1.2.27", ReadyTimeout: time.Minute}, access)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		clean, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = engine.ContainerRemove(clean, "flora-chat-"+chat.ID, true)
	})
	upstreamTransport := b.transport
	var outage atomic.Bool
	outage.Store(true)
	b.transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if outage.Load() {
			return response(r, 503, "temporary fixture outage"), nil
		}
		return upstreamTransport.RoundTrip(r)
	})
	if _, err := m.Start(ctx, chat.ID); err == nil {
		t.Fatal("failed checkout allowed startup")
	}
	failed, err := s.Chat(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	paths, err := s.Paths(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(paths.Workspace, "setup-ran")); !os.IsNotExist(err) {
		t.Fatal("setup ran after failed checkout")
	}
	if len(failed.StartingCommits) != 0 {
		t.Fatal("failed checkout recorded a base")
	}
	failedInfo, err := engine.ContainerInspect(ctx, failed.ContainerID)
	if err != nil || failedInfo.State.Running {
		t.Fatal("failed checkout container still running")
	}
	log, err := os.ReadFile(filepath.Join(paths.Logs, "checkout.log"))
	if err != nil || !strings.Contains(string(log), "503") {
		t.Fatal("useful checkout diagnostics were not retained")
	}
	outage.Store(false)
	endpoint, err := m.Start(ctx, chat.ID)
	if err != nil {
		paths, _ := s.Paths(ctx, chat.ID)
		raw, _ := os.ReadFile(filepath.Join(paths.Logs, "checkout.log"))
		t.Fatalf("checkout start: %v; diagnostics: %s", err, raw)
	}
	chat, err = s.Chat(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	sha := chat.StartingCommits[chat.Configuration.Repositories[0].Name]
	if len(sha) != 40 || (expected != "" && sha != expected) {
		t.Fatalf("resolved commit mismatch: %s", sha)
	}
	run := func(script string) string {
		t.Helper()
		var out, diagnostics bytes.Buffer
		exit, err := engine.Exec(ctx, endpoint.ContainerID, "flora", []string{"sh", "-c", ". /home/flora/.flora-github.env\n" + script}, nil, &out, &diagnostics)
		if err != nil || exit != 0 {
			t.Fatalf("container check failed: exit=%d err=%v diagnostics=%s", exit, err, redact(diagnostics.String(), append(credentialForms(liveToken), fixtureToken)))
		}
		return strings.TrimSpace(out.String())
	}
	if run("cat setup-ran") != "ready" {
		t.Fatal("setup did not follow checkout")
	}
	if run("git rev-parse HEAD") != sha {
		t.Fatal("saved SHA differs from checkout")
	}
	if !strings.HasPrefix(run("git var GIT_AUTHOR_IDENT"), "Checkout Fixture <checkout@example.test>") {
		t.Fatal("author override not applied")
	}
	if live {
		if run("gh api repos/rhizomatous/flora --jq .private") != "true" {
			t.Fatal("live repository is not private")
		}
		if !strings.HasPrefix(run("git ls-remote origin refs/heads/main"), sha) {
			t.Fatal("live branch resolution mismatch")
		}
		run("git fetch origin")
		t.Log("Live private repository: container clone, resolved/stored main SHA, gh metadata and fetch passed; no GitHub writes")
	} else {
		run("printf local > local.txt && git add local.txt && git commit -m local && git push -u origin HEAD")
		run("gh pr create --draft --base main --head " + quote("flora/"+chat.ID) + " --title fixture --body fixture")
		if mutations.Load() != 1 {
			t.Fatal("stock gh did not create one fixture draft PR")
		}
	}
	run("printf preserve > uncommitted.txt")
	if err := m.Stop(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	endpoint, err = m.Start(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if run("cat uncommitted.txt") != "preserve" {
		t.Fatal("restart discarded workspace edits")
	}
	if err := access.Revoke(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	if run("gh api repos/"+chat.Configuration.Repositories[0].Name+" >/dev/null 2>&1; printf '%s' \"$?\"") == "0" {
		t.Fatal("revoked credential accepted")
	}
	info, err := engine.ContainerInspect(ctx, endpoint.ContainerID)
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range info.Config.Env {
		if live && strings.Contains(value, liveToken) {
			t.Fatal("administrator token in container environment")
		}
	}
	if live {
		run("! grep -R -q 'github_pat_' /home/flora/.config/gh /workspace/.git/config")
	}
	t.Log("Checkout-to-setup, custom author, retained edits, stop/restart and independent revocation passed")
}
