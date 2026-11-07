package main

import (
	"context"
	"net"
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

func lockDeployment(path string) (func(), error) {
	fd, err := unix.Open(path, unix.O_CREAT|unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), path)
	if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		_ = f.Close()
		return nil, err
	}
	return func() { _ = f.Close() }, nil
}

// Binding the socket to the bridge device rejects packets arriving through a
// physical NIC or another bridge, even if that peer has a route to our gateway.
// This needs root or CAP_NET_RAW as well as permission to listen on port 443.
func listenDevice(ctx context.Context, address, device string) (net.Listener, error) {
	lc := net.ListenConfig{}
	if device != "" {
		lc.Control = func(_, _ string, raw syscall.RawConn) error {
			var err error
			if e := raw.Control(func(fd uintptr) {
				err = unix.SetsockoptString(int(fd), unix.SOL_SOCKET, unix.SO_BINDTODEVICE, device)
			}); e != nil {
				return e
			}
			return err
		}
	}
	return lc.Listen(ctx, "tcp", address)
}
