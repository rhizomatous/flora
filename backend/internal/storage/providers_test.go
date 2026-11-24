package storage

import (
	"path/filepath"
	"testing"
)

func TestModelDefaultsPreserveQueuedLegacyAndExplicitChats(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	project, legacy := fixture(t, s)
	first := Credentials{Provider: "anthropic", Model: "original", ProviderKey: "anthropic-secret", GitHubToken: "github-token"}
	must(t, s.SaveCredentials(ctx, first))
	queued, err := s.CreateChatRequest(ctx, project.ID, "Queued", image, "1", "queued", "First")
	must(t, err)
	second := Credentials{Provider: "openai", Model: "new-default", ProviderKey: "openai-secret", GitHubToken: first.GitHubToken}
	must(t, s.SaveCredentials(ctx, second))
	explicit := Execution{Provider: first.Provider, Model: "alternate", Variant: "high"}
	chosen, err := s.CreateChatRequestWithExecution(ctx, project.ID, "Explicit", image, "1", "explicit", "First", &explicit)
	must(t, err)
	fresh, err := s.CreateChatRequest(ctx, project.ID, "Fresh", image, "1", "fresh", "First")
	must(t, err)
	// Key rotation must include inactive providers as well as the current default.
	destination := filepath.Join(t.TempDir(), "rotated.key")
	must(t, s.RotateCredentialKey(ctx, destination))
	must(t, s.Close())
	s, err = OpenWithKeyFile(ctx, root, destination)
	must(t, err)
	defer s.Close()
	for _, test := range []struct {
		id   string
		want Execution
	}{
		{legacy.ID, Execution{Provider: first.Provider, Model: first.Model}},
		{queued.ID, Execution{Provider: first.Provider, Model: first.Model}},
		{chosen.ID, explicit},
		{fresh.ID, Execution{Provider: second.Provider, Model: second.Model}},
	} {
		c, err := s.Chat(ctx, test.id)
		must(t, err)
		if c.Execution != test.want {
			t.Fatalf("saved choice: got %+v want %+v", c.Execution, test.want)
		}
		accepted, err := s.AcceptMessage(ctx, c.ID, "followup", "Continue")
		must(t, err)
		if MessageExecution(accepted.Message) != test.want {
			t.Fatal("default change rewrote accepted execution")
		}
		credentials, err := s.ProviderCredentials(ctx, c.Execution)
		must(t, err)
		wantKey := first.ProviderKey
		if c.Execution.Provider == second.Provider {
			wantKey = second.ProviderKey
		}
		if credentials.ProviderKey != wantKey || credentials.Model != test.want.Model || credentials.GitHubToken != first.GitHubToken {
			t.Fatal("chat resolved the wrong connection")
		}
	}
}

func TestModelProviderUpgradeSnapshotsLegacyChats(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	_, legacy := fixture(t, s)
	c := Credentials{Provider: "anthropic", Model: "original", ProviderKey: "provider-secret", GitHubToken: "github-token"}
	must(t, s.SaveCredentials(ctx, c))
	_, err := s.db.Exec(`DROP TABLE model_providers; UPDATE chats SET execution='{}'; PRAGMA user_version=27`)
	must(t, err)
	must(t, s.Close())
	s = openTest(t, root)
	saved, err := s.Chat(ctx, legacy.ID)
	must(t, err)
	if saved.Execution != (Execution{Provider: c.Provider, Model: c.Model}) {
		t.Fatal("upgrade lost legacy chat model", saved.Execution)
	}
	c.Provider, c.Model, c.ProviderKey = "openai", "new-default", "openai-secret"
	must(t, s.SaveCredentials(ctx, c))
	connection, err := s.ProviderCredentials(ctx, saved.Execution)
	must(t, err)
	if connection.ProviderKey != "provider-secret" || connection.Model != "original" {
		t.Fatal("upgraded chat lost original provider")
	}
}
