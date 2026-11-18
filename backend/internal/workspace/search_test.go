package workspace

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestSearchConfinedNamesNestedPathsAndLimits(t *testing.T) {
	dir, outside := t.TempDir(), t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "src", "deep"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "src", "deep", "File.ts"), []byte("contents are not searched"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.ts"), []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "outside")); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	result, err := Search(context.Background(), root, "FILE.TS")
	if err != nil || result.Truncated || len(result.Paths) != 1 || result.Paths[0] != "src/deep/File.ts" {
		t.Fatal(result, err)
	}
	result, err = Search(context.Background(), root, "secret")
	if err != nil || len(result.Paths) != 0 {
		t.Fatal(result, err)
	}
	result, err = Search(context.Background(), root, "contents")
	if err != nil || len(result.Paths) != 0 {
		t.Fatal(result, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result, err = Search(ctx, root, "file")
	if err != nil || !result.Truncated {
		t.Fatal(result, err)
	}
	for i := 0; i < SearchLimit+2; i++ {
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("match-%d", i)), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	result, err = Search(context.Background(), root, "match-")
	if err != nil || !result.Truncated || len(result.Paths) != SearchLimit {
		t.Fatal(result, err)
	}
}
