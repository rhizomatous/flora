package storage

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestCeremonyConsumedOnceAndBoundToGrant(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	at := time.Now()
	must(t, s.SaveCeremony(ctx, "proof", "register:session", "session-a", "saved-challenge", at.Add(time.Minute), at))
	if _, err := s.TakeCeremony(ctx, "proof", "login:", "session-a", at); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := s.TakeCeremony(ctx, "proof", "register:session", "session-b", at); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	var accepted atomic.Int32
	var wg sync.WaitGroup
	for range 6 {
		wg.Go(func() {
			data, err := s.TakeCeremony(ctx, "proof", "register:session", "session-a", at)
			if err == nil {
				if data != "saved-challenge" {
					t.Error(data)
				}
				accepted.Add(1)
			} else if !errors.Is(err, ErrNotFound) {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if accepted.Load() != 1 {
		t.Fatal("reused ceremony", accepted.Load())
	}
	must(t, s.SaveCeremony(ctx, "expired", "login:", "browser", "data", at, at))
	if _, err := s.TakeCeremony(ctx, "expired", "login:", "browser", at); !errors.Is(err, ErrNotFound) {
		t.Fatal("accepted expired proof", err)
	}
}

func TestRecoveryRollbackAndConcurrentPasswordVerification(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	at := time.Now()
	expires := at.Add(time.Hour)
	must(t, s.Bootstrap(ctx, "old-password", "old-session", expires))
	must(t, s.RegisterPasskey(ctx, Passkey{ID: "old-key", Name: "Old", Origin: "https://flora.test", Credential: "old-public-key"}, "session", "old-session", "", expires, at))
	must(t, s.SaveRecoveryLink(ctx, "recovery", expires))
	_, err := s.db.Exec("CREATE TRIGGER fail_passkey BEFORE INSERT ON passkeys BEGIN SELECT RAISE(ABORT,'injected'); END")
	must(t, err)
	err = s.RegisterPasskey(ctx, Passkey{ID: "new-key", Name: "New", Origin: "https://flora.test", Credential: "new-public-key"}, "recovery", "recovery", "new-session", expires, at)
	if err == nil {
		t.Fatal("expected insert failure")
	}
	keys, err := s.Passkeys(ctx)
	must(t, err)
	if len(keys) != 1 || keys[0].ID != "old-key" {
		t.Fatal("failed recovery deleted passkeys", keys)
	}
	valid, err := s.SessionValid(ctx, "old-session", at)
	must(t, err)
	if !valid {
		t.Fatal("failed recovery revoked sessions")
	}
	valid, err = s.RecoveryValid(ctx, "recovery", at)
	must(t, err)
	if !valid {
		t.Fatal("failed recovery consumed proof")
	}
	must(t, s.RecoverPassword(ctx, "new-password", "recovery", "replacement-session", expires, at))
	if err := s.CompletePasswordLogin(ctx, "old-password", "racing-session", expires, at); !errors.Is(err, ErrNotFound) {
		t.Fatal("old password verification survived recovery", err)
	}
	must(t, s.CompletePasswordLogin(ctx, "new-password", "fresh-session", expires, at))
}

func TestLastUsablePasskeyAndRevokedRegistration(t *testing.T) {
	s := openTest(t, t.TempDir())
	defer s.Close()
	at := time.Now()
	expires := at.Add(time.Hour)
	must(t, s.Bootstrap(ctx, "", "session", expires))
	origin := "https://flora.test"
	for _, key := range []Passkey{{ID: "current", Name: "Current", Origin: origin}, {ID: "old-address", Name: "Old address", Origin: "https://old.test"}} {
		must(t, s.RegisterPasskey(ctx, key, "session", "session", "", expires, at))
	}
	if err := s.ChangePasskey(ctx, "current", "", true, "session", origin, at); !errors.Is(err, ErrConflict) {
		t.Fatal("removed last usable key", err)
	}
	must(t, s.ChangePasskey(ctx, "old-address", "", true, "session", origin, at))
	must(t, s.RevokeSession(ctx, "session"))
	if err := s.RegisterPasskey(ctx, Passkey{ID: "unwanted"}, "session", "session", "", expires, at); !errors.Is(err, ErrNotFound) {
		t.Fatal("revoked session enrolled key", err)
	}
}
