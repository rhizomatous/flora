// Package githubbroker implements the Flora spike for brokered GitHub access
// (issue #3). A host-side broker holds the administrator's fine-grained
// GitHub token and exposes a narrow transport that agent containers use for
// ordinary git clone/fetch/push and gh API calls against authorized
// repositories. Containers receive per-chat, revocable capability tokens
// instead of the administrator token.
package githubbroker

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

// Capability is a revocable container-side credential. It is minted
// host-side and delivered to a single chat's container. It carries no
// repository or operation scope of its own: by explicit product decision
// (2026-10-26, recorded in ADR 0001 and on issue #3), the authorization
// boundary is the administrator fine-grained token's own permissions,
// which GitHub enforces upstream. The broker guarantees only that the
// administrator token never enters containers and that access is
// revocable per chat.
type Capability struct {
	// ID is the opaque bearer string the container presents.
	ID string `json:"id"`
	// ChatID binds the capability to one chat's execution boundary, for
	// audit logging and per-chat revocation.
	ChatID string `json:"chat_id"`
	// ExpiresAt gives the capability a bounded lifetime.
	ExpiresAt time.Time `json:"expires_at"`
	// Revoked marks the capability dead before expiry.
	Revoked bool `json:"revoked"`
}

// NewCapabilityID returns a random opaque capability string.
func NewCapabilityID() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate capability: %w", err)
	}
	return "flora_cap_" + hex.EncodeToString(buf), nil
}

func normalizeRepo(repo string) (string, error) {
	repo = strings.ToLower(strings.TrimSpace(repo))
	repo = strings.TrimSuffix(repo, ".git")
	parts := strings.Split(repo, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", fmt.Errorf("repository %q must have the form owner/name", repo)
	}
	return parts[0] + "/" + parts[1], nil
}

// ValidAt reports whether the capability is usable at t.
func (c Capability) ValidAt(t time.Time) bool {
	return !c.Revoked && t.Before(c.ExpiresAt)
}

// Store persists capabilities in a host-only JSON file. The file must never
// be mounted into or reachable from agent containers. Store reloads the file
// whenever its modification time changes so revocation takes effect without
// restarting the broker.
type Store struct {
	path string

	mu     sync.Mutex
	caps   map[string]Capability
	modKey string
}

type storeFile struct {
	Capabilities []Capability `json:"capabilities"`
}

// OpenStore loads or initializes the capability file at path.
func OpenStore(path string) (*Store, error) {
	s := &Store{path: path, caps: map[string]Capability{}}
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		if err := s.saveLocked(); err != nil {
			return nil, err
		}
		return s, nil
	}
	if err := s.reloadLocked(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) reloadLocked() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return fmt.Errorf("read capability store: %w", err)
	}
	var f storeFile
	if len(data) > 0 {
		decoder := json.NewDecoder(bytes.NewReader(data))
		// Reject obsolete repo/write scope settings rather than silently
		// broadening an old capability when this spike is upgraded.
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&f); err != nil {
			return fmt.Errorf("parse capability store: %w", err)
		}
	}
	caps := map[string]Capability{}
	for _, c := range f.Capabilities {
		caps[c.ID] = c
	}
	s.caps = caps
	if info, err := os.Stat(s.path); err == nil {
		s.modKey = info.ModTime().String()
	}
	return nil
}

func (s *Store) saveLocked() error {
	f := storeFile{}
	for _, c := range s.caps {
		f.Capabilities = append(f.Capabilities, c)
	}
	data, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("write capability store: %w", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return fmt.Errorf("replace capability store: %w", err)
	}
	if info, err := os.Stat(s.path); err == nil {
		s.modKey = info.ModTime().String()
	}
	return nil
}

// maybeReload picks up external edits (for example CLI revocation) when the
// file changed on disk.
func (s *Store) maybeReload() {
	info, err := os.Stat(s.path)
	if err != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if info.ModTime().String() != s.modKey {
		// A corrupt edit must not crash the broker; keep the last good set.
		_ = s.reloadLocked()
	}
}

// Lookup returns the capability for an ID, reloading the store if it changed.
func (s *Store) Lookup(id string) (Capability, bool) {
	s.maybeReload()
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.caps[id]
	return c, ok
}

// Mint creates and persists a new capability.
func (s *Store) Mint(chatID string, ttl time.Duration) (Capability, error) {
	if chatID == "" {
		return Capability{}, errors.New("chat ID is required")
	}
	id, err := NewCapabilityID()
	if err != nil {
		return Capability{}, err
	}
	cap := Capability{
		ID:        id,
		ChatID:    chatID,
		ExpiresAt: time.Now().Add(ttl).UTC(),
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.caps[id] = cap
	if err := s.saveLocked(); err != nil {
		return Capability{}, err
	}
	return cap, nil
}

// Revoke marks a capability dead. Revocation survives broker restarts because
// it is persisted in the store.
func (s *Store) Revoke(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.caps[id]
	if !ok {
		return fmt.Errorf("unknown capability %q", id)
	}
	c.Revoked = true
	s.caps[id] = c
	return s.saveLocked()
}
