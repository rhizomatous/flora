package chat

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
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
	mu       sync.Mutex
	expires  time.Time
	value    ModelOptions
	identity [32]byte
}

// runtimeProviders contains only public metadata. Keys and provider options never
// enter the browser response or the model cache.
type runtimeProviders struct {
	All []struct {
		ID     string `json:"id"`
		Models map[string]struct {
			Name         string                     `json:"name"`
			Status       string                     `json:"status"`
			Variants     map[string]json.RawMessage `json:"variants"`
			Capabilities struct {
				ToolCall bool `json:"toolcall"`
				Input    struct {
					Image bool `json:"image"`
					PDF   bool `json:"pdf"`
				} `json:"input"`
			} `json:"capabilities"`
		} `json:"models"`
	} `json:"all"`
	Connected []string `json:"connected"`
}

// Models reads the owning runtime for a running chat. New and stopped chats use
// cached metadata from a disposable instance of the installed, pinned runtime.
// Discovery never creates a session or submits a prompt.
func (s *Service) Models(ctx context.Context, chatIDs ...string) ModelOptions {
	credentials, err := s.Store.Credentials(ctx)
	if err != nil {
		return ModelOptions{Models: []ModelOption{}, Error: "Configure a model provider in installation settings."}
	}
	fallback := ModelOptions{Default: storage.Execution{Provider: credentials.Provider, Model: credentials.Model}, Models: []ModelOption{{Provider: credentials.Provider, ID: credentials.Model, Name: credentials.Model, Variants: []string{}}}, Error: "Model discovery is unavailable. You can use the installation default or retry."}
	if s.provisioner == nil {
		return fallback
	}
	lookup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if len(chatIDs) > 0 && chatIDs[0] != "" {
		c, err := s.Store.Chat(lookup, chatIDs[0])
		if err != nil {
			return fallback
		}
		if c.ContainerID != "" && c.Status != storage.Stopped {
			endpoint, err := s.provisioner.Endpoint(lookup, c.ID)
			if err != nil {
				return fallback
			}
			rt := newRuntime(endpoint)
			defer rt.client.CloseIdleConnections()
			var providers runtimeProviders
			if rt.call(lookup, "GET", "/provider", nil, &providers) != nil {
				return fallback
			}
			return providerOptions(providers, fallback)
		}
		image, version := s.provisioner.Identity()
		if c.ImageDigest != image || c.HarnessVersion != version {
			return fallback
		}
	}
	// A changed credential or pinned runtime must not reuse an older discovery.
	image, version := s.provisioner.Identity()
	identity := sha256.Sum256([]byte(credentials.Provider + "\x00" + credentials.Model + "\x00" + credentials.ProviderKey + "\x00" + image + "\x00" + version))
	s.models.mu.Lock()
	defer s.models.mu.Unlock()
	if time.Now().Before(s.models.expires) && s.models.identity == identity {
		return s.models.value
	}
	raw, err := s.provisioner.ModelMetadata(lookup, credentials)
	if err != nil {
		return fallback
	}
	var providers runtimeProviders
	if json.Unmarshal(raw, &providers) != nil {
		return fallback
	}
	result := providerOptions(providers, fallback)
	if result.Error == "" {
		s.models.value, s.models.expires, s.models.identity = result, time.Now().Add(5*time.Minute), identity
	}
	return result
}

func providerOptions(providers runtimeProviders, fallback ModelOptions) ModelOptions {
	if !slices.Contains(providers.Connected, fallback.Default.Provider) {
		return fallback
	}
	result := ModelOptions{Default: fallback.Default, Models: []ModelOption{}}
	for _, p := range providers.All {
		if p.ID != fallback.Default.Provider {
			continue
		}
		for id, m := range p.Models {
			if !(storage.Execution{Provider: p.ID, Model: id}).Valid() || !m.Capabilities.ToolCall || m.Status == "deprecated" {
				continue
			}
			variants := []string{}
			for name, raw := range m.Variants {
				var variant struct {
					Disabled bool `json:"disabled"`
				}
				if json.Unmarshal(raw, &variant) == nil && !variant.Disabled && (storage.Execution{Provider: p.ID, Model: id, Variant: name}).Valid() {
					variants = append(variants, name)
				}
			}
			// Keep familiar effort order, while preserving arbitrary runtime variant names.
			order := []string{"none", "minimal", "low", "medium", "high", "xhigh", "max"}
			sort.Slice(variants, func(i, j int) bool {
				a, b := slices.Index(order, variants[i]), slices.Index(order, variants[j])
				if a < 0 {
					a = len(order)
				}
				if b < 0 {
					b = len(order)
				}
				if a == b {
					return variants[i] < variants[j]
				}
				return a < b
			})
			name := m.Name
			if name == "" {
				name = id
			}
			result.Models = append(result.Models, ModelOption{Provider: p.ID, ID: id, Name: name, Variants: variants, Image: m.Capabilities.Input.Image, PDF: m.Capabilities.Input.PDF})
		}
	}
	if len(result.Models) == 0 {
		return fallback
	}
	sort.Slice(result.Models, func(i, j int) bool {
		if result.Models[i].Name == result.Models[j].Name {
			return result.Models[i].ID < result.Models[j].ID
		}
		return result.Models[i].Name < result.Models[j].Name
	})
	return result
}

func (s *Service) validateExecution(ctx context.Context, selected storage.Execution, attachments []string, chatIDs ...string) error {
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
	options := s.Models(ctx, chatIDs...)
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
	var providers runtimeProviders
	if err := rt.call(ctx, "GET", "/provider", nil, &providers); err != nil {
		return err
	}
	unavailable := errors.New("selected model or reasoning effort is unavailable in this runtime")
	options := providerOptions(providers, ModelOptions{Default: selected, Error: unavailable.Error()})
	if options.Error != "" {
		return unavailable
	}
	for _, m := range options.Models {
		if m.ID == selected.Model && (selected.Variant == "" || slices.Contains(m.Variants, selected.Variant)) {
			return nil
		}
	}
	return unavailable
}
