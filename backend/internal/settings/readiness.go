package settings

import (
	"context"
	"errors"
	"reflect"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

// Readiness is a point-in-time prerequisite check, never proof of a successful
// chat. Callers must run it again before handoff. It is not persisted.
type Readiness struct {
	CheckedAt time.Time        `json:"checkedAt"`
	ProjectID string           `json:"projectID"`
	Ready     bool             `json:"ready"`
	Checks    []ReadinessCheck `json:"checks"`
}

type ReadinessCheck struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	OK       bool   `json:"ok"`
	Message  string `json:"message"`
	FixPath  string `json:"fixPath"`
	FixLabel string `json:"fixLabel"`
}

// Host-only snapshots include secrets so rotations during a check invalidate the
// result. Only check results and the selected project ID reach the client.
type readinessConfiguration struct {
	Credentials storage.Credentials
	GitHub      storage.GitHubApp
	Preferences storage.Preferences
	Project     storage.Project
}

func (s *Service) readinessConfiguration(ctx context.Context, projectID string) (readinessConfiguration, error) {
	var c readinessConfiguration
	var err error
	c.Credentials, err = s.Store.Credentials(ctx)
	if err != nil && !errors.Is(err, storage.ErrNotFound) {
		return c, err
	}
	c.GitHub, err = s.Store.GitHubApp(ctx)
	if err != nil && !errors.Is(err, storage.ErrNotFound) {
		return c, err
	}
	c.Preferences, err = s.Store.Preferences(ctx)
	if err != nil {
		return c, err
	}
	c.Project, err = s.Store.Project(ctx, projectID)
	return c, err
}

// CheckReadiness reuses metadata and local dependency diagnostics. It never
// starts a runtime, pulls images, runs setup commands, or submits a message.
func (s *Service) CheckReadiness(ctx context.Context, projectID string, runtimeConfigured bool) Readiness {
	result := Readiness{ProjectID: projectID, Checks: []ReadinessCheck{}}
	add := func(id, name string, ok bool, message, path, label string) {
		result.Checks = append(result.Checks, ReadinessCheck{id, name, ok, message, path, label})
	}
	before, beforeErr := s.readinessConfiguration(ctx, projectID)
	c := before.Credentials
	modelOK := c.Provider != "" && c.Model != "" && c.ProviderKey != ""
	add("model", "Default model", modelOK, "Choose a default model and connect its provider.", "onboarding/model", "Edit model")
	if modelOK {
		result.Checks[len(result.Checks)-1].Message = c.Model
	}
	projectOK := before.Project.ID != "" && len(before.Project.Configuration.Repositories) > 0
	add("project", "Saved project", projectOK, "Select a saved project with a repository.", "onboarding/project", "Choose project")
	if projectOK {
		result.Checks[len(result.Checks)-1].Message = before.Project.Name
	}
	add("runtime", "Chat execution service", runtimeConfigured, chatRuntimeMessage(runtimeConfigured), "settings", "Open installation settings")
	seen := map[string]bool{}
	for _, d := range s.Diagnose(ctx) {
		seen[d.Name] = true
		id, name, path, label := "storage", d.Name, "settings", "Open installation settings"
		switch d.Name {
		case "Docker":
			id = "docker"
		case "Agent image":
			id = "agent-image"
		case "Runtime":
			id, name = "runtime-configuration", "Runtime configuration"
		case "Credentials":
			id = "credentials"
		case "GitHub":
			id, name, path, label = "github-metadata", "GitHub metadata access", "onboarding/github", "Edit GitHub connection"
		case "Model provider":
			id, name, path, label = "model-metadata", "Model metadata access", "onboarding/model", "Edit model"
		}
		if d.OK && (id == "github-metadata" || id == "model-metadata") {
			d.Message = "Metadata accessible"
		}
		add(id, name, d.OK, d.Message, path, label)
	}
	for _, dependency := range []struct{ id, name string }{{"docker", "Docker"}, {"agent-image", "Agent image"}, {"runtime-configuration", "Runtime"}} {
		if !seen[dependency.name] {
			add(dependency.id, dependency.name, false, dependency.name+" could not be checked. Fix the runtime or Docker error, then retry.", "settings", "Open installation settings")
		}
	}
	after, afterErr := s.readinessConfiguration(ctx, projectID)
	stable := beforeErr == nil && afterErr == nil && reflect.DeepEqual(before, after)
	add("configuration", "Saved configuration", stable, "Configuration changed or could not be read. Check your saved settings and retry.", "settings", "Open installation settings")
	if stable {
		result.Checks[len(result.Checks)-1].Message = "Configuration checked"
	}
	result.Ready = true
	for _, check := range result.Checks {
		result.Ready = result.Ready && check.OK
	}
	result.CheckedAt = time.Now().UTC()
	return result
}

func chatRuntimeMessage(configured bool) string {
	if configured {
		return "Execution service configured"
	}
	return "This server has no chat execution service. Restart Flora and check its startup logs."
}
