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
	"github.com/rhizomatous/flora/backend/internal/changes"
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
	maxRunning := flag.Int("max-running", provisioning.DefaultMaxRunning, "maximum running chat containers, including idle; lowering it does not stop existing containers")
	dockerSocket := flag.String("docker-socket", docker.DefaultSocket, "Docker Engine socket on this host")
	githubHost := flag.String("github-host", "", "private TLS hostname on port 443 reachable from agent containers")
	githubCA := flag.String("github-ca", "", "CA PEM file trusted by agent git/gh for the private GitHub transport")
	flag.Parse()
	maxOverride := 0
	flag.Visit(func(f *flag.Flag) {
		if f.Name == "max-running" {
			maxOverride = *maxRunning
		}
	})
	if *maxRunning <= 0 {
		slog.Error("Set -max-running to a positive number of chat containers")
		os.Exit(1)
	}
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
	var chats *chat.Service
	configuration := settings.New(store)
	configuration.MaxRunningOverride = maxOverride
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
		configuration.RuntimeDiagnostics = func(ctx context.Context) []settings.Diagnostic {
			if _, err := engine.ContainerList(ctx, true, map[string]string{"flora.managed": "true"}); err != nil {
				return []settings.Diagnostic{{Name: "Docker", Message: "Cannot reach Docker. Start Docker and check the configured socket and service-user permissions."}}
			}
			result := []settings.Diagnostic{{Name: "Docker", OK: true, Message: "Docker is reachable."}}
			if _, err := engine.ImageInspect(ctx, *agentImage); err != nil {
				return append(result, settings.Diagnostic{Name: "Agent image", Message: "Pinned image is unavailable locally. A chat start will pull a digest-pinned image. If that fails, check registry access, disk space and the installed image reference."})
			}
			return append(result, settings.Diagnostic{Name: "Agent image", OK: true, Message: "Agent image is available locally."})
		}
		reviewCtx, stopReview := context.WithCancel(ctx)
		reviewDone := make(chan struct{})
		go func() {
			defer close(reviewDone)
			changes.New(store, engine).Run(reviewCtx)
		}()
		defer func() { stopReview(); <-reviewDone }()
		access, _, err := startGitHub(ctx, store, engine, githubbroker.CheckoutConfig{Host: *githubHost, CACert: string(ca), UseChatAuthor: true}, *githubListen, *githubCert, *githubKey)
		if err != nil {
			slog.Error("Cannot configure container GitHub access", "error", err)
			os.Exit(1)
		}
		manager, err := provisioning.New(engine, store, provisioning.Config{ImageRef: *agentImage, ImageDigest: *agentDigest, ImageID: *agentID, HarnessVersion: "1.2.27", MaxRunning: *maxRunning, UseSettings: true, MaxRunningOverride: maxOverride}, access)
		if err != nil {
			slog.Error("Cannot configure pinned agent runtime", "error", err)
			os.Exit(1)
		}
		chats = chat.New(ctx, store, manager)
		if err := chats.Reconcile(ctx); err != nil {
			slog.Error("Saved chat reconciliation unavailable; check storage and Docker")
		}
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
				if err := chats.Reconcile(ctx); err != nil {
					slog.Error("Saved chat reconciliation unavailable; check storage and Docker")
				}
			}
		}()
	}
	if *agentImage == "" && *githubListen != "" {
		if _, _, err := startGitHub(ctx, store, nil, githubbroker.CheckoutConfig{}, *githubListen, *githubCert, *githubKey); err != nil {
			slog.Error("GitHub transport startup failed; check private listen IP and TLS files", "error", err)
			os.Exit(1)
		}
	}
	srv := &http.Server{
		Addr:              *addr,
		Handler:           server.New(webassets.FS(), auth.New(store), configuration, origin, chats),
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

func serveGitHub(ctx context.Context, broker *githubbroker.Broker, addr, certFile, keyFile string) (net.Addr, error) {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, errors.New("GitHub listen address must be a private IP:port")
	}
	ip := net.ParseIP(host)
	if ip == nil || (!ip.IsPrivate() && !ip.IsLoopback()) {
		return nil, errors.New("GitHub listener must bind a private or loopback IP")
	}
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, errors.New("cannot load GitHub TLS certificate and key")
	}
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}
	srv := &http.Server{Handler: broker, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: time.Minute,
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
	return listener.Addr(), nil
}
