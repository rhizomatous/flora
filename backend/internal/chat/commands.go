package chat

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type CommandOption struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Source      string `json:"source"`
}

// Commands reads the owning runtime when available. New and stopped chats use
// the installed runtime without creating a session or waking the chat.
func (s *Service) Commands(ctx context.Context, chatID string) ([]CommandOption, error) {
	if s.provisioner == nil {
		return nil, errors.New("chat runtime is not configured")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var raw json.RawMessage
	if chatID != "" {
		c, err := s.Store.Chat(ctx, chatID)
		if err != nil {
			return nil, err
		}
		if c.ContainerID != "" && c.Status != storage.Stopped {
			endpoint, err := s.provisioner.Endpoint(ctx, chatID)
			if err != nil {
				return nil, err
			}
			rt := newRuntime(endpoint)
			defer rt.client.CloseIdleConnections()
			if err := rt.call(ctx, "GET", "/command", nil, &raw); err != nil {
				return nil, err
			}
		} else {
			image, version := s.provisioner.Identity()
			if c.ImageDigest != image || c.HarnessVersion != version {
				return nil, errors.New("chat runtime differs from the installed runtime")
			}
		}
	}
	if raw == nil {
		credentials, err := s.Store.Credentials(ctx)
		if err != nil && !errors.Is(err, storage.ErrNotFound) {
			return nil, err
		}
		if credentials.ProviderKey == "" || credentials.Model == "" {
			return nil, &ControlError{Reason: "Configure a model provider in installation settings."}
		}
		raw, err = s.provisioner.CommandMetadata(ctx, credentials)
		if err != nil {
			return nil, err
		}
	}
	items := []CommandOption{}
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	return items, nil
}

// Unknown slash input stays ordinary text, as in OpenCode's composer.
func (s *Service) resolveCommand(ctx context.Context, chatID, text string) (*storage.Command, error) {
	if !strings.HasPrefix(text, "/") {
		return nil, nil
	}
	first, rest, multiline := strings.Cut(text, "\n")
	name, arguments, _ := strings.Cut(first[1:], " ")
	if name == "" || strings.HasPrefix(name, "/") {
		return nil, nil
	}
	items, err := s.Commands(ctx, chatID)
	if err != nil {
		return nil, &ControlError{Reason: "Could not load OpenCode commands. Try again."}
	}
	for _, item := range items {
		if item.Name != name {
			continue
		}
		if multiline {
			arguments += "\n" + rest
		}
		return &storage.Command{Name: name, Arguments: arguments}, nil
	}
	return nil, nil
}
