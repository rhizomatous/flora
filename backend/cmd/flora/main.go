package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/server"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/webassets"
)

func main() {
	addr := flag.String("listen", "127.0.0.1:8080", "HTTP listen address")
	dataDir := flag.String("data-dir", "./flora-data", "private persistent storage directory (local filesystem)")
	publicURL := flag.String("public-url", "", "required public HTTPS origin, for example https://flora.example.com")
	flag.Parse()
	origin, err := url.Parse(*publicURL)
	if err != nil || origin.Scheme != "https" || origin.Host == "" || origin.User != nil || (origin.Path != "" && origin.Path != "/") || origin.RawQuery != "" || origin.Fragment != "" {
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
	srv := &http.Server{
		Addr:              *addr,
		Handler:           server.New(webassets.FS(), auth.New(store), settings.New(store), "https://"+origin.Host),
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
