package auth

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestBootstrapRaceAndDurableSession(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	first, err := storage.Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := storage.Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	services := []*Service{New(first), New(second)}
	var wg sync.WaitGroup
	var mu sync.Mutex
	wins := 0
	var winner string
	for _, s := range services {
		wg.Go(func() {
			token, _, err := s.Bootstrap(ctx, "a long unique password")
			if err != nil && !errors.Is(err, storage.ErrConflict) {
				t.Errorf("bootstrap: %v", err)
			}
			if err == nil {
				mu.Lock()
				wins++
				winner = token
				mu.Unlock()
			}
		})
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("winners=%d", wins)
	}
	hash, err := first.AdministratorHash(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if hash == "a long unique password" || !matches(hash, "a long unique password") || matches(hash, "wrong") {
		t.Fatal("password hashing failed")
	}
	for _, s := range services {
		valid, err := s.Valid(ctx, winner)
		if err != nil || !valid {
			t.Fatalf("durable session: %v %v", valid, err)
		}
	}
	if err := services[1].Logout(ctx, winner); err != nil {
		t.Fatal(err)
	}
	if valid, _ := services[0].Valid(ctx, winner); valid {
		t.Fatal("logout did not revoke")
	}
}

func TestAbsoluteExpiryAndLogin(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	s := New(store)
	at := time.Now().Truncate(time.Second)
	s.Now = func() time.Time { return at }
	token, expires, err := s.Bootstrap(ctx, "a long unique password")
	if err != nil {
		t.Fatal(err)
	}
	if expires.Sub(at) != Lifetime {
		t.Fatalf("lifetime=%v", expires.Sub(at))
	}
	at = expires.Add(-time.Second)
	if ok, _ := s.Valid(ctx, token); !ok {
		t.Fatal("expired too early")
	}
	at = expires
	if ok, _ := s.Valid(ctx, token); ok {
		t.Fatal("session extended or expiry inclusive")
	}
	if _, _, err := s.Login(ctx, "wrong"); !errors.Is(err, ErrLogin) {
		t.Fatalf("login: %v", err)
	}
	fresh, _, err := s.Login(ctx, "a long unique password")
	if err != nil || fresh == token {
		t.Fatalf("login: %v", err)
	}
	if ok, _ := s.Valid(ctx, fresh); !ok {
		t.Fatal("new session invalid")
	}
	if _, _, err := s.Bootstrap(ctx, "short"); !errors.Is(err, ErrPassword) {
		t.Fatal("accepted short password")
	}
}
