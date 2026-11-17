package chat

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type ModelOption struct {
	Provider string   `json:"provider"`
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Variants []string `json:"variants"`
	Image    bool     `json:"image"`
	PDF      bool     `json:"pdf"`
}
type ModelOptions struct {
	Default storage.Execution `json:"default"`
	Models  []ModelOption     `json:"models"`
	Error   string            `json:"error"`
}
type modelCache struct {
	mu      sync.Mutex
	expires time.Time
	value   ModelOptions
}

// Models exposes only the installed provider, whose key is available in every
// container. Discovery never calls inference or returns provider credentials.
func (s *Service) Models(ctx context.Context) ModelOptions {
	credentials, err := s.Store.Credentials(ctx)
	if err != nil {
		return ModelOptions{Models: []ModelOption{}, Error: "Configure a model provider in installation settings."}
	}
	fallback := ModelOptions{Default: storage.Execution{Provider: credentials.Provider, Model: credentials.Model}, Models: []ModelOption{{Provider: credentials.Provider, ID: credentials.Model, Name: credentials.Model, Variants: []string{}}}, Error: "Model discovery is unavailable. You can use the installation default or retry."}
	s.models.mu.Lock()
	defer s.models.mu.Unlock()
	if time.Now().Before(s.models.expires) && s.models.value.Default == fallback.Default {
		return s.models.value
	}
	lookup, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(lookup, "GET", "https://models.dev/api.json", nil)
	client := s.ModelCatalogClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	response, err := client.Do(req)
	if err != nil {
		return fallback
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return fallback
	}
	var catalog map[string]struct {
		Models map[string]struct {
			Name       string `json:"name"`
			Reasoning  bool   `json:"reasoning"`
			ToolCall   bool   `json:"tool_call"`
			Status     string `json:"status"`
			Release    string `json:"release_date"`
			Modalities struct {
				Input []string `json:"input"`
			} `json:"modalities"`
		} `json:"models"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 32<<20)).Decode(&catalog) != nil {
		return fallback
	}
	result := ModelOptions{Default: fallback.Default, Models: []ModelOption{}}
	for id, m := range catalog[credentials.Provider].Models {
		if !(storage.Execution{Provider: credentials.Provider, Model: id}).Valid() {
			continue
		}
		if (!m.ToolCall || m.Status == "deprecated") && id != credentials.Model {
			continue
		}
		name := m.Name
		if name == "" {
			name = id
		}
		result.Models = append(result.Models, ModelOption{Provider: credentials.Provider, ID: id, Name: name, Variants: modelVariants(credentials.Provider, id, m.Reasoning, m.Release), Image: slices.Contains(m.Modalities.Input, "image"), PDF: slices.Contains(m.Modalities.Input, "pdf")})
	}
	if len(result.Models) == 0 {
		return fallback
	}
	if !slices.ContainsFunc(result.Models, func(m ModelOption) bool { return m.ID == credentials.Model }) {
		result.Models = append(result.Models, fallback.Models[0])
	}
	sort.Slice(result.Models, func(i, j int) bool { return result.Models[i].Name < result.Models[j].Name })
	s.models.value, s.models.expires = result, time.Now().Add(5*time.Minute)
	return result
}

// Variant names match ProviderTransform.variants in OpenCode 1.2.27. The owning
// runtime rechecks custom choices before delivery because its catalog may differ.
func modelVariants(provider, id string, reasoning bool, release string) []string {
	if !reasoning {
		return []string{}
	}
	id = strings.ToLower(id)
	switch provider {
	case "anthropic":
		if strings.Contains(id, "opus-4-6") || strings.Contains(id, "sonnet-4-6") || strings.Contains(id, "opus-4.6") || strings.Contains(id, "sonnet-4.6") {
			return []string{"low", "medium", "high", "max"}
		}
		return []string{"high", "max"}
	case "google":
		if strings.Contains(id, "2.5") {
			return []string{"high", "max"}
		}
		if strings.Contains(id, "3.1") {
			return []string{"low", "medium", "high"}
		}
		return []string{"low", "high"}
	case "openai":
		if id == "gpt-5-pro" {
			return []string{}
		}
		efforts := []string{"low", "medium", "high"}
		if strings.Contains(id, "codex") {
			if strings.Contains(id, "5.2") || strings.Contains(id, "5.3") {
				efforts = append(efforts, "xhigh")
			}
			return efforts
		}
		if strings.Contains(id, "gpt-5-") || id == "gpt-5" {
			efforts = append([]string{"minimal"}, efforts...)
		}
		if release >= "2025-11-13" {
			efforts = append([]string{"none"}, efforts...)
		}
		if release >= "2025-12-04" {
			efforts = append(efforts, "xhigh")
		}
		return efforts
	}
	return []string{}
}

func (s *Service) validateExecution(ctx context.Context, selected storage.Execution, attachments []string) error {
	credentials, err := s.Store.Credentials(ctx)
	if err != nil {
		return &ControlError{Reason: "Configure a model provider in installation settings."}
	}
	if !selected.Valid() || selected.Provider != credentials.Provider {
		return &ControlError{Reason: "Choose a model from the installed provider."}
	}
	if selected.Model == credentials.Model && selected.Variant == "" {
		return nil
	}
	options := s.Models(ctx)
	if options.Error != "" {
		return &ControlError{Reason: options.Error}
	}
	for _, m := range options.Models {
		if m.ID != selected.Model {
			continue
		}
		if selected.Variant != "" && !slices.Contains(m.Variants, selected.Variant) {
			return &ControlError{Reason: "This model does not support the selected reasoning effort. Choose an available effort."}
		}
		for _, id := range attachments {
			a, _, err := s.Store.Attachment(ctx, id)
			if err != nil {
				return err
			}
			if strings.HasPrefix(a.MIME, "image/") && !m.Image || a.MIME == "application/pdf" && !m.PDF {
				return &storage.AttachmentError{Reason: "The selected model does not support this attachment. Choose another model or remove the file."}
			}
		}
		return nil
	}
	return &ControlError{Reason: "This model is no longer available. Choose another model."}
}

func validateRuntimeExecution(ctx context.Context, rt *runtime, selected storage.Execution) error {
	var providers struct {
		All []struct {
			ID     string `json:"id"`
			Models map[string]struct {
				Variants map[string]json.RawMessage `json:"variants"`
			} `json:"models"`
		} `json:"all"`
	}
	if err := rt.call(ctx, "GET", "/provider", nil, &providers); err != nil {
		return err
	}
	for _, p := range providers.All {
		if p.ID == selected.Provider {
			if m, ok := p.Models[selected.Model]; ok {
				if selected.Variant == "" {
					return nil
				}
				if _, ok := m.Variants[selected.Variant]; ok {
					return nil
				}
			}
		}
	}
	return errors.New("selected model or reasoning effort is unavailable in this runtime")
}
