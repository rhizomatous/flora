package main

import (
	"errors"
	"net"
	"strconv"
)

// Require a literal loopback IP so name resolution cannot expose browser HTTP.
func loopbackAddress(address string) error {
	host, port, err := net.SplitHostPort(address)
	ip := net.ParseIP(host)
	n, portErr := strconv.Atoi(port)
	if err != nil || ip == nil || !ip.IsLoopback() || portErr != nil || n < 1 || n > 65535 {
		return errors.New("browser HTTP must use a literal loopback IP and port, for example 127.0.0.1:8080")
	}
	return nil
}
