// Command probe-github-broker is the Flora issue #3 spike: a host-side
// credential broker that lets agent containers run ordinary git
// clone/fetch/push and gh draft-PR operations against authorized
// repositories without ever holding the administrator's GitHub token.
//
// The administrator fine-grained token is read from the environment only
// (FLORA_BROKER_GH_TOKEN) and is injected on the upstream hop. Containers
// receive per-chat, revocable capability tokens minted with the "mint"
// subcommand.
package main

import (
	"crypto/tls"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/rhizomatous/flora/backend/internal/githubbroker"
)

const tokenEnv = "FLORA_BROKER_GH_TOKEN"

func main() {
	if err := run(os.Args[1:]); err != nil {
		slog.Error("probe-github-broker failed", "error", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		usage()
		return errors.New("subcommand required")
	}
	switch args[0] {
	case "serve":
		return serve(args[1:])
	case "mint":
		return mint(args[1:])
	case "revoke":
		return revoke(args[1:])
	case "init-pki":
		return initPKI(args[1:])
	case "fake-upstream":
		return fakeUpstream(args[1:])
	default:
		usage()
		return fmt.Errorf("unknown subcommand %q", args[0])
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `probe-github-broker: host-side GitHub credential broker (issue #3 spike)

Subcommands:
  serve         Run the broker. Reads the administrator token from $%s.
  mint          Mint a per-chat, repo-scoped container capability.
  revoke        Revoke a capability.
  init-pki      Create the host-side CA and broker TLS certificate.
  fake-upstream Serve a token-demanding fake GitHub for offline testing.

Run "<subcommand> -h" for flags.
`, tokenEnv)
}

func serve(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	listen := fs.String("listen", "127.0.0.1:8443", "listen address reachable from containers")
	capsPath := fs.String("caps", "capabilities.json", "host-only capability store path")
	pkiDir := fs.String("pki", "pki", "host-only PKI directory from init-pki")
	hosts := fs.String("hosts", "flora-broker,localhost,127.0.0.1", "comma-separated TLS host names")
	noTLS := fs.Bool("no-tls", false, "serve plain HTTP (loopback development only)")
	gitUpstream := fs.String("git-upstream", "", "override git upstream base URL (offline testing only)")
	apiUpstream := fs.String("api-upstream", "", "override API upstream base URL (offline testing only)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	token := os.Getenv(tokenEnv)
	if token == "" {
		return fmt.Errorf("set the administrator token in $%s (host environment only)", tokenEnv)
	}
	store, err := githubbroker.OpenStore(*capsPath)
	if err != nil {
		return err
	}
	cfg := githubbroker.Config{
		Token:  token,
		Store:  store,
		Logger: slog.Default(),
	}
	if *gitUpstream != "" {
		u, err := url.Parse(*gitUpstream)
		if err != nil {
			return fmt.Errorf("git upstream: %w", err)
		}
		cfg.GitUpstream = u
	}
	if *apiUpstream != "" {
		u, err := url.Parse(*apiUpstream)
		if err != nil {
			return fmt.Errorf("API upstream: %w", err)
		}
		cfg.APIUpstream = u
	}
	broker, err := githubbroker.New(cfg)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		return err
	}
	if !*noTLS {
		pki, err := githubbroker.EnsurePKI(*pkiDir, strings.Split(*hosts, ","))
		if err != nil {
			return err
		}
		cert, err := tls.LoadX509KeyPair(pki.CertPath, pki.KeyPath)
		if err != nil {
			return err
		}
		listener = tls.NewListener(listener, &tls.Config{
			Certificates: []tls.Certificate{cert},
			MinVersion:   tls.VersionTLS12,
		})
		slog.Info("CA certificate for agent images", "path", pki.CACertPath)
	}
	srv := &http.Server{
		Handler:           broker,
		ReadHeaderTimeout: 10 * time.Second,
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		stop := make(chan os.Signal, 1)
		signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
		<-stop
		_ = srv.Close()
	}()
	scheme := "https"
	if *noTLS {
		scheme = "http"
	}
	slog.Info("broker listening", "address", scheme+"://"+listener.Addr().String())
	if err := srv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	<-done
	return nil
}

func mint(args []string) error {
	fs := flag.NewFlagSet("mint", flag.ContinueOnError)
	capsPath := fs.String("caps", "capabilities.json", "host-only capability store path")
	chat := fs.String("chat", "", "chat ID the capability is bound to (required)")
	repoList := fs.String("repos", "", "comma-separated owner/name repositories (required)")
	write := fs.Bool("write", false, "allow push and mutating API calls")
	ttl := fs.Duration("ttl", 24*time.Hour, "capability lifetime")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *chat == "" || *repoList == "" {
		return errors.New("-chat and -repos are required")
	}
	store, err := githubbroker.OpenStore(*capsPath)
	if err != nil {
		return err
	}
	cap, err := store.Mint(*chat, strings.Split(*repoList, ","), *write, *ttl)
	if err != nil {
		return err
	}
	// The capability is a container-side credential; print it so the
	// operator can inject it into the chat container at start time.
	fmt.Printf("capability=%s\nchat=%s\nrepos=%s\nwrite=%t\nexpires=%s\n",
		cap.ID, cap.ChatID, strings.Join(cap.Repos, ","), cap.Write,
		cap.ExpiresAt.Format(time.RFC3339))
	return nil
}

func revoke(args []string) error {
	fs := flag.NewFlagSet("revoke", flag.ContinueOnError)
	capsPath := fs.String("caps", "capabilities.json", "host-only capability store path")
	id := fs.String("cap", "", "capability ID to revoke (required)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *id == "" {
		return errors.New("-cap is required")
	}
	store, err := githubbroker.OpenStore(*capsPath)
	if err != nil {
		return err
	}
	if err := store.Revoke(*id); err != nil {
		return err
	}
	fmt.Println("revoked")
	return nil
}

func initPKI(args []string) error {
	fs := flag.NewFlagSet("init-pki", flag.ContinueOnError)
	pkiDir := fs.String("pki", "pki", "host-only PKI directory")
	hosts := fs.String("hosts", "flora-broker,localhost,127.0.0.1", "comma-separated TLS host names")
	if err := fs.Parse(args); err != nil {
		return err
	}
	pki, err := githubbroker.EnsurePKI(*pkiDir, strings.Split(*hosts, ","))
	if err != nil {
		return err
	}
	fmt.Printf("ca=%s\ncert=%s\n", pki.CACertPath, pki.CertPath)
	return nil
}

// fakeUpstream serves a token-demanding fake GitHub (git smart HTTP plus
// canned REST/GraphQL JSON) for offline integration testing. It needs a
// git binary for http-backend.
func fakeUpstream(args []string) error {
	fs := flag.NewFlagSet("fake-upstream", flag.ContinueOnError)
	listen := fs.String("listen", "127.0.0.1:8080", "listen address")
	root := fs.String("root", "", "directory containing bare owner/name.git repositories (required)")
	token := fs.String("token", "", "administrator-style bearer token to require (required)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *root == "" || *token == "" {
		return errors.New("-root and -token are required")
	}
	fake := &githubbroker.FakeGitHub{
		Git: &githubbroker.GitBackend{ProjectRoot: *root, RequireToken: *token},
	}
	srv := &http.Server{
		Addr:              *listen,
		Handler:           fake,
		ReadHeaderTimeout: 10 * time.Second,
	}
	slog.Info("fake upstream listening", "address", "http://"+*listen, "root", *root)
	return srv.ListenAndServe()
}
