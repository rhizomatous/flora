package storage

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestGitHubCapabilitiesUpgradeAndRestart(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	_, chat := fixture(t, s)
	_, err := s.db.Exec("DROP TABLE chat_requests; DROP TABLE github_capabilities; PRAGMA user_version=2")
	must(t, err)
	must(t, s.Close())
	s = openTest(t, root)
	credential := strings.Repeat("credential", 8)
	must(t, s.ReplaceGitHubCapability(ctx, chat.ID, credential, time.Now().Add(time.Hour)))
	var digest string
	must(t, s.db.QueryRow("SELECT digest FROM github_capabilities WHERE chat_id=?", chat.ID).Scan(&digest))
	if digest == credential || strings.Contains(digest, "credential") {
		t.Fatal("saved raw container credential")
	}
	must(t, s.Close())
	s = openTest(t, root)
	id, err := s.GitHubCapability(ctx, credential, time.Now())
	must(t, err)
	if id != chat.ID {
		t.Fatal("credential lost across reopen")
	}
	if _, err := s.Chat(ctx, chat.ID); err != nil {
		t.Fatal("migration lost existing chat")
	}
	if _, err := s.GitHubCapability(ctx, credential, time.Now().Add(2*time.Hour)); !errors.Is(err, ErrNotFound) {
		t.Fatal("expired credential accepted")
	}
	must(t, s.RevokeGitHubCapability(ctx, chat.ID))
	must(t, s.RevokeGitHubCapability(ctx, chat.ID))
	if _, err := s.GitHubCapability(ctx, credential, time.Now()); !errors.Is(err, ErrNotFound) {
		t.Fatal("revoked credential accepted")
	}
}
