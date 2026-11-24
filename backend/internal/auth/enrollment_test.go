package auth

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestSetupExpiryReplacementRestartAndConcurrency(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	store, err := storage.Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	at := time.Now().Truncate(time.Second)
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
	at = at.Add(SetupLinkLifetime)
	save(false)
	if _, _, err := s.RedeemSetup(ctx, link); !errors.Is(err, ErrSetup) {
		t.Fatal("expired link accepted", err)
	}
	save(true)
	second, err := storage.Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	other := New(second)
	other.Now = s.Now
	var wg sync.WaitGroup
	results := make(chan string, 8)
	for i := range 8 {
		redeemer := s
		if i%2 == 0 {
			redeemer = other
		}
		wg.Go(func() {
			session, _, err := redeemer.RedeemSetup(ctx, link)
			if err == nil {
				results <- session
			} else if !errors.Is(err, ErrSetup) {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	close(results)
	sessions := []string{}
	for session := range results {
		sessions = append(sessions, session)
	}
	if len(sessions) != 1 {
		t.Fatalf("redemption winners %d", len(sessions))
	}
	session := sessions[0]
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
	if _, _, err := s.RedeemSetup(ctx, link); !errors.Is(err, ErrSetup) {
		t.Fatal("replayed link", err)
	}
	at = at.Add(SetupSessionLifetime)
	if valid, _ := s.SetupValid(ctx, session); valid {
		t.Fatal("expired session accepted")
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
		t.Fatal("replacement retained session")
	}
	if _, _, err := s.Bootstrap(ctx, "long unique password", old); !errors.Is(err, ErrSetup) {
		t.Fatal("replaced session created account", err)
	}
	session, _, err = s.RedeemSetup(ctx, link)
	if err != nil {
		t.Fatal(err)
	}
	resultsErr := make(chan error, 4)
	for range 4 {
		wg.Go(func() { _, _, err := s.Bootstrap(ctx, "long unique password", session); resultsErr <- err })
	}
	wg.Wait()
	close(resultsErr)
	wins := 0
	for err := range resultsErr {
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
		t.Fatal("account retained setup access")
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
