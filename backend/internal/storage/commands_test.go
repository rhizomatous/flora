package storage

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestCommandAcceptanceAndRetryAcrossRestart(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	p, _ := fixture(t, s)
	c, err := s.CreateChatRequest(ctx, p.ID, "Review", image, "1.2.27", "create", "/review main")
	must(t, err)
	a, err := s.AcceptMessageWithCommand(ctx, c.ID, "create", "/review main", nil, nil, &Command{Name: "review", Arguments: "main"})
	must(t, err)
	command := MessageCommand(a.Message)
	if command == nil || command.Name != "review" || command.Arguments != "main" || !strings.HasPrefix(command.MessageID, "msg_") || len(command.MessageID) != 30 {
		t.Fatal(command)
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
	literal, err := s.AcceptMessage(ctx, c.ID, "literal", "/unknown")
	must(t, err)
	if literal.Message.Text != "/unknown" || MessageCommand(literal.Message) != nil {
		t.Fatal(literal)
	}
	if MessageCommand(Message{Text: "/review", Payload: json.RawMessage(`{}`)}) != nil {
		t.Fatal("reinterpreted legacy message")
	}
}
