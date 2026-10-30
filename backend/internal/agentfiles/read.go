// Package agentfiles reads diagnostic files from agent-owned directories without
// letting symlinks escape the mount or special files block the application.
package agentfiles

import (
	"errors"
	"io"
	"os"
	"syscall"
)

// Read requires a regular file beneath root. A positive limit rejects larger
// files; zero retains the complete file. The opened descriptor is checked after
// opening, so replacing the directory entry cannot bypass the type check.
func Read(root *os.Root, name string, limit int64) ([]byte, error) {
	f, err := root.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("agent diagnostic path is not a regular file")
	}
	var reader io.Reader = f
	if limit > 0 {
		reader = io.LimitReader(f, limit+1)
	}
	b, err := io.ReadAll(reader)
	if limit > 0 && int64(len(b)) > limit {
		return nil, errors.New("agent diagnostic file exceeds limit")
	}
	return b, err
}
