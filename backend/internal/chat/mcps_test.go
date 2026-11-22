package chat

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestMCPFailureBlocksMessageDelivery(t *testing.T) {
	fixture := newFixture(t)
	service, _, project := testService(t, fixture)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		w.Write([]byte("fake-mcp-secret-must-not-leak"))
	}))
	defer server.Close()
	ctx := context.Background()
	if err := service.Store.SaveMCP(ctx, storage.MCPServer{Name: "private-tools", URL: server.URL, Enabled: true, Timeout: 1000, HeaderNames: []string{"Authorization"}, Headers: map[string]string{"Authorization": "fake-mcp-secret-must-not-leak"}}, true); err != nil {
		t.Fatal(err)
	}
	chat, err := service.Create(ctx, project.ID, "Needs tools", "mcp-failure", "Read my notes")
	if err != nil {
		t.Fatal(err)
	}
	chat = waitStatus(t, service, chat.ID, storage.Failed)
	if !strings.Contains(chat.StatusReason, "private-tools: Credentials rejected") || strings.Contains(chat.StatusReason, "fake-mcp-secret") || fixture.prompts.Load() != 0 || fixture.sessions.Load() != 0 {
		t.Fatalf("unexpected delivery or diagnostic: %+v prompts=%d sessions=%d", chat, fixture.prompts.Load(), fixture.sessions.Load())
	}
}
