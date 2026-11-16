package chat

import (
	"context"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

// Capture a model's context limit from the owning runtime, not a global model
// catalog. Tokens themselves come from the saved main-session message snapshots.
func (s *Service) captureContextLimit(ctx context.Context, rt *runtime, c storage.Chat) {
	usage, err := s.Store.ChatContext(ctx, c.ID)
	if err != nil || usage.Tokens == nil || usage.Limit != nil || usage.Provider == "" || usage.Model == "" {
		return
	}
	var providers struct {
		All []struct {
			ID     string `json:"id"`
			Models map[string]struct {
				Limit struct {
					Context int64 `json:"context"`
				} `json:"limit"`
			} `json:"models"`
		} `json:"all"`
	}
	if usageCall(ctx, rt, "GET", "/provider", nil, &providers) != nil {
		return
	}
	for _, p := range providers.All {
		if p.ID == usage.Provider {
			if model, ok := p.Models[usage.Model]; ok && model.Limit.Context > 0 {
				_ = s.Store.SaveContextLimit(ctx, c.ID, usage.Provider, usage.Model, model.Limit.Context)
			}
			return
		}
	}
}
