package chat

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestRuntimeContextUsesAcceptedBytesOnly(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{"references": []storage.ContextReference{{ID: "snapshot", Kind: "pr", Label: "#42 Context", Source: "https://github.com/owner/repo/pull/42", Version: "head:base:updated", CapturedAt: "2026-11-20T00:00:00Z", Content: "saved description"}}})
	// No runtime or source client is available: delivery must need only the accepted payload.
	parts, err := (&Service{}).runtimeParts(context.Background(), nil, storage.Message{Text: "Review", Payload: raw}, storage.Credentials{})
	if err != nil || len(parts) != 2 {
		t.Fatal(parts, err)
	}
	if parts[0]["text"] != "Review" || !strings.Contains(parts[1]["text"], "saved description") || !strings.Contains(parts[1]["text"], "head:base:updated") || parts[1]["type"] != "text" {
		t.Fatal(parts)
	}
}
