package storage

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestCommandSnapshotsAndRetryAcrossRestart(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	p, _ := fixture(t, s)
	c, err := s.CreateChatRequest(ctx, p.ID, "Review", image, "1.2.27", "create", "/review main")
	must(t, err)
	a, err := s.AcceptMessage(ctx, c.ID, "create", "/review main")
	must(t, err)
	var payload struct {
		Command struct {
			Name, Arguments string
			Version         int
		} `json:"command"`
	}
	must(t, json.Unmarshal(a.Message.Payload, &payload))
	if payload.Command.Name != "review" || payload.Command.Arguments != "main" || payload.Command.Version != 1 || !strings.Contains(MessageInputText(a.Message), "Review target: main") {
		t.Fatal(a.Message)
	}
	if _, err := s.AcceptMessage(ctx, c.ID, "another", "/init"); !errors.Is(err, ErrActive) {
		t.Fatal(err)
	}
	if _, err := s.AcceptMessage(ctx, c.ID, "create", "/review other"); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	must(t, s.CompleteTurn(ctx, c.ID, a.Message.ID, "Done"))
	must(t, s.Close())
	s = openTest(t, root)
	defer s.Close()
	retry, err := s.AcceptMessage(ctx, c.ID, "create", "/review main")
	must(t, err)
	if !retry.Duplicate || retry.Message.ID != a.Message.ID || string(retry.Message.Payload) != string(a.Message.Payload) {
		t.Fatal(retry)
	}
	unavailable, err := s.CreateChat(ctx, p.ID, "Unavailable", image, "other")
	must(t, err)
	if _, err := s.AcceptMessage(ctx, unavailable.ID, "unavailable", "/init"); err == nil {
		t.Fatal("accepted unavailable command")
	}
	if _, err := s.AcceptMessage(ctx, c.ID, "unknown", "/missing"); err == nil {
		t.Fatal("accepted unknown command")
	}
	escaped, err := s.AcceptMessage(ctx, c.ID, "literal", "//review")
	must(t, err)
	if escaped.Message.Text != "//review" || MessageInputText(escaped.Message) != "/review" {
		t.Fatal(escaped)
	}
	if MessageInputText(Message{Text: "/review", Payload: json.RawMessage(`{}`)}) != "/review" {
		t.Fatal("reinterpreted legacy message")
	}
	if _, err := s.CreateChatRequest(ctx, p.ID, "Invalid", image, "1.2.27", "invalid", "/missing"); err == nil {
		t.Fatal("reserved an unknown command")
	}
	if _, err := s.ChatRequest(ctx, p.ID, "invalid"); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
}
