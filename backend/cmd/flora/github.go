package main

import (
	"context"
	"net"

	"github.com/rhizomatous/flora/backend/internal/githubbroker"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

// startGitHub wires checkout and on-demand fetching to the same broker before
// the listener accepts requests. A nil executor enables git/gh proxying only.
func startGitHub(ctx context.Context, store *storage.Store, engine githubbroker.Executor, cfg githubbroker.CheckoutConfig, addr, cert, key string) (*githubbroker.Access, net.Addr, error) {
	broker := githubbroker.New(store)
	var access *githubbroker.Access
	if engine != nil {
		var err error
		access, err = githubbroker.NewAccess(broker, engine, cfg)
		if err != nil {
			return nil, nil, err
		}
	}
	listener, err := serveGitHub(ctx, broker, addr, cert, key)
	return access, listener, err
}
