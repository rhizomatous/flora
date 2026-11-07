package storage

import (
	"errors"
	"strings"
	"testing"
)

func TestChatRequestUpgradeAndReopen(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	p, original := fixture(t, s)
	_, err := s.db.Exec("DROP TABLE installation_settings; DROP TABLE chat_requests; PRAGMA user_version=3")
	must(t, err)
	must(t, s.Close())
	s = openTest(t, root)
	c, err := s.CreateChatRequest(ctx, p.ID, "Chat", image, "1.2.27", "request", "First")
	must(t, err)
	must(t, s.Close())
	s = openTest(t, root)
	retry, err := s.CreateChatRequest(ctx, p.ID, "Chat", image, "1.2.27", "request", "First")
	must(t, err)
	if retry.ID != c.ID {
		t.Fatal("lost creation deduplication")
	}
	if _, err := s.CreateChatRequest(ctx, p.ID, "Chat", image, "1.2.27", "request", "Changed"); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	if _, err := s.Chat(ctx, original.ID); err != nil {
		t.Fatal("migration lost existing chat")
	}
	chats, err := s.Chats(ctx)
	must(t, err)
	if len(chats) != 2 {
		t.Fatal("duplicate chat")
	}
	if _, err := s.CreateChatRequest(ctx, p.ID, "Chat", image, "1.2.27", "too-large", strings.Repeat("🌸", 32769)); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
}
