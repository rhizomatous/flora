//go:build browserfixture

package main

import (
	"context"
	"encoding/json"
	"flag"
	"io"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/rhizomatous/flora/backend/internal/server"
)

func run() error {
	scenario := flag.String("scenario", "chat", "Browser test scenario")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	instance, err := server.NewBrowserInstance(*scenario)
	if err != nil {
		return err
	}
	defer instance.Close()
	// Print connection details once the app is ready. Closing stdin also ends the
	// fixture, so it cleans up if the Playwright worker exits unexpectedly.
	if err := json.NewEncoder(os.Stdout).Encode(instance); err != nil {
		return err
	}
	closed := make(chan struct{})
	go func() { _, _ = io.Copy(io.Discard, os.Stdin); close(closed) }()
	select {
	case <-ctx.Done():
	case <-closed:
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
