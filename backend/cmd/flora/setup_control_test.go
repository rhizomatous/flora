package main

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func setupControlDirectory(t *testing.T) string {
	t.Helper()
	// Unix socket paths have a small platform-dependent length limit.
	dir, err := os.MkdirTemp("/tmp", "flora-setup-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	return dir
}

func TestRunningSetupCommands(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	dir := setupControlDirectory(t)
	origin := "https://flora.example.com"
	first, err := deploymentSetup(ctx, store, dir, origin, false)
	if err != nil {
		t.Fatal(err)
	}
	closeControl, err := serveSetupControl(store, dir, origin)
	if err != nil {
		t.Fatal(err)
	}
	defer closeControl()
	info, err := os.Stat(filepath.Join(dir, "setup.sock"))
	if err != nil || info.Mode().Perm() != 0600 || info.Mode()&os.ModeSocket == 0 {
		t.Fatal("unsafe socket", err)
	}
	link, online, err := requestSetupLink(ctx, dir, origin, "show")
	if err != nil || !online || link != first {
		t.Fatal("online show", online, err)
	}
	if link, online, err := requestSetupLink(ctx, dir, "https://wrong.test", "replace"); err == nil || !online || link != "" {
		t.Fatal("accepted wrong origin", online, err)
	}
	service := auth.New(store)
	secret := strings.Split(first, "#setup/")[1]
	session, _, err := service.RedeemSetup(ctx, secret)
	if err != nil {
		t.Fatal(err)
	}
	if link, online, err := requestSetupLink(ctx, dir, origin, "show"); err != nil || !online || link != first {
		t.Fatal("show lost opened link", err)
	}
	replacement, online, err := requestSetupLink(ctx, dir, origin, "replace")
	if err != nil || !online || replacement == first {
		t.Fatal("online replace", err)
	}
	if valid, _ := service.SetupValid(ctx, session); valid {
		t.Fatal("online replacement retained cookie")
	}
	// Concurrent commands must leave the private file and SQLite on the same link.
	var wg sync.WaitGroup
	links := make(chan string, 4)
	for range 4 {
		wg.Go(func() {
			link, online, err := requestSetupLink(ctx, dir, origin, "replace")
			if err != nil || !online {
				t.Errorf("concurrent replace: %v", err)
				return
			}
			links <- link
		})
	}
	wg.Wait()
	close(links)
	validLinks := 0
	for link := range links {
		if valid, err := store.SetupLinkValid(ctx, auth.TokenHash(strings.Split(link, "#setup/")[1]), service.Now()); err != nil {
			t.Fatal(err)
		} else if valid {
			validLinks++
		}
	}
	if validLinks != 1 {
		t.Fatalf("active links %d", validLinks)
	}
	current, online, err := requestSetupLink(ctx, dir, origin, "show")
	if err != nil || !online {
		t.Fatal(err)
	}
	saved, err := privateRead(filepath.Join(dir, "setup-link"))
	if err != nil || string(saved) != current {
		t.Fatal("file and database differ", err)
	}
	session, _, err = service.RedeemSetup(ctx, strings.Split(current, "#setup/")[1])
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.Bootstrap(ctx, "long unique password", session); err != nil {
		t.Fatal(err)
	}
	for _, action := range []string{"show", "replace"} {
		if link, online, err := requestSetupLink(ctx, dir, origin, action); err != nil || !online || link != "" {
			t.Fatal("host command reopened setup", action, err)
		}
	}
}

func TestSetupControlSocketLifecycle(t *testing.T) {
	ctx := context.Background()
	dir := setupControlDirectory(t)
	path := filepath.Join(dir, "setup.sock")
	if _, online, err := requestSetupLink(ctx, dir, "https://flora.test", "show"); err != nil || online {
		t.Fatal("missing socket cannot fall back", err)
	}
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := os.WriteFile(path, []byte("retain me"), 0600); err != nil {
		t.Fatal(err)
	}
	if closeControl, err := serveSetupControl(store, dir, "https://flora.test"); err == nil {
		closeControl()
		t.Fatal("replaced regular file")
	}
	raw, err := os.ReadFile(path)
	if err != nil || string(raw) != "retain me" {
		t.Fatal("damaged regular file", err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	stale, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	stale.SetUnlinkOnClose(false)
	if err := stale.Close(); err != nil {
		t.Fatal(err)
	}
	closeControl, err := serveSetupControl(store, dir, "https://flora.test")
	if err != nil {
		t.Fatal("could not replace stale socket", err)
	}
	closeControl()
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Fatal("socket retained on close", err)
	}
}
