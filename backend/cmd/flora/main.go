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
	agentImage := flag.String("agent-image", releaseImage, "required pinned Flora agent image reference (embedded in release builds)")
	agentDigest := flag.String("agent-image-digest", "", "recorded name@sha256 image identity (defaults to agent-image)")
	agentID := flag.String("agent-image-id", "", "expected sha256 content ID, required for a local image tag")
	maxRunning := flag.Int("max-running", provisioning.DefaultMaxRunning, "maximum running chat containers, including idle; lowering it does not stop existing containers")
	dockerSocket := flag.String("docker-socket", docker.DefaultSocket, "Docker Engine socket on this host")
	keyFile := flag.String("credential-key-file", "", "private encryption key file outside data-dir (defaults to data-dir.key)")
	rotateKey := flag.String("rotate-credential-key-to", "", "offline: re-encrypt credentials using this separate key file, then exit")
	setupLink := flag.String("setup-link", "", "show or replace first-run setup link, then exit")
	recoverAccount := flag.Bool("recover-account", false, "create a 15-minute account recovery link in the host terminal, then exit")
	flag.Parse()
	if *recoverAccount {
		if *setupLink != "" {
			slog.Error("Use either -recover-account or -setup-link")
			os.Exit(1)
		}
		*setupLink = "recover"
	}
	if *keyFile == "" {
		*keyFile = filepath.Clean(*dataDir) + ".key"
	}
	if *rotateKey != "" {
		store, unlock, err := openCredentialStore(context.Background(), *dataDir, *keyFile)
		if err == nil {
			defer unlock()
		}
		if err == nil {
			err = store.RotateCredentialKey(context.Background(), *rotateKey)
			_ = store.Close()
		}
		if err != nil {
			slog.Error("Credential key rotation failed; retain both key files and use the one matching the committed database", "error", err)
			os.Exit(1)
		}
		slog.Info("Credential key rotation complete; configure -credential-key-file with the destination before restarting")
		return
	}
	if err := loopbackAddress(*addr); err != nil {
		slog.Error("Invalid -listen", "error", err)
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
	if *agentImage == "" && *setupLink == "" {
		slog.Error("An agent image is required for the managed private runtime")
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *setupLink != "" {
		if err := setupLinkCommand(ctx, *dataDir, *keyFile, origin, *setupLink); err != nil {
			slog.Error("Cannot prepare setup link", "error", err)
			os.Exit(1)
		}
		return
	}
	store, unlock, err := openCredentialStore(ctx, *dataDir, *keyFile)
	if err != nil {
		slog.Error("Storage initialization failed; check -data-dir ownership, permissions, free space, and schema version", "error", err)
		os.Exit(1)
	}
	defer unlock()
	defer func() {
		if err := store.Close(); err != nil {
			slog.Error("Storage close failed", "error", err)
		}
	}()

	var chats *chat.Service
	configuration := settings.New(store)
	configuration.MaxRunningOverride = maxOverride
	var automatic deployment
	var brokerOption brokerListenerConfig
	var automaticCA []byte
	var networkID, brokerGateway, githubHost, githubListen string
	{
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
		if err := requireDeploymentIdentity(ctx, store, dir); err != nil {
			slog.Error("Cannot use saved application data", "error", err)
			os.Exit(1)
		}
		d, device, err := prepareDeployment(ctx, engine, dir)
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
		if _, err := deploymentSetup(ctx, store, dir, origin, false); err != nil {
			slog.Error("Cannot prepare private setup link", "error", err)
			os.Exit(1)
		}
		slog.Info("First-run setup link is in the private deployment/setup-link file")
		automatic, automaticCA = d, ca
		networkID, brokerGateway = d.NetworkID, d.Gateway
		githubHost, githubListen = brokerName, net.JoinHostPort(d.Gateway, "443")
		brokerOption = brokerListenerConfig{Device: device, TLS: brokerTLS(cert, key)}
	}
	{
		ca := automaticCA
		engine, err := docker.New(*dockerSocket)
		if err != nil {
			slog.Error("Cannot initialize Docker client")
			os.Exit(1)
		}
		defer engine.Close()
		{
			n, err := engine.NetworkInspect(ctx, networkID)
			if err != nil || n.ID != networkID || n.Driver != "bridge" || n.Internal || len(n.Gateways) != 1 || n.Gateways[0] != brokerGateway || githubHost != brokerName || githubListen != net.JoinHostPort(brokerGateway, "443") {
				slog.Error("Owned bridge or broker listener differs from installed configuration; restore the recorded network before starting Flora")
				os.Exit(1)
			}
		}
		configuration.RuntimeDiagnostics = func(ctx context.Context) []settings.Diagnostic {
			if _, err := engine.ContainerList(ctx, true, map[string]string{"flora.managed": "true"}); err != nil {
				return []settings.Diagnostic{{Name: "Docker", Message: "Cannot reach Docker. Start Docker and check the configured socket and service-user permissions."}}
			}
			result := []settings.Diagnostic{{Name: "Docker", OK: true, Message: "Docker is reachable."}}
			image, err := engine.ImageInspect(ctx, *agentImage)
			if err != nil {
				return append(result, settings.Diagnostic{Name: "Agent image", Message: "Pinned agent image is unavailable locally. Install the configured image on the Docker host, then retry."})
			}
			if *agentID != "" && image.ID != *agentID {
				return append(result, settings.Diagnostic{Name: "Agent image", Message: "Local image differs from the configured image ID. Restore the pinned image or update the startup configuration and restart Flora."})
			}
			result = append(result, settings.Diagnostic{Name: "Agent image", OK: true, Message: "Agent image is available locally."})
			n, err := engine.NetworkInspect(ctx, networkID)
			if err != nil || n.ID != networkID || n.Driver != "bridge" || n.Internal || len(n.Gateways) != 1 || n.Gateways[0] != brokerGateway {
				return append(result, settings.Diagnostic{Name: "Runtime", Message: "The configured Docker network is unavailable or changed. Restore the installed network and restart Flora."})
			}
			return append(result, settings.Diagnostic{Name: "Runtime", OK: true, Message: "Configured Docker network is available."})
		}
		reviewCtx, stopReview := context.WithCancel(ctx)
		reviewDone := make(chan struct{})
		reviewer := changes.New(store, engine)
		go func() {
			defer close(reviewDone)
			reviewer.Run(reviewCtx)
		}()
		defer func() { stopReview(); <-reviewDone }()
		access, _, err := startGitHub(ctx, store, engine, githubbroker.CheckoutConfig{Host: githubHost, CACert: string(ca), UseChatAuthor: true}, githubListen, brokerOption)
		if err != nil {
			slog.Error("Cannot configure container GitHub access", "error", err)
			os.Exit(1)
		}
		cfg := provisioning.Config{NetworkID: networkID, BrokerGateway: brokerGateway, ImageRef: *agentImage, ImageDigest: *agentDigest, ImageID: *agentID, HarnessVersion: "1.2.27", MaxRunning: *maxRunning, UseSettings: true, MaxRunningOverride: maxOverride}
		cfg.AgentUID, cfg.AgentGID = automatic.AgentUID, automatic.AgentGID
		manager, err := provisioning.New(engine, store, cfg, access)
		if err != nil {
			slog.Error("Cannot configure pinned agent runtime", "error", err)
			os.Exit(1)
		}
		chats = chat.New(ctx, store, manager)
		go chats.RunUsage(ctx)
		if err := chats.Reconcile(ctx); err != nil {
			slog.Error("Saved chat reconciliation unavailable; check storage and Docker")
		}
		chats.AutomationBeforeStop = reviewer.Refresh
		if err := store.RecoverAutomationRuns(ctx); err != nil {
			slog.Error("Automation recovery unavailable", "error", err)
		} else {
			go chats.RunAutomations(ctx)
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
	closeSetupControl, err := serveSetupControl(store, filepath.Join(*dataDir, "deployment"), origin)
	if err != nil {
		slog.Error("Cannot start host setup commands", "error", err)
		os.Exit(1)
	}
	defer closeSetupControl()
	authentication := auth.New(store)
	handler := server.New(webassets.FS(), authentication, configuration, origin, chats)
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

func serveGitHub(ctx context.Context, broker *githubbroker.Broker, addr string, option brokerListenerConfig) (net.Addr, error) {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, errors.New("GitHub listen address must be a private IP:port")
	}
	ip := net.ParseIP(host)
	if ip == nil || (!ip.IsPrivate() && !ip.IsLoopback()) {
		return nil, errors.New("GitHub listener must bind a private or loopback IP")
	}
	if option.TLS == nil {
		return nil, errors.New("private broker TLS configuration is required")
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

// openCredentialStore excludes other Flora processes before schema initialization or
// rotation touches SQLite. Storage errors release the deployment lock.
func openCredentialStore(ctx context.Context, root, keyFile string) (*storage.Store, func(), error) {
	if root == "" {
		return nil, nil, storage.ErrInvalid
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, nil, err
	}
	info, err := os.Lstat(root)
	if err != nil || !info.IsDir() {
		return nil, nil, errors.New("data directory must be a directory, not a symlink")
	}
	if err := os.Chmod(root, 0700); err != nil {
		return nil, nil, err
	}
	if err := privateDir(filepath.Join(root, "deployment")); err != nil {
		return nil, nil, err
	}
	unlock, err := lockDeployment(filepath.Join(root, "deployment", "lock"))
	if err != nil {
		return nil, nil, err
	}
	store, err := storage.OpenWithKeyFile(ctx, root, keyFile)
	if err != nil {
		unlock()
		return nil, nil, err
	}
	return store, unlock, nil
}
