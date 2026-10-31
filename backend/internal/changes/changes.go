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
	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

const InlineLimit = 1 << 20
const captureLimit = 128 << 20

type Executor interface {
	Exec(context.Context, string, string, []string, io.Reader, io.Writer, io.Writer) (int, error)
}
type File struct {
	Repository    string `json:"repository,omitempty"`
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
	ID         string            `json:"id"`
	CapturedAt string            `json:"capturedAt"`
	Base       string            `json:"base"`
	Bases      map[string]string `json:"bases,omitempty"`
	Files      []File            `json:"files"`
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
		s.sweep(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) sweep(ctx context.Context) {
	chats, err := s.Store.Chats(ctx)
	if err != nil {
		return
	}
	for _, c := range chats {
		if ctx.Err() != nil {
			return
		}
		if c.ContainerID != "" && c.Status != storage.Stopped {
			_ = s.Refresh(ctx, c.ID)
		}
		s.verifyPulls(ctx, c, &http.Client{Timeout: 10 * time.Second})
	}
}

type inspector interface {
	ContainerInspect(context.Context, string) (docker.ContainerInfo, error)
}

func quote(v string) string { return "'" + strings.ReplaceAll(v, "'", "'\"'\"'") + "'" }

var hash = regexp.MustCompile(`^(?:[0-9a-f]{40}|[0-9a-f]{64})$`)
var errCapture = errors.New("Changes could not be refreshed. The last successful review is retained. Check Docker and the repository, then retry.")
var errStopped = errors.New("The container is stopped or removed. The last successful review is retained.")

type limitedBuffer struct {
	bytes.Buffer
	exceeded bool
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > captureLimit {
		b.exceeded = true
		return 0, errReviewLimit
	}
	return b.Buffer.Write(p)
}
func (s *Service) command(ctx context.Context, c storage.Chat, script string) ([]byte, error) {
	if s.Engine == nil {
		return nil, errCapture
	}
	var out limitedBuffer
	code, err := s.Engine.Exec(ctx, c.ContainerID, "flora", []string{"timeout", "60", "sh", "-s"}, strings.NewReader("set -eu\ncd /workspace\nexport GIT_OPTIONAL_LOCKS=0 GIT_LITERAL_PATHSPECS=1\n"+script), &out, io.Discard)
	if out.exceeded {
		return nil, errReviewLimit
	}
	if err != nil || code != 0 {
		return nil, errCapture
	}
	return out.Bytes(), nil
}

// Capture builds an immutable tree from current files using a private index.
// Copying the real index preserves tracked ignored files, including staged adds.
// Git stores symlink targets rather than reading the files they point to.
func (s *Service) capture(ctx context.Context, c storage.Chat) (*Snapshot, error) {
	combined := &Snapshot{CapturedAt: time.Now().UTC().Format(time.RFC3339Nano), Bases: map[string]string{}, Files: []File{}}
	for _, r := range c.Configuration.Repositories {
		base := c.StartingCommits[r.Name]
		if base == "" && r.Role == "extra" {
			continue
		}
		if !hash.MatchString(base) {
			return nil, errCapture
		}
		snap, err := s.captureRepository(ctx, c, r, base)
		if err != nil {
			return nil, err
		}
		combined.Bases[r.Name] = base
		combined.Files = append(combined.Files, snap.Files...)
	}
	if len(c.Configuration.Repositories) == 1 {
		combined.Base = c.StartingCommits[c.Configuration.Repositories[0].Name]
	}
	digest := sha256.New()
	budget := &budgetWriter{w: digest, remaining: snapshotLimit - 4096}
	if err := json.NewEncoder(budget).Encode(combined.Bases); err != nil {
		return nil, err
	}
	if err := encodeFiles(budget, combined.Files); err != nil {
		return nil, err
	}
	combined.ID = fmt.Sprintf("%x", digest.Sum(nil))
	return combined, nil
}

func (s *Service) captureRepository(ctx context.Context, c storage.Chat, r storage.Repository, base string) (*Snapshot, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	command := func(script string) ([]byte, error) {
		if storage.RepositoryPath(c.Configuration, r) == "/workspace" {
			return s.command(ctx, c, script)
		}
		return s.command(ctx, c, "cd "+quote(storage.RepositoryPath(c.Configuration, r))+"\n"+script)
	}
	// Git uses the index timestamp to detect same-size edits made immediately
	// after checkout. A newer copy could incorrectly treat those files as clean.
	out, err := command(`idx=$(mktemp /tmp/flora-review.XXXXXXXX)
trap 'rm -f "$idx" "$idx.lock"' EXIT
cp -p -- "$(git rev-parse --git-path index)" "$idx"
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
	raw, err := command(args + " --raw -z --\n")
	if err != nil {
		return nil, err
	}
	parts := bytes.Split(raw, []byte{0})
	// Both outputs use the same immutable trees and Git ordering. Patch headers
	// start at column zero; source lines always carry a context/add/delete prefix.
	// Capturing once also avoids directory pathspecs pulling in neighboring files.
	patches, err := command(args + " --patch --\n")
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
		f := File{Repository: r.Name, Path: string(parts[i]), Status: meta[4]}
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
	return &Snapshot{Files: files}, nil
}

// Save uses one fsynced rename for the list and every full diff. Artifacts are
// never mounted into the container. A failed write leaves the old file intact.
func save(root *os.Root, name string, v any) error {
	return saveWithBudget(root, name, v, snapshotLimit)
}

func saveWithBudget(root *os.Root, name string, v any, budget int) error {
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
	err = encodeJSON(&budgetWriter{w: f, remaining: budget}, v)
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
	if engine, ok := s.Engine.(inspector); ok {
		info, inspectErr := engine.ContainerInspect(ctx, c.ContainerID)
		switch {
		case docker.IsNotFound(inspectErr):
			err = errStopped
		case inspectErr != nil:
			err = errCapture
		case !info.State.Running:
			err = errStopped
		}
	}
	var snapshot *Snapshot
	if err == nil {
		snapshot, err = s.capture(ctx, c)
	}
	if err == nil {
		err = save(root, "changes.json", snapshot)
	}
	state := ""
	if err != nil {
		state = errCapture.Error()
		if errors.Is(err, errStopped) {
			state = errStopped.Error()
		}
		if errors.Is(err, errReviewLimit) {
			state = errReviewLimit.Error()
		}
	}
	var previous string
	if load(root, "changes-state.json", &previous) != nil || previous != state {
		if stateErr := save(root, "changes-state.json", state); stateErr != nil {
			return fmt.Errorf("save review state: %w", stateErr)
		}
	}
	return err
}
func (s *Service) Read(ctx context.Context, id string, inline bool) (Review, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, err := s.Store.Chat(ctx, id)
	if err != nil {
		return Review{}, err
	}
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
		r.Stale = c.Status == storage.Stopped || e != nil || time.Since(stamp) > 15*time.Second || r.Error != ""
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
