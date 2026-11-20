package workspace

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestBoundedReadsAndChangedDownloads(t *testing.T) {
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	write := func(name string, b []byte) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), b, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("text", []byte(strings.Repeat("hello\n", PreviewLimit)))
	p, _, err := Read(root, "text", "", false)
	if err != nil || !p.Truncated || len(p.Text) != PreviewLimit || !p.Downloadable {
		t.Fatalf("preview: %+v %v", p, err)
	}
	_, b, err := Read(root, "text", p.Version, true)
	if err != nil || len(b) != 6*PreviewLimit {
		t.Fatalf("full download: %d %v", len(b), err)
	}
	write("text", []byte("changed"))
	if _, _, err := Read(root, "text", p.Version, true); err == nil {
		t.Fatal("download accepted old preview")
	}

	write("stamp", []byte("before"))
	before, err := os.Stat(filepath.Join(dir, "stamp"))
	if err != nil {
		t.Fatal(err)
	}
	stamp, _, err := Read(root, "stamp", "", false)
	if err != nil {
		t.Fatal(err)
	}
	write("stamp", []byte("after!"))
	if err := os.Chtimes(filepath.Join(dir, "stamp"), before.ModTime(), before.ModTime()); err != nil {
		t.Fatal(err)
	}
	if _, _, err := Read(root, "stamp", stamp.Version, true); err == nil {
		t.Fatal("same size and restored mtime bypassed version check")
	}
	write("binary", []byte{0, 1, 2})
	if p, _, err := Read(root, "binary", "", false); err != nil || p.Kind != "binary" || p.Text != "" {
		t.Fatal(p, err)
	}
	f, err := os.Create(filepath.Join(dir, "huge"))
	if err != nil {
		t.Fatal(err)
	}
	if err = f.Truncate(DownloadLimit + 1); err != nil {
		t.Fatal(err)
	}
	f.Close()
	p, _, err = Read(root, "huge", "", false)
	if err != nil || p.Downloadable {
		t.Fatal(p, err)
	}
	if _, _, err = Read(root, "huge", p.Version, true); err == nil {
		t.Fatal("unbounded download")
	}
	write("utf8", []byte(strings.Repeat("a", PreviewLimit-1)+"🌸"))
	if p, _, err := Read(root, "utf8", "", false); err != nil || p.Kind != "text" || !p.Truncated {
		t.Fatal(p, err)
	}
}

func TestContainmentAndSpecialFiles(t *testing.T) {
	dir := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "escape")); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(filepath.Join(dir, "pipe"), 0600); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for _, name := range []string{"../secret", "/etc/passwd", "escape/secret", "pipe", "missing"} {
		if _, _, err := Read(root, name, "", false); err == nil {
			t.Fatalf("read forbidden %q", name)
		}
	}
	for _, name := range []string{"escape", "pipe", "../"} {
		if _, err := List(context.Background(), root, name, 0); err == nil {
			t.Fatalf("listed %q", name)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "safe"), []byte("safe"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("safe", filepath.Join(dir, "inside")); err != nil {
		t.Fatal(err)
	}
	if p, _, err := Read(root, "inside", "", false); err != nil || p.Text != "safe" {
		t.Fatal(p, err)
	}
	l, err := List(context.Background(), root, ".", 0)
	if err != nil || len(l.Entries) != 4 {
		t.Fatal(l, err)
	}
}

func TestDirectoryPages(t *testing.T) {
	dir := t.TempDir()
	for i := 0; i < DirectoryLimit+3; i++ {
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("%04d", i)), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	first, err := List(context.Background(), root, ".", 0)
	if err != nil || len(first.Entries) != DirectoryLimit || first.NextOffset != DirectoryLimit {
		t.Fatal(first, err)
	}
	last, err := List(context.Background(), root, ".", first.NextOffset)
	if err != nil || len(last.Entries) != 3 || last.NextOffset != 0 || last.Truncated {
		t.Fatal(last, err)
	}
	seen := map[string]bool{}
	for _, e := range append(first.Entries, last.Entries...) {
		if seen[e.Name] {
			t.Fatal("duplicate entry")
		}
		seen[e.Name] = true
	}
}

func TestSymlinkReplacementCannotExposeOutsideBytes(t *testing.T) {
	dir, outside := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "safe"), []byte("safe"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	done := make(chan struct{})
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		for {
			select {
			case <-done:
				return
			default:
			}
			for _, target := range []string{"safe", filepath.Join(outside, "secret")} {
				_ = os.Symlink(target, filepath.Join(dir, "next"))
				_ = os.Rename(filepath.Join(dir, "next"), filepath.Join(dir, "switch"))
			}
		}
	}()
	defer func() { close(done); <-finished }()
	for i := 0; i < 1000; i++ {
		p, _, err := Read(root, "switch", "", false)
		if err == nil && p.Text != "safe" {
			t.Fatalf("escaped root: %q", p.Text)
		}
	}
}
