package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

// serveSetupControl handles owner commands inside the running process. The
// private parent directory and socket permissions restrict access to the host
// owner; this handler is never registered on the browser HTTP listener. The caller
// must hold the deployment lock until the returned closer finishes.
func serveSetupControl(store *storage.Store, dir, origin string) (func(), error) {
	path := filepath.Join(dir, "setup.sock")
	if info, err := os.Lstat(path); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return nil, errors.New("setup control path must be a socket")
		}
		// The caller holds the deployment lock, so an old socket has no live owner.
		if err := os.Remove(path); err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	listener, err := net.Listen("unix", path)
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(path, 0600); err != nil {
		listener.Close()
		return nil, err
	}
	var mu sync.Mutex
	mux := http.NewServeMux()
	for _, action := range []string{"show", "replace", "recover"} {
		mux.HandleFunc("POST /"+action, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			if r.Header.Get("Origin") != origin {
				http.Error(w, "Use the configured public URL.", http.StatusForbidden)
				return
			}
			mu.Lock()
			defer mu.Unlock()
			var link string
			var err error
			if action == "recover" {
				link, err = accountRecoveryLink(r.Context(), store, origin)
			} else {
				link, err = deploymentSetup(r.Context(), store, dir, origin, action == "replace")
			}
			if err != nil {
				http.Error(w, "Could not prepare setup link.", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(struct {
				Link string `json:"link"`
			}{link})
		})
	}
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second}
	done := make(chan struct{})
	go func() { defer close(done); _ = server.Serve(listener) }()
	return func() {
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
		_ = server.Close()
		<-done
	}, nil
}

// requestSetupLink contacts the running owner before attempting offline storage.
// Only a failed socket connection permits fallback; an uncertain HTTP response
// must never trigger a second replacement.
func requestSetupLink(ctx context.Context, dir, origin, action string) (string, bool, error) {
	conn, err := (&net.Dialer{}).DialContext(ctx, "unix", filepath.Join(dir, "setup.sock"))
	if err != nil {
		return "", false, nil
	}
	defer conn.Close()
	transport := &http.Transport{DialContext: func(context.Context, string, string) (net.Conn, error) { return conn, nil }, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}
	request, err := http.NewRequestWithContext(ctx, "POST", "http://flora/"+action, nil)
	if err != nil {
		return "", true, err
	}
	request.Header.Set("Origin", origin)
	response, err := client.Do(request)
	if err != nil {
		return "", true, errors.New("setup control request failed; retry the host command")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", true, fmt.Errorf("setup control returned HTTP %d; check the configured public URL and storage", response.StatusCode)
	}
	var result struct {
		Link string `json:"link"`
	}
	err = json.NewDecoder(io.LimitReader(response.Body, 16*1024)).Decode(&result)
	return result.Link, true, err
}

func setupLinkCommand(ctx context.Context, root, keyFile, origin, action string) error {
	if action != "show" && action != "replace" && action != "recover" {
		return errors.New("use -setup-link show or -setup-link replace")
	}
	// Open the terminal before changing state. Never print ownership proof to
	// redirected stdout, stderr, or a service journal.
	tty, err := os.OpenFile("/dev/tty", os.O_WRONLY, 0)
	if err != nil {
		return errors.New("setup link requires an interactive terminal")
	}
	defer tty.Close()
	dir := filepath.Join(root, "deployment")
	link, online, err := requestSetupLink(ctx, dir, origin, action)
	if !online {
		store, unlock, openErr := openCredentialStore(ctx, root, keyFile)
		if openErr != nil {
			return openErr
		}
		defer unlock()
		defer store.Close()
		if action == "recover" {
			link, err = accountRecoveryLink(ctx, store, origin)
		} else {
			link, err = deploymentSetup(ctx, store, dir, origin, action == "replace")
		}
	}
	if err != nil {
		return err
	}
	if link == "" {
		_, err = fmt.Fprintln(tty, "No active setup link. An administrator exists or the link expired.")
	} else {
		_, err = fmt.Fprintf(tty, "Flora account URL: %s\n", link)
	}
	return err
}

// accountRecoveryLink is called only through private host control or while holding
// the deployment lock offline. Replacing the proof invalidates all older links.
func accountRecoveryLink(ctx context.Context, store *storage.Store, origin string) (string, error) {
	secret := auth.NewSetupToken()
	if err := store.SaveRecoveryLink(ctx, auth.TokenHash(secret), time.Now().Add(15*time.Minute)); err != nil {
		return "", err
	}
	return origin + "/#recover/" + secret, nil
}
