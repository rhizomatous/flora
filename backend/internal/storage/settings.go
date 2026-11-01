package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"os"
	"strings"
)

// RuntimeDefaults are copied into new chats, never rewritten on existing chats.
// Older chats without this record retain the original installation defaults.
type RuntimeDefaults struct {
	CPUs         float64 `json:"cpus"`
	MemoryBytes  int64   `json:"memoryBytes"`
	PidsLimit    int64   `json:"pidsLimit"`
	SetupSeconds int     `json:"setupSeconds"`
	AuthorName   string  `json:"authorName"`
	AuthorEmail  string  `json:"authorEmail"`
}

type Preferences struct {
	RuntimeDefaults
	MaxRunning      int  `json:"maxRunning"`
	ActivitySeconds int  `json:"activitySeconds"`
	InlineDiffBytes int  `json:"inlineDiffBytes"`
	MessageBytes    int  `json:"messageBytes"`
	SessionSeconds  int  `json:"sessionSeconds"`
	Sound           bool `json:"sound"`
}

const MaxAllowedMessageBytes = 4 << 20

func DefaultPreferences() Preferences {
	return Preferences{RuntimeDefaults: RuntimeDefaults{2, 8 << 30, 512, 600, "Flora", "flora@rhizomato.us"}, MaxRunning: 10, ActivitySeconds: 3600, InlineDiffBytes: 1 << 20, MessageBytes: 128 << 10, SessionSeconds: 604800, Sound: true}
}

func (p Preferences) Validate() error {
	for _, b := range []struct {
		name            string
		value, min, max int64
	}{
		{"Container cap", int64(p.MaxRunning), 1, 1000},
		{"Memory bytes", p.MemoryBytes, 64 << 20, 1 << 40},
		{"Process limit", p.PidsLimit, 16, 65536},
		{"Setup timeout seconds", int64(p.SetupSeconds), 1, 86400},
		{"Activity timeout seconds", int64(p.ActivitySeconds), 1, 604800},
		{"Inline diff bytes", int64(p.InlineDiffBytes), 1024, 16 << 20},
		{"Message bytes", int64(p.MessageBytes), 1024, MaxAllowedMessageBytes},
		{"Session lifetime seconds", int64(p.SessionSeconds), 300, 31536000},
	} {
		if b.value < b.min || b.value > b.max {
			return fmt.Errorf("%s must be between %d and %d.", b.name, b.min, b.max)
		}
	}
	if !(p.CPUs >= 0.1 && p.CPUs <= 256) {
		return errors.New("CPU limit must be between 0.1 and 256.")
	}
	if strings.TrimSpace(p.AuthorName) == "" || len(p.AuthorName) > 200 || strings.ContainsAny(p.AuthorName, "\r\n\x00<>") {
		return errors.New("Enter a Git author name of 1 to 200 bytes without line breaks or angle brackets.")
	}
	a, err := mail.ParseAddress(p.AuthorEmail)
	if err != nil || a.Address != p.AuthorEmail || len(p.AuthorEmail) > 254 || strings.ContainsAny(p.AuthorEmail, "\r\n\x00<>") {
		return errors.New("Enter a plain Git author email address.")
	}
	return nil
}

type settingsReader interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func readPreferences(ctx context.Context, db settingsReader) (Preferences, error) {
	p := DefaultPreferences()
	var raw string
	err := db.QueryRowContext(ctx, "SELECT settings FROM installation_settings WHERE id=1").Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return p, nil
	}
	if err != nil {
		return p, err
	}
	if err = json.Unmarshal([]byte(raw), &p); err != nil {
		return p, err
	}
	return p, p.Validate()
}

func (s *Store) Preferences(ctx context.Context) (Preferences, error) {
	return readPreferences(ctx, s.db)
}

func (s *Store) SavePreferences(ctx context.Context, p Preferences) error {
	if err := p.Validate(); err != nil {
		return err
	}
	unlock, err := s.LockContainerCapacity(ctx)
	if err != nil {
		return err
	}
	defer unlock()
	raw, err := json.Marshal(p)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO installation_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET settings=excluded.settings`, string(raw))
	return err
}

// CheckWritable probes application-owned storage without returning host paths.
func (s *Store) CheckWritable(ctx context.Context) error {
	for _, dir := range []string{s.root, s.root + "/workspaces", s.root + "/runtime-state", s.root + "/logs", s.root + "/artifacts"} {
		if err := probeWritable(dir); err != nil {
			return err
		}
	}
	_, err := s.db.ExecContext(ctx, "UPDATE installation_settings SET settings=settings WHERE id=1")
	return err
}

func probeWritable(dir string) error {
	f, err := os.CreateTemp(dir, ".write-check-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, err = f.Write([]byte("Flora storage check"))
	if err == nil {
		err = f.Sync()
	}
	return errors.Join(err, f.Close())
}

func (c Configuration) RuntimeDefaults() RuntimeDefaults {
	if c.Runtime != nil {
		return *c.Runtime
	}
	return DefaultPreferences().RuntimeDefaults
}
