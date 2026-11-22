package githubbroker

import (
	"context"
	"encoding/json"
	"fmt"
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
	for i := 0; i < 21; i++ {
		if err := s.SaveRuntimeMessage(ctx, fmt.Sprintf("page-%d", i), storage.Message{ChatID: target.ID, Role: "assistant", RuntimeMessageID: fmt.Sprintf("page-%d", i), Text: fmt.Sprintf("Message %d", i), Payload: json.RawMessage(`{}`)}); err != nil {
			t.Fatal(err)
		}
	}
	first := request(b, "GET", endpoint, "", fixtureCapability)
	var page storage.ChatContextPage
	if err := json.Unmarshal(first.Body.Bytes(), &page); err != nil || len(page.Messages) != 20 || page.Before == 0 {
		t.Fatal("missing bounded page", first.Body.String(), err)
	}
	lastSequence := page.Messages[len(page.Messages)-1].Sequence
	next := request(b, "GET", fmt.Sprintf("%s?before=%d", endpoint, page.Before), "", fixtureCapability)
	if err := json.Unmarshal(next.Body.Bytes(), &page); err != nil || len(page.Messages) == 0 || page.Messages[0].Sequence >= lastSequence {
		t.Fatal("cursor repeated or skipped messages", next.Body.String(), err)
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
