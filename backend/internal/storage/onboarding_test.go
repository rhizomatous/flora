package storage

import (
	"errors"
	"testing"
	"time"
)

func TestOnboardingOwnershipAndResume(t *testing.T) {
	root := t.TempDir()
	store := openTest(t, root)
	state, err := store.Onboarding(ctx)
	must(t, err)
	if state.Started {
		t.Fatal("existing installation forced into setup")
	}
	at := time.Now()
	must(t, store.SaveSetupLink(ctx, "setup", at.Add(time.Hour), false))
	if err := store.BootstrapWithSetup(ctx, "password", "session", at.Add(time.Hour), "wrong", at); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	state, err = store.Onboarding(ctx)
	must(t, err)
	if state.Started {
		t.Fatal("failed enrollment started setup")
	}
	must(t, store.BootstrapWithSetup(ctx, "password", "session", at.Add(time.Hour), "setup", at))
	state, err = store.Onboarding(ctx)
	must(t, err)
	if !state.Started || state.Step != "model" || state.Paused {
		t.Fatalf("new account: %+v", state)
	}
	project, _ := fixture(t, store)
	state.Step, state.Paused, state.ProjectID = "github", true, project.ID
	must(t, store.SaveOnboarding(ctx, state))
	must(t, store.RevokeSession(ctx, "session"))
	must(t, store.Close())
	store = openTest(t, root)
	defer store.Close()
	resumed, err := store.Onboarding(ctx)
	must(t, err)
	if resumed != state {
		t.Fatalf("restart lost progress: %+v", resumed)
	}
	invalid := state
	invalid.Step = "complete"
	if !errors.Is(store.SaveOnboarding(ctx, invalid), ErrInvalid) {
		t.Fatal("accepted fake completion")
	}
	invalid = state
	invalid.ProjectID = "missing"
	if !errors.Is(store.SaveOnboarding(ctx, invalid), ErrNotFound) {
		t.Fatal("accepted missing project")
	}
}

func TestEstablishedAccountDoesNotStartOnboarding(t *testing.T) {
	root := t.TempDir()
	store := openTest(t, root)
	must(t, store.Bootstrap(ctx, "existing-password-hash", "existing-session", time.Now().Add(time.Hour)))
	must(t, store.SaveCredentials(ctx, Credentials{Provider: "anthropic", Model: "configured", ProviderKey: "secret"}))
	must(t, store.Close())
	store = openTest(t, root)
	defer store.Close()
	state, err := store.Onboarding(ctx)
	must(t, err)
	if state.Started {
		t.Fatal("established account entered guided setup")
	}
}
