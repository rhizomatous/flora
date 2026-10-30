package chat

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/rhizomatous/flora/backend/internal/agentfiles"
	"github.com/rhizomatous/flora/backend/internal/redaction"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

const setupPreviewBytes = 32 << 10
const setupProgressBudget = 1 << 20

// setupCapture reads only a bounded tail for progress and caps the total saved
// progress payload. Finish retains one complete redacted log using bounded memory.
type setupCapture struct {
	store     *storage.Store
	chatID    string
	root      *os.Root
	paths     storage.Paths
	secrets   []string
	remaining int
	last      [32]byte
}

func (c *setupCapture) save(ctx context.Context, final bool) error {
	if !final && c.remaining <= 0 {
		return nil
	}
	values := append(append([]string{}, c.secrets...), redaction.Values(ctx, c.store, c.chatID)...)
	payload := map[string]any{"final": final, "preview": true, "full_log_available": false}
	exit, _ := agentfiles.Read(c.root, "setup/exit-status", 4096)
	file, err := agentfiles.Open(c.root, "setup/output.log")
	if err == nil {
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			return err
		}
		size := info.Size()
		lookahead := 0
		for _, value := range values {
			lookahead = max(lookahead, 2*len(value)+32)
		}
		start := max(int64(0), size-setupPreviewBytes-int64(lookahead))
		tail, err := io.ReadAll(io.NewSectionReader(file, start, size-start))
		if err != nil {
			return err
		}
		clean := redaction.Tail(string(tail), setupPreviewBytes, values...)
		payload["output"] = clean
		payload["log_bytes"] = size
		payload["omitted_bytes"] = max(int64(0), size-setupPreviewBytes)
		if final {
			available := c.retainLog(file, size, values) == nil
			payload["full_log_available"] = available
			if !available {
				payload["log_error"] = "Could not retain the full setup log. Check storage permissions and free space."
			}
		}
	} else if final && errors.Is(err, os.ErrNotExist) && strings.TrimSpace(string(exit)) == "0" {
		payload["output"] = ""
		payload["full_log_available"] = c.retainLog(bytes.NewReader(nil), 0, values) == nil
	} else if !final {
		return nil
	} else {
		payload["log_error"] = "No readable setup output log was recorded."
	}
	if final && payload["full_log_available"] == false && payload["log_error"] == nil {
		payload["log_error"] = "Could not retain the full setup log. Check storage permissions and free space."
	}
	payload["exit_status"] = redaction.Text(strings.TrimSpace(string(exit)), values...)
	payload["progress_limited"] = c.remaining <= 0
	b, _ := json.Marshal(payload)
	hash := sha256.Sum256(b)
	if hash == c.last {
		return nil
	}
	if !final && len(b) > c.remaining {
		c.remaining = 0
		b = json.RawMessage(`{"preview":true,"progress_limited":true,"reason":"Inline setup progress limit reached. The complete redacted log will be retained when setup finishes."}`)
	}
	if err := c.store.AppendActivity(ctx, c.chatID, rand.Text(), "setup.output", b); err != nil {
		return err
	}
	c.last = hash
	if !final {
		c.remaining -= len(b)
	}
	return nil
}

func (c *setupCapture) retainLog(file io.ReaderAt, size int64, values []string) error {
	out, err := os.CreateTemp(c.paths.Logs, "setup-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(out.Name())
	section := io.NewSectionReader(file, 0, size)
	_, copyErr := io.Copy(out, redaction.Reader(section, values...))
	consumed, _ := section.Seek(0, io.SeekCurrent)
	if copyErr == nil && consumed < size {
		copyErr = io.ErrUnexpectedEOF
	}
	if copyErr == nil {
		copyErr = out.Sync()
	}
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Rename(out.Name(), filepath.Join(c.paths.Logs, "setup.log")); err != nil {
		return err
	}
	dir, err := os.Open(c.paths.Logs)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func (s *Service) captureSetup(ctx context.Context, chatID, providerKey string) {
	paths, err := s.Store.Paths(ctx, chatID)
	if err != nil {
		return
	}
	root, err := os.OpenRoot(paths.RuntimeState)
	if err != nil {
		return
	}
	defer root.Close()
	capture := setupCapture{store: s.Store, chatID: chatID, root: root, paths: paths, secrets: []string{providerKey}, remaining: setupProgressBudget}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	defer func() {
		clean := context.WithoutCancel(ctx)
		if err := capture.save(clean, true); err != nil {
			_ = s.Store.AppendActivity(clean, chatID, rand.Text(), "setup.output", json.RawMessage(`{"final":true,"full_log_available":false,"log_error":"Setup log capture failed. Check storage permissions and free space."}`))
		}
	}()
	for {
		_ = capture.save(context.WithoutCancel(ctx), false)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
