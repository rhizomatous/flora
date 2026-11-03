package main

import (
	"context"
	"net"

	"github.com/rhizomatous/flora/backend/internal/githubbroker"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

// startGitHub wires checkout and on-demand fetching to the same broker before
// the listener accepts requests.
func startGitHub(ctx context.Context, store *storage.Store, engine githubbroker.Executor, cfg githubbroker.CheckoutConfig, addr string, option brokerListenerConfig) (*githubbroker.Access, net.Addr, error) {
	broker := githubbroker.New(store)
	access, err := githubbroker.NewAccess(broker, engine, cfg)
	if err != nil {
		return nil, nil, err
	}
	listener, err := serveGitHub(ctx, broker, addr, option)
	return access, listener, err
}
