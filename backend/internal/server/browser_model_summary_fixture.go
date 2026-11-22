//go:build browserfixture

package server

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func seedModelSummaries(ctx context.Context, store *storage.Store, project storage.Project) (string, string, error) {
	var ids []string
	for i, title := range []string{"Review keyboard navigation", "Plan the next task", "Check an older response", "Inspect a custom model"} {
		c, err := store.CreateChat(ctx, project.ID, title, "flora@sha256:"+strings.Repeat("a", 64), "1.2.27")
		if err != nil {
			return "", "", err
		}
		ids = append(ids, c.ID)
		if err = store.BindRuntime(ctx, c.ID, "workspace-stopped", "main-"+c.ID); err != nil {
			return "", "", err
		}
		save := func(session, id, provider, model string, created int) error {
			raw := json.RawMessage(fmt.Sprintf(`{"info":{"id":%q,"role":"assistant","providerID":%q,"modelID":%q,"time":{"created":%d,"completed":%d}},"parts":[{"type":"step-finish","id":"step"}]}`, id, provider, model, created, created+1))
			return store.SaveUsageMessage(ctx, c.ID, session, "", "", raw)
		}
		if i != 1 {
			model := "claude-sonnet-4-6"
			provider := "anthropic"
			if i == 2 {
				model, provider = "", ""
			}
			if i == 3 {
				model, provider = "custom-model-with-a-long-reported-identity-2026-11-22", "custom-provider"
			}
			if err = save("main-"+c.ID, "first", provider, model, 1); err != nil {
				return "", "", err
			}
		}
		if i == 0 {
			if err = save("main-"+c.ID, "second", "anthropic", "claude-haiku-4-5", 3); err != nil {
				return "", "", err
			}
			if err = save("child", "child-response", "openai", "gpt-5", 99); err != nil {
				return "", "", err
			}
			if err = store.SaveSubagent(ctx, c.ID, storage.Subagent{ID: "child", ParentID: "main-" + c.ID, Title: "Check keyboard focus", Status: "idle", Collection: "complete"}, nil); err != nil {
				return "", "", err
			}
		}
		if i == 0 {
			accepted, acceptErr := store.AcceptMessage(ctx, c.ID, "preview-task", "Review keyboard navigation in the chat view. Make actions easy to find and keep drafts intact.")
			if acceptErr != nil {
				return "", "", acceptErr
			}
			text := "The chat view keeps the task in focus, with secondary details available when you need them.\n\n### Keyboard navigation\n\n- Tab through the sidebar and chat controls in reading order.\n- Focus a chat title to see its model and saved state.\n- Press Escape to close a summary and keep your place.\n\n### Drafts stay with the chat\n\nYour follow-up stays in the composer when you switch views or reload. Model choices apply to the next message; saved summaries show what handled earlier responses."
			raw, marshalErr := json.Marshal(map[string]any{
				"info":  map[string]any{"id": "preview-response", "role": "assistant", "providerID": "anthropic", "modelID": "claude-haiku-4-5", "time": map[string]int{"created": 5, "completed": 6}},
				"parts": []map[string]any{{"type": "text", "text": text}},
			})
			if marshalErr != nil {
				return "", "", marshalErr
			}
			if err = store.SaveRuntimeMessage(ctx, "preview-response", storage.Message{ChatID: c.ID, RuntimeMessageID: "preview-response", Role: "assistant", Text: text, Provider: "anthropic", Model: "claude-haiku-4-5", Payload: raw}); err != nil {
				return "", "", err
			}
			if err = store.CompleteTurn(ctx, c.ID, accepted.Message.ID, "Review complete"); err != nil {
				return "", "", err
			}
		}
		if err = store.Transition(ctx, c.ID, "", storage.Stopped, "Machine stopped"); err != nil {
			return "", "", err
		}
		if err = store.SetUsageCapture(ctx, c.ID, storage.UsageCapture{Reason: "runtime_stopped"}); err != nil {
			return "", "", err
		}
	}
	return ids[0], ids[1], nil
}
