package main

import (
	"context"
	"crypto/tls"
	"errors"
	"flag"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/chat"
	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/githubbroker"
	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/server"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/webassets"
)

func main() {
	addr := flag.String("listen", "127.0.0.1:8080", "HTTP listen address")
	dataDir := flag.String("data-dir", "./flora-data", "private persistent storage directory (local filesystem)")
	publicURL := flag.String("public-url", "", "required public HTTPS origin, for example https://flora.example.com")
	githubListen := flag.String("github-listen", "", "optional private IP:port for container GitHub TLS transport")
	githubCert := flag.String("github-tls-cert", "", "GitHub transport TLS certificate PEM file")
	githubKey := flag.String("github-tls-key", "", "host-only GitHub transport TLS private key PEM file")
	agentImage := flag.String("agent-image", "", "pinned Flora agent image reference; enables chat execution")
	agentDigest := flag.String("agent-image-digest", "", "recorded name@sha256 image identity (defaults to agent-image)")
	agentID := flag.String("agent-image-id", "", "expected sha256 content ID, required for a local image tag")
	dockerSocket := flag.String("docker-socket", docker.DefaultSocket, "Docker Engine socket on this host")
	githubHost := flag.String("github-host", "", "private TLS hostname on port 443 reachable from agent containers")
	githubCA := flag.String("github-ca", "", "CA PEM file trusted by agent git/gh for the private GitHub transport")
	flag.Parse()
	origin, err := publicOrigin(*publicURL)
	if err != nil {
		slog.Error("Set -public-url to the public HTTPS origin, for example https://flora.example.com; configure your reverse proxy to forward to -listen")
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	store, err := storage.Open(ctx, *dataDir)
	if err != nil {
		slog.Error("Storage initialization failed; check -data-dir ownership, permissions, free space, and schema version", "error", err)
		os.Exit(1)
	}
	defer func() {
		if err := store.Close(); err != nil {
			slog.Error("Storage close failed", "error", err)
		}
	}()
	if *githubListen != "" {
		if err := serveGitHub(ctx, store, *githubListen, *githubCert, *githubKey); err != nil {
			slog.Error("GitHub transport startup failed; check private listen IP and TLS files", "error", err)
			os.Exit(1)
		}
	}
	var chats *chat.Service
	if *agentImage != "" {
		if *githubListen == "" {
			slog.Error("Chat execution requires -github-listen and private TLS transport settings")
			os.Exit(1)
		}
		ca, err := os.ReadFile(*githubCA)
		if err != nil {
			slog.Error("Cannot read -github-ca")
			os.Exit(1)
		}
		engine, err := docker.New(*dockerSocket)
		if err != nil {
			slog.Error("Cannot initialize Docker client")
			os.Exit(1)
		}
		defer engine.Close()
		access, err := githubbroker.NewAccess(githubbroker.New(store), engine, githubbroker.CheckoutConfig{Host: *githubHost, CACert: string(ca)})
		if err != nil {
			slog.Error("Cannot configure container GitHub access", "error", err)
			os.Exit(1)
		}
		manager, err := provisioning.New(engine, store, provisioning.Config{ImageRef: *agentImage, ImageDigest: *agentDigest, ImageID: *agentID, HarnessVersion: "1.2.27"}, access)
		if err != nil {
			slog.Error("Cannot configure pinned agent runtime", "error", err)
			os.Exit(1)
		}
		chats = chat.New(ctx, store, manager)
		go func() {
			ticker := time.NewTicker(time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
				}
				if err := chats.EnforceTimeouts(ctx); err != nil {
					slog.Error("Activity timeout enforcement unavailable; check Docker")
				}
			}
		}()
	}
	srv := &http.Server{
		Addr:              *addr,
		Handler:           server.New(webassets.FS(), auth.New(store), settings.New(store), origin, chats),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdown); err != nil {
			slog.Error("HTTP shutdown failed", "error", err)
		}
	}()
	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		slog.Error("HTTP listen failed", "error", err)
		os.Exit(1)
	}
	slog.Info("Flora listening", "address", listener.Addr().String())
	if err := srv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("HTTP server failed", "error", err)
		os.Exit(1)
	}
	<-done
}

func serveGitHub(ctx context.Context, store *storage.Store, addr, certFile, keyFile string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return errors.New("GitHub listen address must be a private IP:port")
	}
	ip := net.ParseIP(host)
	if ip == nil || (!ip.IsPrivate() && !ip.IsLoopback()) {
		return errors.New("GitHub listener must bind a private or loopback IP")
	}
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return errors.New("cannot load GitHub TLS certificate and key")
	}
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	srv := &http.Server{Handler: githubbroker.New(store), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: time.Minute,
		TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{cert}}}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	go func() {
		if err := srv.Serve(tls.NewListener(listener, srv.TLSConfig)); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("GitHub transport stopped; container GitHub access is unavailable")
		}
	}()
	return nil
}
