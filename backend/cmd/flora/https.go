package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/acme/autocert"
)

func domainName(value string) (string, error) {
	value = strings.ToLower(value)
	if len(value) > 253 || !strings.Contains(value, ".") || net.ParseIP(value) != nil {
		return "", errors.New("-hostname requires a public DNS name without a scheme, port or path")
	}
	for _, part := range strings.Split(value, ".") {
		if len(part) == 0 || len(part) > 63 || part[0] == '-' || part[len(part)-1] == '-' {
			return "", errors.New("invalid DNS hostname")
		}
		for _, c := range part {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
				return "", errors.New("invalid DNS hostname")
			}
		}
	}
	for _, suffix := range []string{".local", ".localhost", ".internal", ".test"} {
		if strings.HasSuffix(value, suffix) {
			return "", errors.New("-hostname requires public ACME; use -public-url and a proxy for private browser trust")
		}
	}
	return value, nil
}

// The host check applies before ACME handling and before browser API/static
// routing. No broker handler or broker certificate is reachable on these sockets.
func onlyHost(domain string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		if !strings.EqualFold(host, domain) || r.TLS != nil && !strings.EqualFold(r.TLS.ServerName, domain) {
			http.Error(w, "unrecognized host", http.StatusMisdirectedRequest)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// autocert owns ACME account keys, challenges, certificate caching and renewal.
// HTTP-01 uses only our explicitly opened port-80 sockets. TLS-ALPN is disabled
// so issuance never opens an extra wildcard listener beside the private broker.
func publicServers(domain, cache string, handler http.Handler, manager *autocert.Manager) (*http.Server, *http.Server, error) {
	if err := privateDir(cache); err != nil {
		return nil, nil, err
	}
	manager.Prompt = autocert.AcceptTOS
	manager.HostPolicy = autocert.HostWhitelist(domain)
	manager.Cache = autocert.DirCache(cache)
	tlsConfig := manager.TLSConfig()
	tlsConfig.MinVersion = tls.VersionTLS12
	tlsConfig.NextProtos = []string{"h2", "http/1.1"}
	https := &http.Server{Handler: onlyHost(domain, handler), TLSConfig: tlsConfig, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: time.Minute}
	redirect := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://"+domain+r.URL.RequestURI(), http.StatusPermanentRedirect)
	})
	httpServer := &http.Server{Handler: onlyHost(domain, manager.HTTPHandler(redirect)), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: time.Minute}
	return httpServer, https, nil
}

func servePublic(ctx context.Context, domain, cache string, addresses []string, handler http.Handler) error {
	plain, secure, err := publicServers(domain, cache, handler, &autocert.Manager{})
	if err != nil {
		return err
	}
	var listeners []net.Listener
	defer func() {
		for _, l := range listeners {
			_ = l.Close()
		}
	}()
	// Open every socket before exposing the enrollment route.
	for _, address := range addresses {
		for _, port := range []string{"80", "443"} {
			l, err := net.Listen("tcp", net.JoinHostPort(address, port))
			if err != nil {
				return fmt.Errorf("public %s:%s: %w; check privileges and existing proxies, or use manual -public-url mode", address, port, err)
			}
			listeners = append(listeners, l)
		}
	}
	done := make(chan error, len(listeners))
	for i, listener := range listeners {
		go func() {
			if i%2 == 0 {
				done <- plain.Serve(listener)
			} else {
				done <- secure.ServeTLS(listener, "", "")
			}
		}()
	}
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = plain.Shutdown(shutdown)
		return secure.Shutdown(shutdown)
	}
}

func privateDir(path string) error {
	if err := os.MkdirAll(path, 0700); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return fmt.Errorf("%s must be a private 0700 directory", filepath.Clean(path))
	}
	return nil
}
