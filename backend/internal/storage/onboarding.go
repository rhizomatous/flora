package storage

import (
	"context"
	"errors"
)

var ErrOnboardingIncomplete = errors.New("setup configuration is incomplete")

// Onboarding stores navigation separately from connection and project completion.
// An absent row identifies an installation created before guided setup.
type Onboarding struct {
	Started   bool   `json:"started"`
	Step      string `json:"step"`
	Completed bool   `json:"completed"`
	ProjectID string `json:"projectID"`
}

func (s *Store) Onboarding(ctx context.Context) (Onboarding, error) {
	state := Onboarding{Step: "model"}
	err := s.db.QueryRowContext(ctx, "SELECT step,completed,project_id FROM onboarding WHERE id=1").Scan(&state.Step, &state.Completed, &state.ProjectID)
	if errors.Is(found(err), ErrNotFound) {
		return state, nil
	}
	if state.Step == "finish" {
		state.Step = "project"
	}
	state.Started = err == nil
	return state, err
}

// SaveOnboarding accepts only navigation and an existing project identity. Clients
// cannot mark a connection complete or persist credentials through this record.
// Finishing requires a saved default model, GitHub access, and an existing project.
func (s *Store) SaveOnboarding(ctx context.Context, state Onboarding) error {
	if state.Step == "finish" {
		state.Step = "project"
	}
	switch state.Step {
	case "account", "model", "github", "project":
	default:
		return ErrInvalid
	}
	if state.ProjectID != "" {
		if _, err := s.Project(ctx, state.ProjectID); err != nil {
			return err
		}
	}
	if state.Completed {
		if state.Step != "project" {
			return ErrInvalid
		}
		credentials, err := s.Credentials(ctx)
		if err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
		github, err := s.GitHubConfigured(ctx)
		if err != nil {
			return err
		}
		if credentials.Provider == "" || credentials.Model == "" || credentials.ProviderKey == "" || !github || state.ProjectID == "" {
			return ErrOnboardingIncomplete
		}
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO onboarding(id,step,completed,project_id) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET step=excluded.step,completed=excluded.completed,project_id=excluded.project_id`, state.Step, state.Completed, state.ProjectID)
	return err
}
