package auth

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestSetupResumeExpiryReplacementRestartAndConcurrency(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	store, err := storage.Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	at := time.Now().Truncate(time.Second)
	initial := at
	s := New(store)
	s.Now = func() time.Time { return at }
	link := NewSetupToken()
	save := func(replace bool) {
		t.Helper()
		if err := store.SaveSetupLink(ctx, TokenHash(link), at.Add(SetupLinkLifetime), replace); err != nil {
			t.Fatal(err)
		}
	}
	save(false)
	if _, _, err := s.RedeemSetup(ctx, NewSetupToken()); !errors.Is(err, ErrSetup) {
		t.Fatal(err)
	}
	session, expires, err := s.RedeemSetup(ctx, link)
	if err != nil {
		t.Fatal(err)
	}
	if expires != initial.Add(24*time.Hour) {
		t.Fatal("wrong setup deadline", expires)
	}
	at = at.Add(30 * time.Minute)
	if valid, err := s.SetupValid(ctx, session); err != nil || !valid {
		t.Fatal("interruption lost setup", err)
	}
	second, err := storage.Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	other := New(second)
	other.Now = s.Now
	var wg sync.WaitGroup
	for i := range 8 {
		redeemer := s
		if i%2 == 0 {
			redeemer = other
		}
		wg.Go(func() {
			resumed, deadline, err := redeemer.RedeemSetup(ctx, link)
			if err != nil || resumed != session || deadline != expires {
				t.Errorf("resume changed setup access: %v", err)
			}
		})
	}
	wg.Wait()
	if valid, err := s.Valid(ctx, session); err != nil || valid {
		t.Fatal("setup session authenticated", err)
	}
	if err := second.Close(); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = storage.Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	s = New(store)
	s.Now = func() time.Time { return at }
	if valid, err := s.SetupValid(ctx, session); err != nil || !valid {
		t.Fatal("restart lost setup", err)
	}
	if _, deadline, err := s.RedeemSetup(ctx, link); err != nil || deadline != expires {
		t.Fatal("restart changed link", err)
	}
	at = expires
	save(false)
	if valid, _ := s.SetupValid(ctx, session); valid {
		t.Fatal("expired setup cookie accepted")
	}
	if _, _, err := s.RedeemSetup(ctx, link); !errors.Is(err, ErrSetup) {
		t.Fatal("expired link accepted", err)
	}
	if _, _, err := s.Bootstrap(ctx, "long unique password", session); !errors.Is(err, ErrSetup) {
		t.Fatal(err)
	}
	link = NewSetupToken()
	save(true)
	session, _, err = s.RedeemSetup(ctx, link)
	if err != nil {
		t.Fatal(err)
	}
	old := session
	link = NewSetupToken()
	save(true)
	if valid, _ := s.SetupValid(ctx, old); valid {
		t.Fatal("replacement retained cookie")
	}
	if _, _, err := s.RedeemSetup(ctx, old); !errors.Is(err, ErrSetup) {
		t.Fatal("replacement retained link", err)
	}
	if _, _, err := s.Bootstrap(ctx, "long unique password", old); !errors.Is(err, ErrSetup) {
		t.Fatal("replaced cookie created account", err)
	}
	session, _, err = s.RedeemSetup(ctx, link)
	if err != nil {
		t.Fatal(err)
	}
	results := make(chan error, 4)
	for range 4 {
		wg.Go(func() { _, _, err := s.Bootstrap(ctx, "long unique password", session); results <- err })
	}
	wg.Wait()
	close(results)
	wins := 0
	for err := range results {
		if err == nil {
			wins++
		} else if !errors.Is(err, storage.ErrConflict) {
			t.Fatal(err)
		}
	}
	if wins != 1 {
		t.Fatalf("account winners %d", wins)
	}
	if valid, _ := s.SetupValid(ctx, session); valid {
		t.Fatal("account retained setup")
	}
	if _, _, err := s.RedeemSetup(ctx, link); !errors.Is(err, ErrSetup) {
		t.Fatal("account retained link", err)
	}
	if err := store.SaveSetupLink(ctx, TokenHash(NewSetupToken()), at.Add(time.Hour), true); !errors.Is(err, storage.ErrConflict) {
		t.Fatal("replaced after account creation", err)
	}
	if _, _, err := s.Login(ctx, "long unique password"); err != nil {
		t.Fatal(err)
	}
}

func setupSession(t *testing.T, s *Service) string {
	t.Helper()
	ctx := context.Background()
	link := NewSetupToken()
	if err := s.Store.SaveSetupLink(ctx, TokenHash(link), s.Now().Add(SetupLinkLifetime), true); err != nil {
		t.Fatal(err)
	}
	session, _, err := s.RedeemSetup(ctx, link)
	if err != nil {
		t.Fatal(err)
	}
	return session
}
