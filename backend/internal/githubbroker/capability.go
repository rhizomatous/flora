// Package githubbroker implements the Flora spike for brokered GitHub access
// (issue #3). A host-side broker holds the administrator's fine-grained
// GitHub token and exposes a narrow transport that agent containers use for
// ordinary git clone/fetch/push and gh API calls against authorized
// repositories. Containers receive per-chat, revocable capability tokens
// instead of the administrator token.
package githubbroker

import (
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

// Capability is a scoped, revocable container-side credential. It is minted
// host-side and delivered to a single chat's container. It never grants
// anything by itself; the broker exchanges it for the administrator token on
// the upstream hop.
type Capability struct {
	// ID is the opaque bearer string the container presents.
	ID string `json:"id"`
	// ChatID binds the capability to one chat's execution boundary.
	ChatID string `json:"chat_id"`
	// Repos lists authorized repositories as "owner/name" (lowercase).
	Repos []string `json:"repos"`
	// Write allows git push and mutating API calls. Read-only capabilities
	// permit clone/fetch and GET/HEAD API requests.
	Write bool `json:"write"`
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

// NormalizeRepo canonicalizes an "owner/name" repository for comparison.
func NormalizeRepo(repo string) (string, error) { return normalizeRepo(repo) }

// AllowsRepo reports whether the capability authorizes owner/name.
func (c Capability) AllowsRepo(repo string) bool {
	repo, err := normalizeRepo(repo)
	if err != nil {
		return false
	}
	for _, r := range c.Repos {
		if r == repo {
			return true
		}
	}
	return false
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
		if err := json.Unmarshal(data, &f); err != nil {
			return fmt.Errorf("parse capability store: %w", err)
		}
	}
	caps := map[string]Capability{}
	for _, c := range f.Caps() {
		caps[c.ID] = c
	}
	s.caps = caps
	if info, err := os.Stat(s.path); err == nil {
		s.modKey = info.ModTime().String()
	}
	return nil
}

func (f storeFile) Caps() []Capability { return f.Capabilities }

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
func (s *Store) Mint(chatID string, repos []string, write bool, ttl time.Duration) (Capability, error) {
	if chatID == "" {
		return Capability{}, errors.New("chat ID is required")
	}
	if len(repos) == 0 {
		return Capability{}, errors.New("at least one repository is required")
	}
	norm := make([]string, 0, len(repos))
	for _, r := range repos {
		n, err := normalizeRepo(r)
		if err != nil {
			return Capability{}, err
		}
		norm = append(norm, n)
	}
	id, err := NewCapabilityID()
	if err != nil {
		return Capability{}, err
	}
	cap := Capability{
		ID:        id,
		ChatID:    chatID,
		Repos:     norm,
		Write:     write,
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
