package storage

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestEnvironmentValidation(t *testing.T) {
	for _, c := range []EnvironmentChange{
		{"1BAD", "set", "x", false}, {"A-B", "set", "x", false}, {"PATH", "set", "x", false}, {"FLORA_UID", "set", "x", false}, {"OPENCODE_CONFIG_CONTENT", "set", "x", false}, {"SETUP_COMMAND", "set", "x", false}, {"OPENAI_API_KEY", "set", "x", false}, {"LD_PRELOAD", "set", "x", false},
		{"VALUE", "set", strings.Repeat("x", 8193), false}, {"VALUE", "set", "a\x00b", false}, {"VALUE", "set", string([]byte{255}), false}, {"TOKEN", "replace", "", true}, {"TOKEN", "set", "x", true}, {"TOKEN", "keep", "x", true}, {"TOKEN", "remove", "x", true}, {"TOKEN", "guess", "", true},
	} {
		if err := ValidateEnvironment([]EnvironmentChange{c}); err == nil {
			t.Fatalf("accepted invalid variable %s/%s", c.Name, c.Action)
		}
	}
	if ValidateEnvironment([]EnvironmentChange{{"SAME", "set", "", false}, {"SAME", "set", "", false}}) == nil {
		t.Fatal("accepted duplicates")
	}
	large := []EnvironmentChange{}
	for _, n := range []string{"A", "B", "C", "D"} {
		large = append(large, EnvironmentChange{n, "set", strings.Repeat("x", 8192), false})
	}
	if ValidateEnvironment(large) == nil {
		t.Fatal("accepted oversized environment")
	}
	must(t, ValidateEnvironment([]EnvironmentChange{{"EMPTY", "set", "", false}, {"MULTILINE", "set", "a\nb", false}}))
}

func TestEnvironmentSnapshotsSecretActionsRetryAndRotation(t *testing.T) {
	root := filepath.Join(t.TempDir(), "data")
	s := openTest(t, root)
	p, old := fixture(t, s)
	const secret = "environment_fixture_secret_124"
	must(t, s.SaveEnvironment(ctx, "installation", "", []EnvironmentChange{{"REGION", "set", "installation", false}, {"TOKEN", "replace", secret, true}, {"EMPTY", "set", "", false}}))
	must(t, s.SaveEnvironment(ctx, "project", p.ID, []EnvironmentChange{{"REGION", "set", "project", false}}))
	values, err := s.Environment(ctx, "installation", "")
	must(t, err)
	raw, _ := json.Marshal(values)
	if strings.Contains(string(raw), secret) {
		t.Fatal("API metadata exposed secret")
	}
	for _, table := range []string{"environment_variables"} {
		var raw string
		must(t, s.db.QueryRow("SELECT value FROM "+table+" WHERE secret=1 LIMIT 1").Scan(&raw))
		if !strings.HasPrefix(raw, "flora:v1:") || strings.Contains(raw, secret) {
			t.Fatal("secret stored in plaintext")
		}
	}
	overrides := []EnvironmentChange{{"REGION", "set", "chat", false}}
	c, err := s.CreateChatRequestWithEnvironment(ctx, p.ID, "Configured", image, "1", "environment-create", "work", nil, nil, nil, overrides)
	must(t, err)
	env, secrets, err := s.RuntimeEnvironment(ctx, c.ID)
	must(t, err)
	want := []string{"EMPTY=", "REGION=chat", "TOKEN=" + secret}
	if !reflect.DeepEqual(env, want) || !reflect.DeepEqual(secrets, []string{secret}) {
		t.Fatal("effective environment differs")
	}
	previous, _, err := s.RuntimeEnvironment(ctx, old.ID)
	must(t, err)
	if len(previous) != 0 {
		t.Fatal("old chat inherited defaults")
	}
	must(t, s.SaveEnvironment(ctx, "installation", "", []EnvironmentChange{{"TOKEN", "keep", "", true}}))
	if s.SaveEnvironment(ctx, "installation", "", []EnvironmentChange{{"TOKEN", "replace", "", true}}) == nil {
		t.Fatal("blank deleted secret")
	}
	must(t, s.SaveEnvironment(ctx, "installation", "", []EnvironmentChange{{"TOKEN", "replace", "replacement_fixture_124", true}}))
	must(t, s.SaveEnvironment(ctx, "project", p.ID, []EnvironmentChange{{"REGION", "set", "later", false}}))
	retry, err := s.CreateChatRequestWithEnvironment(ctx, p.ID, "Configured", image, "1", "environment-create", "work", nil, nil, nil, overrides)
	must(t, err)
	if retry.ID != c.ID {
		t.Fatal("retry created a chat")
	}
	_, err = s.CreateChatRequestWithEnvironment(ctx, p.ID, "Configured", image, "1", "environment-create", "work", nil, nil, nil, nil)
	if !errors.Is(err, ErrConflict) {
		t.Fatal("changed overrides accepted")
	}
	must(t, s.SaveEnvironment(ctx, "installation", "", []EnvironmentChange{{"TOKEN", "remove", "", true}}))
	if s.SaveEnvironment(ctx, "installation", "", []EnvironmentChange{{"TOKEN", "keep", "", true}}) == nil {
		t.Fatal("kept missing secret")
	}
	next, err := s.CreateChat(ctx, p.ID, "Automation", image, "1")
	must(t, err)
	nextEnv, nextSecrets, err := s.RuntimeEnvironment(ctx, next.ID)
	must(t, err)
	if len(nextSecrets) != 0 || !reflect.DeepEqual(nextEnv, []string{"EMPTY=", "REGION=later"}) {
		t.Fatal("new chat missed changed defaults")
	}
	newKey := filepath.Join(filepath.Dir(root), "rotated.key")
	must(t, s.RotateCredentialKey(ctx, newKey))
	must(t, s.Close())
	reopened, err := OpenWithKeyFile(ctx, root, newKey)
	must(t, err)
	defer reopened.Close()
	env, _, err = reopened.RuntimeEnvironment(ctx, c.ID)
	must(t, err)
	if !reflect.DeepEqual(env, want) {
		t.Fatal("restart or rotation changed snapshot")
	}
	_, err = reopened.CreateChatRequestWithEnvironment(ctx, p.ID, "Configured", image, "1", "environment-create", "work", nil, nil, nil, overrides)
	must(t, err)
}

func TestEnvironmentPreviewAndAtomicFailure(t *testing.T) {
	s := openTest(t, t.TempDir())
	p, _ := fixture(t, s)
	must(t, s.SaveEnvironment(ctx, "installation", "", []EnvironmentChange{{"TOKEN", "replace", "fixture_private_token", true}}))
	preview, err := s.PreviewEnvironment(ctx, p.ID, []EnvironmentChange{{"TOKEN", "keep", "", true}})
	must(t, err)
	if len(preview) != 1 || preview[0].Value != "" || !preview[0].Secret {
		t.Fatal("preview leaked secret")
	}
	_, err = s.PreviewEnvironment(ctx, p.ID, []EnvironmentChange{{"TOKEN", "remove", "", true}})
	must(t, err)
	if err := s.SaveEnvironment(ctx, "installation", "", []EnvironmentChange{{"ORDINARY", "set", "valid", false}, {"MISSING", "keep", "", true}}); err == nil {
		t.Fatal("invalid patch succeeded")
	}
	values, err := s.Environment(ctx, "installation", "")
	must(t, err)
	if len(values) != 1 || values[0].Name != "TOKEN" {
		t.Fatal("partial patch committed")
	}
}

func TestEnvironmentOnlyEncryptionMarkerCannotBeRecreated(t *testing.T) {
	root := filepath.Join(t.TempDir(), "data")
	s := openTest(t, root)
	must(t, s.SaveEnvironment(ctx, "installation", "", []EnvironmentChange{{"TOKEN", "replace", "fixture_marker_secret", true}}))
	_, err := s.db.Exec("DELETE FROM credential_encryption")
	must(t, err)
	must(t, s.Close())
	must(t, os.Remove(root+".key"))
	reopened, err := Open(ctx, root)
	if err == nil {
		reopened.Close()
		t.Fatal("generated a key over existing environment secrets")
	}
	if _, err := os.Stat(root + ".key"); !os.IsNotExist(err) {
		t.Fatal("replaced missing encryption key")
	}
}

func TestChatSecretOverrideAndRemovalAreEncrypted(t *testing.T) {
	s := openTest(t, t.TempDir())
	project, _ := fixture(t, s)
	must(t, s.SaveEnvironment(ctx, "installation", "", []EnvironmentChange{{"TOKEN", "replace", "installation_fixture_secret", true}, {"REMOVED", "set", "inherited", false}}))
	const secret = "chat_override_fixture_secret"
	changes := []EnvironmentChange{{"TOKEN", "replace", secret, true}, {"REMOVED", "remove", "", false}}
	c, err := s.CreateChatRequestWithEnvironment(ctx, project.ID, "Secrets", image, "1", "secret-request", "work", nil, nil, nil, changes)
	must(t, err)
	env, _, err := s.RuntimeEnvironment(ctx, c.ID)
	must(t, err)
	if !reflect.DeepEqual(env, []string{"TOKEN=" + secret}) {
		t.Fatal("chat secret override or inherited removal failed")
	}
	var input string
	must(t, s.db.QueryRow("SELECT input FROM chat_environment_requests WHERE chat_id=?", c.ID).Scan(&input))
	if !strings.HasPrefix(input, "flora:v1:") || strings.Contains(input, secret) {
		t.Fatal("chat request secret persisted in plaintext")
	}
	values, err := s.Environment(ctx, "chat", c.ID)
	must(t, err)
	raw, _ := json.Marshal(values)
	if strings.Contains(string(raw), secret) || strings.Contains(string(raw), "REMOVED") {
		t.Fatal("snapshot metadata exposed secret or ignored removal")
	}
}
