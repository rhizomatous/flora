package storage

import (
	"errors"
	"testing"
	"time"
)

func TestSetupCompletionRollbackAndReplacementRace(t *testing.T) {
	root := t.TempDir()
	first := openTest(t, root)
	defer first.Close()
	second := openTest(t, root)
	defer second.Close()
	at := time.Now().Truncate(time.Second)
	must(t, first.SaveSetupLink(ctx, "link-digest", at.Add(time.Hour), false))
	must(t, second.RedeemSetup(ctx, "link-digest", "setup-digest", at, at.Add(time.Minute)))
	// Failed account persistence must retain the setup session for a safe retry.
	_, err := first.db.Exec(`CREATE TRIGGER fail_first_session BEFORE INSERT ON browser_sessions BEGIN SELECT RAISE(ABORT,'injected'); END`)
	must(t, err)
	if err := first.BootstrapWithSetup(ctx, "password-hash", "browser-digest", at.Add(time.Hour), "setup-digest", at); err == nil {
		t.Fatal("expected failed session write")
	}
	if _, err := first.AdministratorHash(ctx); !errors.Is(err, ErrNotFound) {
		t.Fatal("partial account committed", err)
	}
	valid, err := second.SetupSessionValid(ctx, "setup-digest", at)
	must(t, err)
	if !valid {
		t.Fatal("rollback consumed setup")
	}
	_, err = first.db.Exec("DROP TRIGGER fail_first_session")
	must(t, err)
	start := make(chan struct{})
	replaced := make(chan error, 1)
	completed := make(chan error, 1)
	go func() { <-start; replaced <- second.SaveSetupLink(ctx, "replacement-digest", at.Add(time.Hour), true) }()
	go func() {
		<-start
		completed <- first.BootstrapWithSetup(ctx, "password-hash", "browser-digest", at.Add(time.Hour), "setup-digest", at)
	}()
	close(start)
	replaceErr, completeErr := <-replaced, <-completed
	switch {
	case replaceErr == nil && errors.Is(completeErr, ErrNotFound):
		valid, err := first.SetupLinkValid(ctx, "replacement-digest", at)
		must(t, err)
		if !valid {
			t.Fatal("replacement missing")
		}
	case completeErr == nil && errors.Is(replaceErr, ErrConflict):
		valid, err := second.SetupSessionValid(ctx, "setup-digest", at)
		must(t, err)
		if valid {
			t.Fatal("account retained setup")
		}
	default:
		t.Fatalf("replacement=%v completion=%v", replaceErr, completeErr)
	}
}
