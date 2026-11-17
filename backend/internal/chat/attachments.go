package chat

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type AttachmentCapabilities struct {
	Image  bool   `json:"image"`
	PDF    bool   `json:"pdf"`
	Reason string `json:"reason"`
}

type capabilityCache struct {
	mu      sync.Mutex
	expires time.Time
	value   AttachmentCapabilities
}

// Model metadata comes from the same catalog OpenCode uses. Missing metadata
// fails closed for binary content; UTF-8 documents are delivered as text.
func (s *Service) AttachmentCapabilities(ctx context.Context) AttachmentCapabilities {
	s.attachmentCapabilities.mu.Lock()
	defer s.attachmentCapabilities.mu.Unlock()
	cache := &s.attachmentCapabilities
	if time.Now().Before(cache.expires) {
		return cache.value
	}
	unavailable := AttachmentCapabilities{Reason: "Image and PDF support could not be checked. Retry shortly, or use a text document."}
	credentials, err := s.Store.Credentials(ctx)
	if err != nil {
		return unavailable
	}
	lookupCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(lookupCtx, "GET", "https://models.dev/api.json", nil)
	if err != nil {
		return unavailable
	}
	client := s.ModelCatalogClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	response, err := client.Do(req)
	if err != nil {
		return unavailable
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return unavailable
	}
	var catalog map[string]struct {
		Models map[string]struct {
			Modalities struct {
				Input []string `json:"input"`
			} `json:"modalities"`
		} `json:"models"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 32<<20)).Decode(&catalog) != nil {
		return unavailable
	}
	model, ok := catalog[credentials.Provider].Models[credentials.Model]
	if !ok {
		return AttachmentCapabilities{Reason: "The configured model has no attachment capability metadata. Use a text document."}
	}
	value := AttachmentCapabilities{}
	for _, kind := range model.Modalities.Input {
		if kind == "image" {
			value.Image = true
		}
		if kind == "pdf" {
			value.PDF = true
		}
	}
	if !value.Image || !value.PDF {
		value.Reason = "The configured model does not support every attachment type. Unsupported files must be removed before sending."
	}
	cache.value, cache.expires = value, time.Now().Add(time.Hour)
	return value
}

func (s *Service) checkAttachments(ctx context.Context, project string, ids []string) error {
	if len(ids) > storage.MaxAttachments {
		return &storage.AttachmentError{Reason: "Use at most 5 attachments per message."}
	}
	var capabilities *AttachmentCapabilities
	total := 0
	for _, id := range ids {
		a, _, err := s.Store.Attachment(ctx, id)
		if err != nil {
			return &storage.AttachmentError{Reason: "An attachment expired or was removed. Upload it again."}
		}
		if a.ProjectID != project {
			return &storage.AttachmentError{Reason: "An attachment belongs to another project."}
		}
		total += a.Size
		if a.MIME == "text/plain" {
			continue
		}
		if capabilities == nil {
			c := s.AttachmentCapabilities(ctx)
			capabilities = &c
		}
		if strings.HasPrefix(a.MIME, "image/") && capabilities.Image || a.MIME == "application/pdf" && capabilities.PDF {
			continue
		}
		return &storage.AttachmentError{Reason: fmt.Sprintf("The configured model cannot accept %s. %s", a.Name, capabilities.Reason)}
	}
	if total > storage.MaxAttachmentTotal {
		return &storage.AttachmentError{Reason: "Attachments must total at most 20 MiB per message."}
	}
	return nil
}

// runtimeParts resolves private durable references to inline bytes only at the
// delivery boundary. The runtime never needs browser credentials or storage paths.
func (s *Service) runtimeParts(ctx context.Context, rt *runtime, message storage.Message, credentials storage.Credentials) ([]map[string]string, error) {
	var payload struct {
		Attachments []storage.Attachment `json:"attachments"`
	}
	if err := json.Unmarshal(message.Payload, &payload); err != nil {
		return nil, err
	}
	parts := []map[string]string{}
	if message.Text != "" {
		parts = append(parts, map[string]string{"type": "text", "text": message.Text})
	}
	if len(payload.Attachments) == 0 {
		return parts, nil
	}
	binary := false
	for _, a := range payload.Attachments {
		if a.MIME != "text/plain" {
			binary = true
		}
	}
	var input struct {
		Image bool `json:"image"`
		PDF   bool `json:"pdf"`
	}
	if binary {
		var providers struct {
			All []struct {
				ID     string `json:"id"`
				Models map[string]struct {
					Capabilities struct {
						Input struct {
							Image bool `json:"image"`
							PDF   bool `json:"pdf"`
						} `json:"input"`
					} `json:"capabilities"`
				} `json:"models"`
			} `json:"all"`
		}
		if err := rt.call(ctx, "GET", "/provider", nil, &providers); err != nil {
			return nil, err
		}
		for _, provider := range providers.All {
			if provider.ID == credentials.Provider {
				input = provider.Models[credentials.Model].Capabilities.Input
			}
		}
	}
	for _, saved := range payload.Attachments {
		a, data, err := s.Store.Attachment(ctx, saved.ID)
		if err != nil {
			return nil, err
		}
		if a.MIME == "text/plain" {
			parts = append(parts, map[string]string{"type": "text", "text": "Attached document: " + a.Name + "\n\n" + string(data)})
			continue
		}
		if strings.HasPrefix(a.MIME, "image/") && !input.Image || a.MIME == "application/pdf" && !input.PDF {
			return nil, fmt.Errorf("runtime model does not support %s", a.MIME)
		}
		parts = append(parts, map[string]string{"type": "file", "filename": a.Name, "mime": a.MIME, "url": "data:" + a.MIME + ";base64," + base64.StdEncoding.EncodeToString(data)})
	}
	return parts, nil
}
