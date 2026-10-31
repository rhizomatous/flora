package agentfiles

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestReadRejectsEscapesSpecialFilesAndOversize(t *testing.T) {
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err := os.WriteFile(filepath.Join(dir, "regular"), []byte("output"), 0600); err != nil {
		t.Fatal(err)
	}
	if got, err := Read(root, "regular", 0); err != nil || string(got) != "output" {
		t.Fatal("lost output")
	}
	if _, err := Read(root, "regular", 3); err == nil {
		t.Fatal("accepted oversized file")
	}
	if err := os.Symlink(filepath.Join(t.TempDir(), "outside"), filepath.Join(dir, "escape")); err != nil {
		t.Fatal(err)
	}
	if _, err := Read(root, "escape", 0); err == nil {
		t.Fatal("followed escaping symlink")
	}
	if err := syscall.Mkfifo(filepath.Join(dir, "fifo"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Read(root, "fifo", 0); err == nil {
		t.Fatal("read special file")
	}
}
