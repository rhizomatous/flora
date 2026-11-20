package chat

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

type runtimeShell struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

func shellPath(id string) string { return "/pty/" + url.PathEscape(id) + "?directory=%2Fworkspace" }

// Shells reconciles saved terminals without waking or replacing a container.
// A stopped/restarted runtime permanently ends its old tabs. Unknown Docker
// state leaves records unchanged so an outage cannot be mistaken for an exit.
func (s *Service) Shells(ctx context.Context, id string) ([]storage.Shell, error) {
	if _, err := s.Store.Chat(ctx, id); err != nil {
		return nil, err
	}
	shells, err := s.Store.Shells(ctx, id)
	if err != nil {
		return nil, err
	}
	if s.provisioner == nil {
		return shells, nil
	}
	endpoint, err := s.provisioner.Endpoint(ctx, id)
	var ended *provisioning.ExecutionEndedError
	if err != nil && !errors.As(err, &ended) {
		return nil, &ControlError{Reason: "Cannot verify shell state. Refresh when the machine is available."}
	}
	var live []runtimeShell
	if err == nil {
		rt := newRuntime(endpoint)
		defer rt.client.CloseIdleConnections()
		if err := shellCall(rt, ctx, "GET", "/pty?directory=%2Fworkspace", nil, &live); err != nil {
			return nil, err
		}
	}
	for i := range shells {
		shell := &shells[i]
		if shell.State != "running" {
			continue
		}
		found := false
		if ended == nil && shell.ContainerID == endpoint.ContainerID {
			for _, p := range live {
				if p.ID == shell.RuntimeID && p.Status == "running" {
					found = true
				}
			}
		}
		if !found {
			if err := s.Store.EndShell(ctx, shell.ID); err != nil {
				return nil, err
			}
			shell.State = "ended"
		}
	}
	return shells, nil
}

func (s *Service) CreateShell(ctx context.Context, id string) (storage.Shell, error) {
	unlock := s.lockOperation(id)
	defer unlock()
	shells, err := s.Shells(ctx, id)
	if err != nil {
		return storage.Shell{}, err
	}
	if len(shells) >= 8 {
		return storage.Shell{}, &ControlError{Reason: "Close a shell before opening another. Each chat supports eight shell tabs."}
	}
	if s.provisioner == nil {
		return storage.Shell{}, &ControlError{Reason: "Shells require a running chat machine."}
	}
	endpoint, err := s.provisioner.Endpoint(ctx, id)
	if err != nil {
		return storage.Shell{}, &ControlError{Reason: "Wake the saved machine before opening a shell. Missing containers must be restored."}
	}
	rt := newRuntime(endpoint)
	defer rt.client.CloseIdleConnections()
	number := 0
	for _, shell := range shells {
		var n int
		if _, err := fmt.Sscanf(shell.Title, "Shell %d", &n); err == nil && n > number {
			number = n
		}
	}
	title := fmt.Sprintf("Shell %d", number+1)
	var p runtimeShell
	if err := shellCall(rt, ctx, "POST", "/pty?directory=%2Fworkspace", map[string]any{"command": "/bin/bash", "cwd": "/workspace", "title": title}, &p); err != nil {
		return storage.Shell{}, err
	}
	shell := storage.Shell{ID: rand.Text(), ChatID: id, ContainerID: endpoint.ContainerID, RuntimeID: p.ID, Title: title, State: "running"}
	if err := s.Store.SaveShell(ctx, shell); err != nil {
		_ = shellCall(rt, ctx, "DELETE", shellPath(p.ID), nil, nil)
		return storage.Shell{}, err
	}
	return shell, nil
}

// ShellEndpoint authorizes the browser's opaque shell ID through its saved chat
// binding and freshly verified container. It never calls Start or Wake.
func (s *Service) ShellEndpoint(ctx context.Context, chatID, id string) (storage.Shell, provisioning.Endpoint, error) {
	shells, err := s.Shells(ctx, chatID)
	if err != nil {
		return storage.Shell{}, provisioning.Endpoint{}, err
	}
	for _, shell := range shells {
		if shell.ID == id {
			if shell.State != "running" {
				return shell, provisioning.Endpoint{}, &ControlError{Reason: "This shell ended. Open a new shell to continue."}
			}
			endpoint, err := s.provisioner.Endpoint(ctx, chatID)
			if err != nil || endpoint.ContainerID != shell.ContainerID {
				return shell, provisioning.Endpoint{}, &ControlError{Reason: "The shell's machine is unavailable. Refresh its state."}
			}
			return shell, endpoint, nil
		}
	}
	return storage.Shell{}, provisioning.Endpoint{}, storage.ErrNotFound
}
func (s *Service) ResizeShell(ctx context.Context, chatID, id string, rows, cols int) error {
	if rows < 2 || rows > 500 || cols < 2 || cols > 500 {
		return &ControlError{Reason: "Terminal dimensions must be between 2 and 500."}
	}
	shell, ep, err := s.ShellEndpoint(ctx, chatID, id)
	if err != nil {
		return err
	}
	rt := newRuntime(ep)
	defer rt.client.CloseIdleConnections()
	return shellCall(rt, ctx, "PUT", shellPath(shell.RuntimeID), map[string]any{"size": map[string]int{"rows": rows, "cols": cols}}, nil)
}
func (s *Service) CloseShell(ctx context.Context, chatID, id string) error {
	unlock := s.lockOperation(chatID)
	defer unlock()
	shells, err := s.Shells(ctx, chatID)
	if err != nil {
		return err
	}
	for _, shell := range shells {
		if shell.ID != id {
			continue
		}
		if shell.State == "running" {
			ep, err := s.provisioner.Endpoint(ctx, chatID)
			if err != nil {
				return err
			}
			if ep.ContainerID != shell.ContainerID {
				return storage.ErrStale
			}
			rt := newRuntime(ep)
			defer rt.client.CloseIdleConnections()
			if err := shellCall(rt, ctx, "DELETE", shellPath(shell.RuntimeID), nil, nil); err != nil {
				return err
			}
		}
		return s.Store.DeleteShell(ctx, chatID, id)
	}
	return storage.ErrNotFound
}

// Shell operations share the machine's existing idle lease. Terminal input and
// output do not renew it; explicit stop and lease expiry terminate the PTYs.
const ShellRequestTimeout = 10 * time.Second

// shellCall bounds responses from the container, including list metadata and
// unexpected error bodies. Shell input, output and paths use separate routes.
func shellCall(rt *runtime, ctx context.Context, method, path string, in, out any) error {
	res, err := rt.request(ctx, method, path, in)
	if err != nil {
		return errors.New("Shell runtime connection unavailable. Refresh before retrying.")
	}
	defer res.Body.Close()
	if res.StatusCode < http.StatusOK || res.StatusCode >= http.StatusMultipleChoices {
		return &responseError{res.StatusCode}
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 65537))
	if err != nil || len(raw) > 65536 {
		return errors.New("Shell runtime response exceeded its limit")
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(raw, out)
}
