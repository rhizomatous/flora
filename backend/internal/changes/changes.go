// Package changes captures Git trees in the container and retains review data
// outside the workspace. Failed captures never replace a successful snapshot.
package changes

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/rhizomatous/flora/backend/internal/agentfiles"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

const InlineLimit = 1 << 20
const captureLimit = 128 << 20

type Executor interface {
	Exec(context.Context, string, string, []string, io.Reader, io.Writer, io.Writer) (int, error)
}
type File struct {
	Path          string `json:"path"`
	Previous      string `json:"previous,omitempty"`
	Status        string `json:"status"`
	Binary        bool   `json:"binary"`
	Undisplayable bool   `json:"undisplayable"`
	Diff          string `json:"diff"`
	Bytes         int    `json:"bytes"`
	Truncated     bool   `json:"truncated"`
}
type Snapshot struct {
	ID         string `json:"id"`
	CapturedAt string `json:"capturedAt"`
	Base       string `json:"base"`
	Files      []File `json:"files"`
}
type Review struct {
	Pulls    Pulls     `json:"pulls"`
	Snapshot *Snapshot `json:"snapshot"`
	Error    string    `json:"error"`
	Stale    bool      `json:"stale"`
}
type Service struct {
	Store  *storage.Store
	Engine Executor
	mu     sync.Mutex
}

func New(store *storage.Store, engine Executor) *Service {
	return &Service{Store: store, Engine: engine}
}

// Run refreshes without requiring an open browser. Cancellation waits for the
// current capture to finish before the caller closes Docker or storage.
func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		chats, err := s.Store.Chats(ctx)
		if err == nil {
			for _, c := range chats {
				if ctx.Err() != nil {
					return
				}
				if c.ContainerID != "" {
					_ = s.Refresh(ctx, c.ID)
				}
				s.verifyPulls(ctx, c, &http.Client{Timeout: 10 * time.Second})
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func quote(v string) string { return "'" + strings.ReplaceAll(v, "'", "'\"'\"'") + "'" }

var hash = regexp.MustCompile(`^(?:[0-9a-f]{40}|[0-9a-f]{64})$`)
var errCapture = errors.New("Changes could not be refreshed. The last successful review is retained. Check Docker and the repository, then retry.")

type limitedBuffer struct{ bytes.Buffer }

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > captureLimit {
		return 0, errCapture
	}
	return b.Buffer.Write(p)
}
func (s *Service) command(ctx context.Context, c storage.Chat, script string) ([]byte, error) {
	if s.Engine == nil {
		return nil, errCapture
	}
	var out limitedBuffer
	code, err := s.Engine.Exec(ctx, c.ContainerID, "flora", []string{"timeout", "60", "sh", "-s"}, strings.NewReader("set -eu\ncd /workspace\nexport GIT_OPTIONAL_LOCKS=0 GIT_LITERAL_PATHSPECS=1\n"+script), &out, io.Discard)
	if err != nil || code != 0 {
		return nil, errCapture
	}
	return out.Bytes(), nil
}

// Capture builds an immutable tree from current files using a private index.
// Copying the real index preserves tracked ignored files, including staged adds.
// Git stores symlink targets rather than reading the files they point to.
func (s *Service) capture(ctx context.Context, c storage.Chat) (*Snapshot, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	var base string
	for _, r := range c.Configuration.Repositories {
		if r.Role == "core" {
			if base != "" {
				return nil, errCapture
			}
			base = c.StartingCommits[r.Name]
		}
	}
	if !hash.MatchString(base) {
		return nil, errCapture
	}
	out, err := s.command(ctx, c, `idx=$(mktemp /tmp/flora-review.XXXXXXXX)
trap 'rm -f "$idx" "$idx.lock"' EXIT
cp -- "$(git rev-parse --git-path index)" "$idx"
export GIT_INDEX_FILE="$idx"
git ls-files -z | git update-index --no-assume-unchanged -z --stdin
git ls-files -z | git update-index --no-skip-worktree -z --stdin
git -c core.fsmonitor=false add -A -- .
git write-tree
`)
	if err != nil {
		return nil, err
	}
	tree := strings.TrimSpace(string(out))
	if !hash.MatchString(tree) {
		return nil, errCapture
	}
	args := "GIT_ATTR_SOURCE=" + quote(tree) + " git -c core.quotePath=true diff --no-ext-diff --no-textconv --no-color --no-relative --line-prefix= --find-renames " + quote(base) + " " + quote(tree)
	raw, err := s.command(ctx, c, args+" --raw -z --\n")
	if err != nil {
		return nil, err
	}
	parts := bytes.Split(raw, []byte{0})
	// Both outputs use the same immutable trees and Git ordering. Patch headers
	// start at column zero; source lines always carry a context/add/delete prefix.
	// Capturing once also avoids directory pathspecs pulling in neighboring files.
	patches, err := s.command(ctx, c, args+" --patch --\n")
	if err != nil {
		return nil, err
	}
	var blocks [][]byte
	if len(patches) > 0 {
		if !bytes.HasPrefix(patches, []byte("diff --git ")) {
			return nil, errCapture
		}
		blocks = bytes.Split(patches, []byte("\ndiff --git "))
		for i := range blocks {
			if i > 0 {
				blocks[i] = append([]byte("diff --git "), blocks[i]...)
			}
			if i < len(blocks)-1 {
				blocks[i] = append(blocks[i], '\n')
			}
		}
	}
	files := []File{}
	patchIndex := 0
	for i := 0; i < len(parts)-1; {
		meta := strings.Fields(string(parts[i]))
		i++
		if len(meta) != 5 || i >= len(parts)-1 {
			return nil, errCapture
		}
		f := File{Path: string(parts[i]), Status: meta[4]}
		i++
		if strings.HasPrefix(f.Status, "R") || strings.HasPrefix(f.Status, "C") {
			f.Previous = f.Path
			if i >= len(parts)-1 {
				return nil, errCapture
			}
			f.Path = string(parts[i])
			i++
		}
		if patchIndex >= len(blocks) || len(files) >= 10000 {
			return nil, errCapture
		}
		patch := blocks[patchIndex]
		patchIndex++
		// Git renders a file-type change as a deletion and an addition, with
		// two patch headers for the single raw changed-file entry.
		if f.Status == "T" {
			if patchIndex >= len(blocks) {
				return nil, errCapture
			}
			patch = bytes.Join([][]byte{patch, blocks[patchIndex]}, nil)
			patchIndex++
		}
		f.Diff = string(patch)
		f.Bytes = len(patch)
		f.Binary = bytes.Contains(patch, []byte("\nBinary files ")) || bytes.Contains(patch, []byte("\nGIT binary patch\n"))
		f.Undisplayable = !utf8.Valid(patch) || strings.HasPrefix(meta[0], ":160000") || meta[1] == "160000"
		files = append(files, f)
	}
	if patchIndex != len(blocks) {
		return nil, errCapture
	}
	encoded, err := json.Marshal(files)
	if err != nil {
		return nil, err
	}
	identity := fmt.Sprintf("%x", sha256.Sum256(encoded))
	return &Snapshot{ID: identity, CapturedAt: time.Now().UTC().Format(time.RFC3339Nano), Base: base, Files: files}, nil
}

// Save uses one fsynced rename for the list and every full diff. Artifacts are
// never mounted into the container. A failed write leaves the old file intact.
func save(root *os.Root, name string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if len(b) > 2*captureLimit {
		return errCapture
	}
	f, err := root.OpenFile(name+".tmp", os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if errors.Is(err, os.ErrExist) {
		if err = root.Remove(name + ".tmp"); err != nil {
			return err
		}
		f, err = root.OpenFile(name+".tmp", os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	}
	if err != nil {
		return err
	}
	defer root.Remove(name + ".tmp")
	_, err = f.Write(b)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = root.Rename(name+".tmp", name); err != nil {
		return err
	}
	d, err := root.Open(".")
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
func load(root *os.Root, name string, v any) error {
	f, err := agentfiles.Open(root, name)
	if err != nil {
		return err
	}
	defer f.Close()
	return json.NewDecoder(io.LimitReader(f, 2*captureLimit)).Decode(v)
}
func (s *Service) Refresh(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, err := s.Store.Chat(ctx, id)
	if err != nil {
		return err
	}
	p, err := s.Store.Paths(ctx, id)
	if err != nil {
		return err
	}
	root, err := os.OpenRoot(p.Artifacts)
	if err != nil {
		return err
	}
	defer root.Close()
	snapshot, err := s.capture(ctx, c)
	if err == nil {
		err = save(root, "changes.json", snapshot)
	}
	state := ""
	if err != nil {
		state = errCapture.Error()
	}
	if stateErr := save(root, "changes-state.json", state); stateErr != nil {
		return fmt.Errorf("save review state: %w", stateErr)
	}
	return err
}
func (s *Service) Read(ctx context.Context, id string, inline bool) (Review, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.Store.Paths(ctx, id)
	if err != nil {
		return Review{}, err
	}
	root, err := os.OpenRoot(p.Artifacts)
	if err != nil {
		return Review{}, err
	}
	defer root.Close()
	r := Review{Stale: true}
	var snap Snapshot
	if err := load(root, "pulls.json", &r.Pulls); err != nil && !errors.Is(err, os.ErrNotExist) {
		r.Pulls.Error = "Saved pull requests unavailable."
	}
	err = load(root, "changes.json", &snap)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return r, err
	}
	if err == nil {
		r.Snapshot = &snap
	}
	if err = load(root, "changes-state.json", &r.Error); err != nil && !errors.Is(err, os.ErrNotExist) {
		return r, err
	}
	if r.Snapshot != nil {
		stamp, e := time.Parse(time.RFC3339Nano, snap.CapturedAt)
		r.Stale = e != nil || time.Since(stamp) > 15*time.Second || r.Error != ""
	}
	if inline && r.Snapshot != nil {
		for i := range r.Snapshot.Files {
			f := &r.Snapshot.Files[i]
			if f.Bytes > InlineLimit {
				f.Diff = ""
				f.Truncated = true
			}
			if f.Binary || f.Undisplayable {
				f.Diff = ""
			}
		}
	}
	return r, nil
}
