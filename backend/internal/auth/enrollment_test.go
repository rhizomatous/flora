package auth

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestEnrollmentRaceRestartAndReplay(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	file := filepath.Join(root, "enrollment.sha256")
	const code = "local-test-only-random-installer-code"
	if err := os.WriteFile(file, []byte(TokenHash(code)), 0600); err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(ctx, filepath.Join(root, "data"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	services := []*Service{New(store), New(store)}
	for _, s := range services {
		if err := s.RequireEnrollment(file); err != nil {
			t.Fatal(err)
		}
		for _, codes := range [][]string{nil, {"wrong"}, {""}, {code, code}} {
			if _, _, err := s.Bootstrap(ctx, "long unique password", codes...); !errors.Is(err, ErrEnrollment) {
				t.Fatalf("unprotected bootstrap: %v", err)
			}
		}
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, s := range services {
		wg.Go(func() { _, _, err := s.Bootstrap(ctx, "long unique password", code); results <- err })
	}
	wg.Wait()
	close(results)
	wins := 0
	for err := range results {
		if err == nil {
			wins++
		} else if !errors.Is(err, storage.ErrConflict) {
			t.Fatal(err)
		}
	}
	if wins != 1 {
		t.Fatalf("bootstrap winners: %d", wins)
	}
	restarted := New(store)
	if err := restarted.RequireEnrollment(file); err != nil {
		t.Fatal(err)
	}
	if _, _, err := restarted.Bootstrap(ctx, "another long password", code); !errors.Is(err, storage.ErrConflict) {
		t.Fatalf("replay: %v", err)
	}
	if _, _, err := restarted.Login(ctx, "long unique password"); err != nil {
		t.Fatal(err)
	}
}

func TestEnrollmentFileRejectsUnsafeInputs(t *testing.T) {
	root := t.TempDir()
	for _, tc := range []struct {
		name, body string
		mode       os.FileMode
	}{
		{"public", TokenHash("test"), 0644},
		{"writable-group", TokenHash("test"), 0660},
		{"short", "abcdef", 0600},
		{"long", TokenHash("test") + "\n", 0600},
		{"invalid", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", 0600},
	} {
		t.Run(tc.name, func(t *testing.T) {
			file := filepath.Join(root, tc.name)
			if err := os.WriteFile(file, []byte(tc.body), tc.mode); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(file, tc.mode); err != nil {
				t.Fatal(err)
			}
			if err := New(nil).RequireEnrollment(file); err == nil {
				t.Fatal("accepted unsafe file")
			}
		})
	}
	valid := filepath.Join(root, "valid")
	if err := os.WriteFile(valid, []byte(TokenHash("test")), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(valid, link); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{link, root, filepath.Join(root, "absent")} {
		if err := New(nil).RequireEnrollment(path); err == nil {
			t.Fatalf("accepted %s", path)
		}
	}
}
