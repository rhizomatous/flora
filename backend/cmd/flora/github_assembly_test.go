package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/githubbroker"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

type assemblyExecutor struct {
	mu           sync.Mutex
	credential   string
	fetchedExtra bool
}

func (e *assemblyExecutor) Exec(_ context.Context, id, _ string, _ []string, in io.Reader, out, _ io.Writer) (int, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	raw, _ := io.ReadAll(in)
	script := string(raw)
	if match := regexp.MustCompile(`oauth_token: ([A-Z2-7]+)`).FindStringSubmatch(script); len(match) == 2 {
		e.credential = match[1]
	}
	if strings.Contains(script, "git cat-file") {
		if id != "fixture-container" {
			return 1, nil
		}
		if strings.Contains(script, "owner/extra") {
			e.fetchedExtra = true
		}
		_, _ = io.WriteString(out, strings.Repeat("b", 40))
	}
	return 0, nil
}

func TestGitHubProductionAssemblyMaterializesExtra(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	project, err := store.CreateProject(ctx, "fixture", storage.Configuration{Repositories: []storage.Repository{
		{Name: "owner/core", URL: "https://github.com/owner/core.git", BaseBranch: "main", Role: "core"},
		{Name: "owner/extra", URL: "https://github.com/owner/extra.git", BaseBranch: "next", Role: "extra"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	chat, err := store.CreateChat(ctx, project.ID, "fixture", "fixture@sha256:"+strings.Repeat("a", 64), "1.2.27")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.BindRuntime(ctx, chat.ID, "fixture-container", ""); err != nil {
		t.Fatal(err)
	}
	paths, err := store.Paths(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	fixture := httptest.NewTLSServer(http.NotFoundHandler())
	cert := fixture.TLS.Certificates[0]
	fixture.Close()
	key, err := x509.MarshalPKCS8PrivateKey(cert.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	certFile, keyFile := filepath.Join(dir, "cert.pem"), filepath.Join(dir, "key.pem")
	if err := os.WriteFile(certFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Certificate[0]}), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyFile, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key}), 0600); err != nil {
		t.Fatal(err)
	}
	engine := &assemblyExecutor{}
	access, addr, err := startGitHub(ctx, store, engine, githubbroker.CheckoutConfig{Host: "github.internal", CACert: "fixture-ca"}, "127.0.0.1:0", certFile, keyFile)
	if err != nil {
		t.Fatal(err)
	}
	if err := access.Checkout(ctx, chat, paths, "fixture-container"); err != nil {
		t.Fatal(err)
	}
	engine.mu.Lock()
	credential := engine.credential
	engine.mu.Unlock()
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
	defer client.CloseIdleConnections()
	req, _ := http.NewRequestWithContext(ctx, "POST", "https://"+addr.String()+"/api/v3/flora/repositories", strings.NewReader(`{"repository":"owner/extra"}`))
	req.Header.Set("Authorization", "Bearer "+credential)
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != 200 || !strings.Contains(string(body), "/workspace/repos/owner/extra") {
		t.Fatalf("materialize: %d %s", response.StatusCode, body)
	}
	saved, err := store.Chat(ctx, chat.ID)
	if err != nil || len(saved.StartingCommits) != 2 || saved.StartingCommits["owner/extra"] != strings.Repeat("b", 40) {
		t.Fatalf("extra base: %+v %v", saved.StartingCommits, err)
	}
	engine.mu.Lock()
	defer engine.mu.Unlock()
	if !engine.fetchedExtra {
		t.Fatal("served broker did not execute checkout callback")
	}
}
