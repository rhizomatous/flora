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
	"path/filepath"
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
	agentImage := flag.String("agent-image", releaseImage, "pinned Flora agent image reference; enables chat execution")
	agentDigest := flag.String("agent-image-digest", "", "recorded name@sha256 image identity (defaults to agent-image)")
	agentID := flag.String("agent-image-id", "", "expected sha256 content ID, required for a local image tag")
	maxRunning := flag.Int("max-running", provisioning.DefaultMaxRunning, "maximum running chat containers, including idle; lowering it does not stop existing containers")
	dockerSocket := flag.String("docker-socket", docker.DefaultSocket, "Docker Engine socket on this host")
	githubHost := flag.String("github-host", "", "private TLS hostname on port 443 reachable from agent containers")
	githubCA := flag.String("github-ca", "", "CA PEM file trusted by agent git/gh for the private GitHub transport")
	networkID := flag.String("agent-network-id", "", "immutable installer-owned Docker bridge ID")
	brokerGateway := flag.String("agent-broker-gateway", "", "inspected private IPv4 bridge gateway for flora-github.internal")
	enrollmentFile := flag.String("enrollment-hash-file", "", "private file containing the installer enrollment code SHA256 digest")
	hostname := flag.String("hostname", "", "public DNS hostname; enables built-in HTTPS and app-managed private Docker networking (Linux)")
	publicListen := flag.String("public-listen", "", "comma-separated assigned local NIC IPs for public 80/443; defaults to one unambiguous IPv4 NIC")
	flag.Parse()
	if *hostname != "" {
		var err error
		*hostname, err = domainName(*hostname)
		if err != nil {
			slog.Error("Invalid -hostname", "error", err)
			os.Exit(1)
		}
		conflict := false
		flag.Visit(func(f *flag.Flag) {
			switch f.Name {
			case "listen", "public-url", "github-listen", "github-host", "github-tls-cert", "github-tls-key", "github-ca", "agent-network-id", "agent-broker-gateway", "enrollment-hash-file":
				conflict = true
			}
		})
		if conflict || *agentImage == "" {
			slog.Error("-hostname requires an agent image and cannot be combined with manual proxy, enrollment or broker settings; existing installs should keep their manual flags")
			os.Exit(1)
		}
		*publicURL = "https://" + *hostname
	} else if *publicListen != "" {
		slog.Error("-public-listen requires -hostname")
		os.Exit(1)
	}
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
	var automatic *deployment
	var brokerOptions []brokerListenerConfig
	var automaticCA []byte
	if *hostname != "" {
		engine, err := docker.New(*dockerSocket)
		if err != nil {
			slog.Error("Cannot initialize local Docker client", "error", err)
			os.Exit(1)
		}
		dir := filepath.Join(*dataDir, "deployment")
		if err := privateDir(dir); err != nil {
			slog.Error("Cannot prepare private deployment directory", "error", err)
			os.Exit(1)
		}
		unlock, err := lockDeployment(filepath.Join(dir, "lock"))
		if err != nil {
			slog.Error("Cannot lock deployment; another Flora process may be using this data directory", "error", err)
			os.Exit(1)
		}
		defer unlock()
		if _, err := os.Lstat(filepath.Join(dir, "deployment.json")); errors.Is(err, os.ErrNotExist) {
			saved, chatErr := store.Chats(ctx)
			_, adminErr := store.AdministratorHash(ctx)
			if chatErr != nil || len(saved) > 0 || !errors.Is(adminErr, storage.ErrNotFound) {
				slog.Error("Existing application data has no automatic deployment identity; restore deployment state or keep the existing manual flags")
				os.Exit(1)
			}
		}
		d, device, err := prepareDeployment(ctx, engine, dir, *hostname, *publicListen)
		_ = engine.Close()
		if err != nil {
			slog.Error("Automatic deployment failed", "error", err)
			os.Exit(1)
		}
		if d.CAHash != "" {
			b, err := privateRead(filepath.Join(dir, "broker-ca.pem"))
			if err != nil || auth.TokenHash(string(b)) != d.CAHash {
				slog.Error("Private broker CA missing or changed; restore saved trust instead of rotating it under retained chats")
				os.Exit(1)
			}
		}
		ca, cert, key, err := brokerAuthority(dir)
		if err != nil {
			slog.Error("Private broker trust unavailable", "error", err)
			os.Exit(1)
		}
		b, err := os.ReadFile(filepath.Join(dir, "broker-ca.pem"))
		if err != nil {
			slog.Error("Cannot read saved broker trust")
			os.Exit(1)
		}
		d.CAHash = auth.TokenHash(string(b))
		if err := saveJSON(filepath.Join(dir, "deployment.json"), d); err != nil {
			slog.Error("Cannot persist broker trust identity", "error", err)
			os.Exit(1)
		}
		*enrollmentFile, err = deploymentEnrollment(dir)
		if err != nil {
			slog.Error("Cannot prepare private administrator enrollment", "error", err)
			os.Exit(1)
		}
		slog.Info("Administrator enrollment code is in a private file; it is accepted only before the first account exists", "file", filepath.Join(dir, "enrollment-code"))
		automatic, automaticCA = &d, ca
		*networkID, *brokerGateway = d.NetworkID, d.Gateway
		*githubHost, *githubListen = brokerName, net.JoinHostPort(d.Gateway, "443")
		brokerOptions = []brokerListenerConfig{{Device: device, TLS: brokerTLS(cert, key)}}
	}
	if *agentImage != "" {
		if *githubListen == "" {
			slog.Error("Chat execution requires -github-listen and private TLS transport settings")
			os.Exit(1)
		}
		ca := automaticCA
		var err error
		if automatic == nil {
			ca, err = os.ReadFile(*githubCA)
		}
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
		if *networkID != "" || *brokerGateway != "" {
			n, err := engine.NetworkInspect(ctx, *networkID)
			if err != nil || n.ID != *networkID || n.Driver != "bridge" || n.Internal || len(n.Gateways) != 1 || n.Gateways[0] != *brokerGateway || *githubHost != "flora-github.internal" || *githubListen != net.JoinHostPort(*brokerGateway, "443") {
				slog.Error("Owned bridge or broker listener differs from installed configuration; restore the recorded network before starting Flora")
				os.Exit(1)
			}
		}
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
		access, _, err := startGitHub(ctx, store, engine, githubbroker.CheckoutConfig{Host: *githubHost, CACert: string(ca), UseChatAuthor: true}, *githubListen, *githubCert, *githubKey, brokerOptions...)
		if err != nil {
			slog.Error("Cannot configure container GitHub access", "error", err)
			os.Exit(1)
		}
		cfg := provisioning.Config{NetworkID: *networkID, BrokerGateway: *brokerGateway, ImageRef: *agentImage, ImageDigest: *agentDigest, ImageID: *agentID, HarnessVersion: "1.2.27", MaxRunning: *maxRunning, UseSettings: true, MaxRunningOverride: maxOverride}
		if automatic != nil {
			cfg.AgentUID, cfg.AgentGID = automatic.AgentUID, automatic.AgentGID
		}
		manager, err := provisioning.New(engine, store, cfg, access)
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
	authentication := auth.New(store)
	if *enrollmentFile != "" {
		if err := authentication.RequireEnrollment(*enrollmentFile); err != nil {
			slog.Error("Cannot load installer enrollment digest; check file ownership, permissions and format")
			os.Exit(1)
		}
	}
	handler := server.New(webassets.FS(), authentication, configuration, origin, chats)
	if automatic != nil {
		slog.Info("Flora starting HTTPS; public DNS and inbound TCP 80/443 must reach this host", "url", *publicURL, "addresses", automatic.Addresses)
		if err := servePublic(ctx, automatic.Domain, filepath.Join(*dataDir, "deployment", "certificates"), automatic.Addresses, handler); err != nil {
			slog.Error("Public HTTPS failed", "error", err)
			os.Exit(1)
		}
		return
	}
	srv := &http.Server{
		Addr:              *addr,
		Handler:           handler,
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

type brokerListenerConfig struct {
	Device string
	TLS    *tls.Config
}

func serveGitHub(ctx context.Context, broker *githubbroker.Broker, addr, certFile, keyFile string, options ...brokerListenerConfig) (net.Addr, error) {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, errors.New("GitHub listen address must be a private IP:port")
	}
	ip := net.ParseIP(host)
	if ip == nil || (!ip.IsPrivate() && !ip.IsLoopback()) {
		return nil, errors.New("GitHub listener must bind a private or loopback IP")
	}
	var option brokerListenerConfig
	if len(options) > 0 {
		option = options[0]
	}
	if option.TLS == nil {
		cert, err := tls.LoadX509KeyPair(certFile, keyFile)
		if err != nil {
			return nil, errors.New("cannot load GitHub TLS certificate and key")
		}
		option.TLS = &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{cert}}
	}
	listener, err := listenDevice(ctx, addr, option.Device)
	if err != nil {
		return nil, err
	}
	srv := &http.Server{Handler: broker, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: time.Minute,
		TLSConfig: option.TLS}
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
