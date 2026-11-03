package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

const browserDomain = "flora.example.com"

func TestMissingDeploymentIdentity(t *testing.T) {
	ctx := context.Background()
	data := filepath.Join(t.TempDir(), "data")
	store, err := storage.Open(ctx, data)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	dir := filepath.Join(data, "deployment")
	if err := requireDeploymentIdentity(ctx, store, dir); err != nil {
		t.Fatal("empty first-start database should be resumable", err)
	}
	if _, err := store.CreateProject(ctx, "retained", storage.Configuration{Repositories: []storage.Repository{{Name: "octo/demo", URL: "https://github.com/octo/demo.git", BaseBranch: "main", Role: "core"}}}); err != nil {
		t.Fatal(err)
	}
	if err := requireDeploymentIdentity(ctx, store, dir); err == nil {
		t.Fatal("populated database accepted without saved deployment")
	}
	if err := privateDir(dir); err != nil {
		t.Fatal(err)
	}
	d := deployment{Owner: strings.Repeat("a", 48), AgentUID: 1000, AgentGID: 1000}
	if err := saveJSON(filepath.Join(dir, "deployment.json"), d); err != nil {
		t.Fatal(err)
	}
	if err := requireDeploymentIdentity(ctx, store, dir); err == nil {
		t.Fatal("populated database accepted incomplete deployment and could replace saved network/trust")
	}
	d.NetworkID, d.Gateway, d.CAHash = strings.Repeat("b", 64), "172.29.80.1", strings.Repeat("c", 64)
	if err := saveJSON(filepath.Join(dir, "deployment.json"), d); err != nil {
		t.Fatal(err)
	}
	if err := requireDeploymentIdentity(ctx, store, dir); err != nil {
		t.Fatal("complete saved identity rejected", err)
	}
	projects, err := store.Projects(ctx)
	if err != nil || len(projects) != 1 {
		t.Fatal("identity check changed retained data", err)
	}
}

func TestLoopbackAddress(t *testing.T) {
	for _, address := range []string{"127.0.0.1:8080", "127.0.0.2:8080", "[::1]:8080"} {
		if err := loopbackAddress(address); err != nil {
			t.Errorf("%s: %v", address, err)
		}
	}
	for _, address := range []string{":8080", "0.0.0.0:8080", "[::]:8080", "192.168.1.2:8080", "localhost:8080", "127.0.0.1:0", "127.0.0.1:65536", "127.0.0.1:http"} {
		if err := loopbackAddress(address); err == nil {
			t.Errorf("accepted %s", address)
		}
	}
}

func TestPrivateBrokerTrust(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	public, ca, key, err := brokerAuthority(dir)
	if err != nil {
		t.Fatal(err)
	}
	public2, _, _, err := brokerAuthority(dir)
	if err != nil || !bytes.Equal(public, public2) {
		t.Fatal("CA rotated on restart", err)
	}
	cfg := brokerTLS(ca, key)
	cert, err := cfg.GetCertificate(&tls.ClientHelloInfo{ServerName: brokerName})
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(public)
	if _, err := cert.Leaf.Verify(x509.VerifyOptions{Roots: roots, DNSName: brokerName}); err != nil {
		t.Fatal(err)
	}
	if _, err := cfg.GetCertificate(&tls.ClientHelloInfo{ServerName: browserDomain}); err == nil {
		t.Error("broker accepted browser SNI")
	}
	cert.Leaf.NotAfter = time.Now()
	renewed, err := cfg.GetCertificate(&tls.ClientHelloInfo{ServerName: brokerName})
	if err != nil || bytes.Equal(cert.Certificate[0], renewed.Certificate[0]) {
		t.Fatal("private leaf was not renewed", err)
	}
	if _, err := renewed.Leaf.Verify(x509.VerifyOptions{Roots: roots, DNSName: brokerName}); err != nil {
		t.Fatal("renewal changed private trust", err)
	}
	if strings.Contains(string(public), "PRIVATE KEY") {
		t.Error("private key in container trust")
	}
	hash, err := deploymentEnrollment(dir)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(hash)
	_, err = deploymentEnrollment(dir)
	after, _ := os.ReadFile(hash)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("enrollment changed on restart", err)
	}
	if err := os.Chmod(filepath.Join(dir, "broker-ca.pem"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := brokerAuthority(dir); err == nil {
		t.Error("accepted world-readable CA key")
	}
}
