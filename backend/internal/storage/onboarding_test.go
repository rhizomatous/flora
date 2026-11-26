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
	if !state.Started || state.Step != "model" || state.Completed {
		t.Fatalf("new account: %+v", state)
	}
	project, _ := fixture(t, store)
	state.Step, state.Completed, state.ProjectID = "github", false, project.ID
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

func TestOnboardingCompletionRequiresSavedConfiguration(t *testing.T) {
	store := openTest(t, t.TempDir())
	defer store.Close()
	project, _ := fixture(t, store)
	state := Onboarding{Step: "finish", Completed: true, ProjectID: project.ID}
	if !errors.Is(store.SaveOnboarding(ctx, state), ErrOnboardingIncomplete) {
		t.Fatal("finished without a model and GitHub")
	}
	must(t, store.SaveCredentials(ctx, Credentials{Provider: "anthropic", Model: "configured", ProviderKey: "secret"}))
	if !errors.Is(store.SaveOnboarding(ctx, state), ErrOnboardingIncomplete) {
		t.Fatal("finished without GitHub")
	}
	must(t, store.SaveCredentials(ctx, Credentials{Provider: "anthropic", Model: "configured", ProviderKey: "secret", GitHubToken: "github-secret"}))
	state.ProjectID = ""
	if !errors.Is(store.SaveOnboarding(ctx, state), ErrOnboardingIncomplete) {
		t.Fatal("finished without a project")
	}
	state.ProjectID = project.ID
	must(t, store.SaveOnboarding(ctx, state))
	saved, err := store.Onboarding(ctx)
	must(t, err)
	if !saved.Completed {
		t.Fatal("completion not saved")
	}
}

func TestOnboardingProjectRetriesAndExistingSelection(t *testing.T) {
	store := openTest(t, t.TempDir())
	defer store.Close()
	config := Configuration{Repositories: []Repository{{Name: "owner/garden", URL: "https://github.com/owner/garden.git", BaseBranch: "main", Role: "core"}}}
	// Simultaneous first saves must commit one project and one selection.
	results := make(chan Project, 8)
	failures := make(chan error, 8)
	for range 8 {
		go func() {
			p, err := store.CreateOnboardingProject(ctx, "Retry", config)
			results <- p
			failures <- err
		}()
	}
	var first Project
	for range 8 {
		must(t, <-failures)
		p := <-results
		if first.ID == "" {
			first = p
		}
		if p.ID != first.ID {
			t.Fatalf("retry created another project: %+v", p)
		}
	}
	state, err := store.Onboarding(ctx)
	must(t, err)
	if state.ProjectID != first.ID {
		t.Fatalf("selection not saved: %+v", state)
	}
	list, err := store.Projects(ctx)
	must(t, err)
	if len(list) != 1 {
		t.Fatalf("created %d projects", len(list))
	}
	other, err := store.CreateProject(ctx, "Existing", config)
	must(t, err)
	must(t, store.SaveOnboarding(ctx, Onboarding{Step: "project", ProjectID: other.ID}))
	saved, err := store.CreateOnboardingProject(ctx, "Retry", config)
	must(t, err)
	if saved.ID != other.ID {
		t.Fatalf("lost existing selection: %+v", saved)
	}
}
