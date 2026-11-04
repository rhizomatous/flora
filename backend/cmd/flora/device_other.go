//go:build !linux

package main

import (
	"context"
	"errors"
	"net"
)

func lockDeployment(path string) (func(), error) {
	return nil, errors.New("automatic deployment requires Linux")
}

func listenDevice(ctx context.Context, address, device string) (net.Listener, error) {
	if device != "" {
		return nil, errors.New("automatic deployment requires a local rootful Linux Docker Engine")
	}
	return (&net.ListenConfig{}).Listen(ctx, "tcp", address)
}
