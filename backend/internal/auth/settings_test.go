package auth

import (
	"context"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"testing"
	"time"
)

func TestSessionLifetimeChangesOnlyNewSessions(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	s := New(store)
	now := time.Now().Truncate(time.Second)
	s.Now = func() time.Time { return now }
	old, expires, err := s.Bootstrap(ctx, "a long test password")
	if err != nil {
		t.Fatal(err)
	}
	if expires != now.Add(7*24*time.Hour) {
		t.Fatal("wrong default lifetime")
	}
	p := storage.DefaultPreferences()
	p.SessionSeconds = 3600
	if err := store.SavePreferences(ctx, p); err != nil {
		t.Fatal(err)
	}
	fresh, newExpiry, err := s.Login(ctx, "a long test password")
	if err != nil {
		t.Fatal(err)
	}
	if newExpiry != now.Add(time.Hour) {
		t.Fatal("new lifetime not applied")
	}
	now = now.Add(2 * time.Hour)
	if valid, err := s.Valid(ctx, fresh); err != nil || valid {
		t.Fatal("new session extended or not expired")
	}
	if valid, err := s.Valid(ctx, old); err != nil || !valid {
		t.Fatal("existing expiry changed")
	}
	if err := s.Logout(ctx, old); err != nil {
		t.Fatal(err)
	}
	if valid, err := s.Valid(ctx, old); err != nil || valid {
		t.Fatal("logout did not revoke immediately")
	}
}
