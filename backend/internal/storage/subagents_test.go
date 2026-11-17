package storage

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestSubagentsPersistSeparateScopedHistory(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	_, c := fixture(t, s)
	must(t, s.BindRuntime(ctx, c.ID, "container", "root"))
	child := Subagent{ID: "child", ParentID: "root", Title: "Inspect code", Status: "working", Collection: "complete"}
	history := []json.RawMessage{
		json.RawMessage(`{"info":{"id":"u","sessionID":"child","role":"user","time":{"created":1}},"parts":[{"type":"text","text":"Inspect code"}]}`),
		json.RawMessage(`{"info":{"id":"a","sessionID":"child","role":"assistant","time":{"created":2}},"parts":[{"type":"text","text":"Result"}]}`),
	}
	must(t, s.SaveSubagent(ctx, c.ID, child, history))
	must(t, s.SaveSubagent(ctx, c.ID, child, history))
	messages, err := s.SubagentMessages(ctx, c.ID, "child")
	must(t, err)
	if len(messages) != 2 || messages[0].Role != "user" || messages[1].Text != "Result" {
		t.Fatalf("wrong child history: %+v", messages)
	}
	main, err := s.Messages(ctx, c.ID)
	must(t, err)
	if len(main) != 0 {
		t.Fatal("child messages leaked into parent")
	}
	if _, err := s.SubagentMessages(ctx, "foreign", "child"); !errors.Is(err, ErrNotFound) {
		t.Fatal("cross-chat history access", err)
	}
	foreign := child
	foreign.ParentID = "foreign"
	foreign.ID = "foreign-child"
	if err := s.SaveSubagent(ctx, c.ID, foreign, history); !errors.Is(err, ErrInvalid) {
		t.Fatal("accepted foreign parent", err)
	}
	invalid := append([]json.RawMessage{}, history...)
	invalid[1] = json.RawMessage(`{"info":{"id":"bad","sessionID":"foreign","role":"assistant"}}`)
	if err := s.SaveSubagent(ctx, c.ID, child, invalid); !errors.Is(err, ErrInvalid) {
		t.Fatal("accepted foreign message", err)
	}
	must(t, s.CaptureSubagentEvent(ctx, c.ID, "foreign", "session.error", json.RawMessage(`{}`)))
	before, err := s.Chat(ctx, c.ID)
	must(t, err)
	must(t, s.CaptureSubagentEvent(ctx, c.ID, "child", "session.error", json.RawMessage(`{}`)))
	after, err := s.Chat(ctx, c.ID)
	must(t, err)
	if before.Status != after.Status || before.ActiveMessageID != after.ActiveMessageID {
		t.Fatal("child changed parent execution")
	}
	must(t, s.MarkSubagentsUnavailable(ctx, c.ID, "runtime_stopped"))
	must(t, s.Close())
	s = openTest(t, root)
	messages, err = s.SubagentMessages(ctx, c.ID, "child")
	must(t, err)
	if len(messages) != 2 {
		t.Fatal("lost saved history")
	}
	agents, err := s.Subagents(ctx, c.ID)
	must(t, err)
	if len(agents) != 1 || agents[0].Number != 1 || agents[0].Collection != "runtime_stopped" {
		t.Fatalf("wrong saved agents: %+v", agents)
	}
	child.Collection = "complete"
	child.Status = "working"
	must(t, s.SaveSubagent(ctx, c.ID, child, history))
	agents, err = s.Subagents(ctx, c.ID)
	must(t, err)
	if len(agents) != 1 || agents[0].Number != 1 {
		t.Fatal("resume changed identity")
	}
}
