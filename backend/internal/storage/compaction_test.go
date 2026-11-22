package storage

import (
	"errors"
	"testing"
)

func TestCompactionScopeAndReopen(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	_, c := fixture(t, s)
	must(t, s.SaveCredentials(ctx, Credentials{Provider: "anthropic", Model: "test-model", ProviderKey: "fixture", GitHubToken: "fixture"}))
	e := Execution{Provider: "anthropic", Model: "test-model"}
	// The fixture's installation provider is the authority for model choices.
	credentials, err := s.Credentials(ctx)
	must(t, err)
	e.Provider, e.Model = credentials.Provider, credentials.Model
	if e.Model == "" {
		t.Fatal("missing fixture model")
	}
	n := int64(25000)
	must(t, s.SetCompactionThreshold(ctx, c.ID, e, &n))
	must(t, s.Close())
	s = openTest(t, root)
	saved, err := s.CompactionThreshold(ctx, c.ID, e)
	must(t, err)
	if saved == nil || *saved != n {
		t.Fatal("threshold not retained")
	}
	other := e
	other.Model = "other"
	saved, err = s.CompactionThreshold(ctx, c.ID, other)
	must(t, err)
	if saved != nil {
		t.Fatal("threshold leaked to another model")
	}
	if err := s.SetCompactionThreshold(ctx, c.ID, other, &n); !errors.Is(err, ErrStale) {
		t.Fatal(err)
	}
	n = 0
	if err := s.SetCompactionThreshold(ctx, c.ID, e, &n); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	must(t, s.SetCompactionThreshold(ctx, c.ID, e, nil))
	saved, err = s.CompactionThreshold(ctx, c.ID, e)
	must(t, err)
	if saved != nil {
		t.Fatal("default did not clear choice")
	}
}
