package settings

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestReadinessRecoveryAndFreshConfiguration(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	credentials := storage.Credentials{Provider: "openai", Model: "model", ProviderKey: "provider-SECRET", GitHubToken: "github_pat_SECRET"}
	if err := store.SaveCredentials(ctx, credentials); err != nil {
		t.Fatal(err)
	}
	project, err := store.CreateProject(ctx, "Garden", storage.Configuration{Repositories: []storage.Repository{{Name: "owner/repo", URL: "https://github.com/owner/repo", BaseBranch: "main", Role: "core"}}, SetupCommand: "must never run"})
	if err != nil {
		t.Fatal(err)
	}
	s := New(store)
	s.DiscoverModel = func(context.Context, storage.Credentials) (string, error) {
		t.Fatal("readiness attempted model discovery")
		return "", nil
	}
	fail, rotate := true, false
	validations := 0
	s.Validate = func(context.Context, storage.Credentials) error {
		validations++
		if rotate {
			rotate = false
			credentials.ProviderKey = "rotated-SECRET"
			if err := store.SaveCredentials(ctx, credentials); err != nil {
				t.Fatal(err)
			}
		}
		return nil
	}
	s.RuntimeDiagnostics = func(context.Context) []Diagnostic {
		return []Diagnostic{{"Docker", !fail, "Start Docker and check socket permissions."}, {"Agent image", true, "Image available"}, {"Runtime", true, "Network available"}}
	}
	result := s.CheckReadiness(ctx, project.ID, true)
	if result.Ready || result.CheckedAt.IsZero() {
		t.Fatal("failed Docker was ready", result)
	}
	fail = false
	result = s.CheckReadiness(ctx, project.ID, true)
	if !result.Ready || result.ProjectID != project.ID {
		t.Fatal("retry did not recover", result)
	}
	rotate = true
	result = s.CheckReadiness(ctx, project.ID, true)
	if result.Ready {
		t.Fatal("rotation during checks accepted")
	}
	if !s.CheckReadiness(ctx, project.ID, true).Ready {
		t.Fatal("rotated configuration could not recover")
	}
	if s.CheckReadiness(ctx, project.ID, false).Ready {
		t.Fatal("missing service was ready")
	}
	if s.CheckReadiness(ctx, "missing", true).Ready {
		t.Fatal("missing project was ready")
	}
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), "SECRET") || strings.Contains(string(raw), "must never run") {
		t.Fatal("private configuration leaked")
	}
	if validations != 12 {
		t.Fatalf("expected metadata validation only: %d", validations)
	}
	chats, err := store.Chats(ctx)
	if err != nil || len(chats) != 0 {
		t.Fatal("readiness created work", chats, err)
	}
}
