package githubbroker

import (
	"context"
	"encoding/json"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"strings"
	"testing"
)

func TestAgentReadsOnlyReferencedChatsAndGetsCurrentMessages(t *testing.T) {
	s, reader, b := fixture(t)
	ctx := context.Background()
	target, err := s.CreateChat(ctx, reader.ProjectID, "Source", reader.ImageDigest, "1")
	if err != nil {
		t.Fatal(err)
	}
	endpoint := "/api/v3/flora/chats/" + target.ID
	if w := request(b, "GET", endpoint, "", fixtureCapability); w.Code != 404 {
		t.Fatal("unreferenced chat exposed", w.Code)
	}
	refs := []storage.ContextReference{{Kind: "chat", Label: target.Title, ChatID: target.ID}}
	if _, err := s.AcceptMessageWithContext(ctx, reader.ID, "read-source", "Review", nil, refs); err != nil {
		t.Fatal(err)
	}
	save := func(event, text string) {
		t.Helper()
		if err := s.SaveRuntimeMessage(ctx, event, storage.Message{ChatID: target.ID, Role: "assistant", RuntimeMessageID: "source-answer", Text: text, Payload: json.RawMessage(`{}`)}); err != nil {
			t.Fatal(err)
		}
	}
	save("first", "Before")
	if w := request(b, "GET", endpoint, "", fixtureCapability); w.Code != 200 || !strings.Contains(w.Body.String(), "Before") {
		t.Fatal(w.Code, w.Body.String())
	}
	save("changed", "Latest "+fixtureToken)
	if w := request(b, "GET", endpoint, "", fixtureCapability); w.Code != 200 || !strings.Contains(w.Body.String(), "Latest") || strings.Contains(w.Body.String(), fixtureToken) {
		t.Fatal(w.Code, w.Body.String())
	}
	save("long", strings.Repeat("x", 40000))
	if w := request(b, "GET", endpoint, "", fixtureCapability); w.Code != 200 || w.Body.Len() > 34000 || !strings.Contains(w.Body.String(), `"truncated":true`) {
		t.Fatal("unbounded result", w.Code, w.Body.Len())
	}
	if w := request(b, "POST", endpoint, "", fixtureCapability); w.Code != 405 {
		t.Fatal(w.Code)
	}
	if w := request(b, "GET", endpoint+"?before=oops", "", fixtureCapability); w.Code != 400 {
		t.Fatal(w.Code)
	}
	if err := b.Revoke(ctx, reader.ID); err != nil {
		t.Fatal(err)
	}
	if w := request(b, "GET", endpoint, "", fixtureCapability); w.Code != 401 {
		t.Fatal("revoked credential worked", w.Code)
	}
}
