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
		if err = store.Transition(ctx, c.ID, "", storage.Stopped, "Machine stopped"); err != nil {
			return "", "", err
		}
		if err = store.SetUsageCapture(ctx, c.ID, storage.UsageCapture{Reason: "runtime_stopped"}); err != nil {
			return "", "", err
		}
	}
	return ids[0], ids[1], nil
}
