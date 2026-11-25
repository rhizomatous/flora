package storage

import (
	"context"
	"errors"
)

// Onboarding stores navigation separately from connection and project completion.
// An absent row identifies an installation created before guided setup.
type Onboarding struct {
	Started   bool   `json:"started"`
	Step      string `json:"step"`
	Paused    bool   `json:"paused"`
	ProjectID string `json:"projectID"`
}

func (s *Store) Onboarding(ctx context.Context) (Onboarding, error) {
	state := Onboarding{Step: "model"}
	err := s.db.QueryRowContext(ctx, "SELECT step,paused,project_id FROM onboarding WHERE id=1").Scan(&state.Step, &state.Paused, &state.ProjectID)
	if errors.Is(found(err), ErrNotFound) {
		return state, nil
	}
	state.Started = err == nil
	return state, err
}

// SaveOnboarding accepts only navigation and an existing project identity. Clients
// cannot mark a connection complete or persist credentials through this record.
func (s *Store) SaveOnboarding(ctx context.Context, state Onboarding) error {
	switch state.Step {
	case "account", "model", "github", "project", "finish":
	default:
		return ErrInvalid
	}
	if state.ProjectID != "" {
		if _, err := s.Project(ctx, state.ProjectID); err != nil {
			return err
		}
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO onboarding(id,step,paused,project_id) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET step=excluded.step,paused=excluded.paused,project_id=excluded.project_id`, state.Step, state.Paused, state.ProjectID)
	return err
}
