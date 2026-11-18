// Package workspace reads the chat's persisted bind mount without starting a runtime.
package workspace

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"sort"
	"strings"
	"syscall"
	"unicode/utf8"

	"github.com/rhizomatous/flora/backend/internal/agentfiles"
)

const PreviewLimit = 256 << 10
const DownloadLimit = 64 << 20
const DirectoryLimit = 500

var ErrChanged = errors.New("File changed. Refresh the preview before downloading.")
var ErrChanging = errors.New("File changed while reading. Refresh and try again.")
var ErrTooLarge = errors.New("Files over 64 MiB cannot be downloaded here.")
var ErrGrowing = errors.New("File grew beyond the download limit. Refresh and try again.")

type Entry struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
}
type Listing struct {
	Entries    []Entry `json:"entries"`
	Truncated  bool    `json:"truncated"`
	NextOffset int     `json:"nextOffset"`
}
type Preview struct {
	Size         int64  `json:"size"`
	Version      string `json:"version"`
	Kind         string `json:"kind"`
	Text         string `json:"text"`
	Truncated    bool   `json:"truncated"`
	Downloadable bool   `json:"downloadable"`
}

// ValidPath rejects traversal before os.Root independently confines symlink resolution.
func ValidPath(name string) bool {
	return name == "." || (fs.ValidPath(name) && !strings.ContainsAny(name, "\\\x00"))
}

func List(ctx context.Context, root *os.Root, name string, offset int) (Listing, error) {
	result := Listing{Entries: []Entry{}}
	if !ValidPath(name) || offset < 0 {
		return result, fs.ErrInvalid
	}
	dir, err := root.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return result, err
	}
	defer dir.Close()
	info, err := dir.Stat()
	if err != nil {
		return result, err
	}
	if !info.IsDir() {
		return result, fs.ErrInvalid
	}
	// Pages use the directory's native order. Read and discard earlier pages in
	// bounded chunks; directory mutations can change that order between requests.
	for offset > 0 {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		batch, err := dir.ReadDir(min(offset, DirectoryLimit))
		offset -= len(batch)
		if err == io.EOF {
			return result, nil
		}
		if err != nil {
			return result, err
		}
		result.NextOffset += len(batch)
	}
	entries, err := dir.ReadDir(DirectoryLimit + 1)
	if err != nil && err != io.EOF {
		return result, err
	}
	result.Truncated = len(entries) > DirectoryLimit
	if result.Truncated {
		result.NextOffset += DirectoryLimit
	} else {
		result.NextOffset = 0
	}
	for _, e := range entries[:min(len(entries), DirectoryLimit)] {
		kind := "unsupported"
		switch {
		case e.IsDir():
			kind = "directory"
		case e.Type().IsRegular():
			kind = "file"
		case e.Type()&os.ModeSymlink != 0:
			kind = "symlink"
		}
		result.Entries = append(result.Entries, Entry{e.Name(), kind})
	}
	sort.Slice(result.Entries, func(i, j int) bool {
		a, b := result.Entries[i], result.Entries[j]
		if (a.Kind == "directory") != (b.Kind == "directory") {
			return a.Kind == "directory"
		}
		return a.Name < b.Name
	})
	return result, nil
}

func version(info os.FileInfo) string {
	stat, _ := info.Sys().(*syscall.Stat_t)
	return fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%s:%d:%d:%d:%d", info.Name(), info.Size(), info.ModTime().UnixNano(), stat.Dev, stat.Ino)+changeTime(stat))))
}

// Read validates the opened descriptor, bounds memory, and checks both the descriptor
// and directory entry after reading. expected binds a download to the inspected file.
// No content is retained on disk. The returned bytes are a completed read, not a stream
// that can grow indefinitely as the agent writes.
func Read(root *os.Root, name, expected string, download bool) (Preview, []byte, error) {
	var result Preview
	if !ValidPath(name) || name == "." {
		return result, nil, fs.ErrInvalid
	}
	f, err := agentfiles.Open(root, name)
	if err != nil {
		return result, nil, err
	}
	defer f.Close()
	before, err := f.Stat()
	if err != nil {
		return result, nil, err
	}
	result.Size, result.Version = before.Size(), version(before)
	result.Downloadable = result.Size <= DownloadLimit
	if expected != "" && expected != result.Version {
		return result, nil, ErrChanged
	}
	limit := int64(PreviewLimit)
	if download {
		if !result.Downloadable {
			return result, nil, ErrTooLarge
		}
		limit = DownloadLimit
	}
	b, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return result, nil, err
	}
	after, err := f.Stat()
	current, pathErr := root.Stat(name)
	if err != nil || pathErr != nil || !os.SameFile(before, current) || version(before) != version(after) || version(before) != version(current) {
		return result, nil, ErrChanging
	}
	if download {
		if int64(len(b)) > limit {
			return result, nil, ErrGrowing
		}
		return result, b, nil
	}
	result.Truncated = len(b) > PreviewLimit
	if result.Truncated {
		b = b[:PreviewLimit]
	}
	result.Kind = "text"
	// A partial UTF-8 rune at the preview boundary is not a binary file.
	if result.Truncated {
		for len(b) > 0 && !utf8.Valid(b) && len(b) > PreviewLimit-4 {
			b = b[:len(b)-1]
		}
	}
	if !utf8.Valid(b) || strings.ContainsRune(string(b), 0) {
		result.Kind = "binary"
		return result, nil, nil
	}
	for _, r := range string(b) {
		if r < 32 && r != '\n' && r != '\r' && r != '\t' {
			result.Kind = "binary"
			return result, nil, nil
		}
	}
	result.Text = string(b)
	return result, nil, nil
}
