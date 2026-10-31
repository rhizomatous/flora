package changes

import (
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type localExecutor struct {
	dir  string
	fail bool
}

func (e *localExecutor) Exec(ctx context.Context, _, _ string, _ []string, in io.Reader, out, stderr io.Writer) (int, error) {
	if e.fail {
		return 1, nil
	}
	b, _ := io.ReadAll(in)
	cmd := exec.CommandContext(ctx, "sh", "-s")
	cmd.Dir = e.dir
	cmd.Stdin = strings.NewReader(strings.Replace(string(b), "cd /workspace", "cd "+quote(e.dir), 1))
	cmd.Stdout = out
	cmd.Stderr = stderr
	err := cmd.Run()
	if err != nil {
		return 1, err
	}
	return 0, nil
}
func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	c := exec.Command("git", args...)
	c.Dir = dir
	c.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com", "GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com")
	b, e := c.CombinedOutput()
	if e != nil {
		t.Fatalf("git %v: %s %v", args, b, e)
	}
	return strings.TrimSpace(string(b))
}
func write(t *testing.T, dir, name, text string) {
	t.Helper()
	if e := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); e != nil {
		t.Fatal(e)
	}
}
func fixture(t *testing.T) (*Service, storage.Chat, *localExecutor) {
	t.Helper()
	ctx := context.Background()
	st, e := storage.Open(ctx, t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { st.Close() })
	p, e := st.CreateProject(ctx, "test", storage.Configuration{Repositories: []storage.Repository{{Name: "core", URL: "https://github.com/example/core", Role: "core", BaseBranch: "main"}}})
	if e != nil {
		t.Fatal(e)
	}
	c, e := st.CreateChat(ctx, p.ID, "review", "flora@sha256:"+strings.Repeat("a", 64), "1.2.27")
	if e != nil {
		t.Fatal(e)
	}
	dir := t.TempDir()
	git(t, dir, "init")
	for _, name := range []string{"committed", "staged", "unstaged", "deleted", "renamed", "binary", "link"} {
		write(t, dir, name, "original "+name+"\n")
	}
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "base")
	base := git(t, dir, "rev-parse", "HEAD")
	if e = st.RecordStartingCommit(ctx, c.ID, "core", base); e != nil {
		t.Fatal(e)
	}
	st.BindRuntime(ctx, c.ID, "container", "")
	c, _ = st.Chat(ctx, c.ID)
	ex := &localExecutor{dir: dir}
	return New(st, ex), c, ex
}
func TestCaptureWorkingFilesAndRetention(t *testing.T) {
	s, c, e := fixture(t)
	ctx := context.Background()
	d := e.dir
	write(t, d, "committed", "committed change\n")
	git(t, d, "add", ".")
	git(t, d, "commit", "-m", "work")
	write(t, d, "staged", "staged change\n")
	git(t, d, "add", "staged")
	write(t, d, "unstaged", "unstaged change\n")
	os.Remove(filepath.Join(d, "deleted"))
	os.Rename(filepath.Join(d, "renamed"), filepath.Join(d, "new-name"))
	write(t, d, "binary", "\x00\x01\x02")
	os.Remove(filepath.Join(d, "link"))
	if err := os.Symlink("/etc/passwd", filepath.Join(d, "link")); err != nil {
		t.Fatal(err)
	}
	write(t, d, "--danger; ' quoted\npath", "untracked change\n")
	write(t, d, "large", strings.Repeat("large line\n", InlineLimit/5))
	index := git(t, d, "diff", "--cached")
	if err := s.Refresh(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	if after := git(t, d, "diff", "--cached"); after != index {
		t.Fatal("real index changed")
	}
	r, err := s.Read(ctx, c.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]File{}
	for _, f := range r.Snapshot.Files {
		files[f.Path] = f
	}
	for _, name := range []string{"committed", "staged", "unstaged", "deleted", "new-name", "binary", "link", "--danger; ' quoted\npath", "large"} {
		if _, ok := files[name]; !ok {
			t.Errorf("missing %q", name)
		}
	}
	if files["deleted"].Status != "D" || files["new-name"].Previous != "renamed" || !files["binary"].Binary {
		t.Fatalf("bad statuses: %+v", files)
	}
	if !strings.Contains(files["link"].Diff, "/etc/passwd") || strings.Contains(files["link"].Diff, "root:") {
		t.Fatal("symlink followed")
	}
	inline, err := s.Read(ctx, c.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range inline.Snapshot.Files {
		if f.Path == "large" && (!f.Truncated || f.Diff != "") {
			t.Fatal("large diff not bounded")
		}
	}
	stamp := r.Snapshot.CapturedAt
	e.fail = true
	if s.Refresh(ctx, c.ID) == nil {
		t.Fatal("failure hidden")
	}
	restarted := New(s.Store, nil)
	r, err = restarted.Read(ctx, c.ID, false)
	if err != nil || !r.Stale || r.Error == "" || r.Snapshot.CapturedAt != stamp {
		t.Fatalf("retention failed: %+v %v", r, err)
	}
	os.RemoveAll(d)
	r, err = restarted.Read(ctx, c.ID, false)
	if err != nil || r.Snapshot.Files[0].Diff == "" {
		t.Fatalf("review lost with workspace: %v", err)
	}
}
func TestArtifactSymlinkRejected(t *testing.T) {
	s, c, _ := fixture(t)
	ctx := context.Background()
	p, _ := s.Store.Paths(ctx, c.ID)
	target := filepath.Join(t.TempDir(), "outside")
	write(t, filepath.Dir(target), "outside", "private")
	if err := os.Symlink(target, filepath.Join(p.Artifacts, "changes.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Read(ctx, c.ID, true); err == nil {
		t.Fatal("artifact symlink followed")
	}
}
func TestInvalidStartingCommitRejected(t *testing.T) {
	s, c, _ := fixture(t)
	c.StartingCommits["core"] = "HEAD; touch /tmp/unsafe"
	if _, err := s.capture(context.Background(), c); err == nil {
		t.Fatal("accepted injected revision")
	}
}

func TestCaptureIgnoresIndexHintsAndKeepsIgnoredTrackedFiles(t *testing.T) {
	s, c, e := fixture(t)
	ctx := context.Background()
	d := e.dir
	git(t, d, "update-index", "--assume-unchanged", "unstaged")
	git(t, d, "update-index", "--skip-worktree", "staged")
	write(t, d, "unstaged", "assume unchanged hint is not content\n")
	write(t, d, "staged", "skip worktree hint is not content\n")
	write(t, d, ".gitignore", "ignored*\n")
	write(t, d, "ignored-tracked", "tracked despite ignore\n")
	git(t, d, "add", "-f", "ignored-tracked")
	write(t, d, "ignored-untracked", "do not include ignored untracked\n")
	if err := s.Refresh(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	r, err := s.Read(ctx, c.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, f := range r.Snapshot.Files {
		names[f.Path] = true
	}
	if !names["staged"] || !names["unstaged"] || !names["ignored-tracked"] || names["ignored-untracked"] {
		t.Fatalf("wrong workspace contents: %v", names)
	}
	if hints := git(t, d, "ls-files", "-v"); !strings.Contains(hints, "h unstaged") || !strings.Contains(hints, "S staged") {
		t.Fatal("real index hints changed")
	}
}

func TestPartialSaveFailureRetainsOldSnapshot(t *testing.T) {
	s, c, e := fixture(t)
	ctx := context.Background()
	write(t, e.dir, "unstaged", "first review\n")
	if err := s.Refresh(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	old, _ := s.Read(ctx, c.ID, false)
	p, _ := s.Store.Paths(ctx, c.ID)
	if err := os.Mkdir(filepath.Join(p.Artifacts, "changes.json.tmp"), 0700); err != nil {
		t.Fatal(err)
	}
	write(t, p.Artifacts, "changes.json.tmp/blocker", "prevent incomplete replacement")
	write(t, e.dir, "unstaged", "second review must not replace first\n")
	if err := s.Refresh(ctx, c.ID); err == nil {
		t.Fatal("save failure hidden")
	}
	r, err := s.Read(ctx, c.ID, false)
	if err != nil || r.Snapshot.CapturedAt != old.Snapshot.CapturedAt || !r.Stale || r.Error == "" {
		t.Fatalf("partial save lost snapshot: %+v %v", r, err)
	}
}

func TestRefreshReplacesOnlyChangedContentIdentity(t *testing.T) {
	s, c, e := fixture(t)
	ctx := context.Background()
	write(t, e.dir, "unstaged", "first\n")
	if err := s.Refresh(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	first, _ := s.Read(ctx, c.ID, false)
	if err := s.Refresh(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	same, _ := s.Read(ctx, c.ID, false)
	if first.Snapshot.ID != same.Snapshot.ID {
		t.Fatal("unchanged refresh invalidated download")
	}
	write(t, e.dir, "unstaged", "second\n")
	if err := s.Refresh(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	second, _ := New(s.Store, nil).Read(ctx, c.ID, false)
	if second.Snapshot.ID == first.Snapshot.ID || second.Error != "" || second.Stale {
		t.Fatal("new snapshot not current")
	}
	if strings.Contains(second.Snapshot.Files[0].Diff, "+first") {
		t.Fatal("old content retained in current snapshot")
	}
	p, _ := s.Store.Paths(ctx, c.ID)
	entries, err := os.ReadDir(p.Artifacts)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("unexpected snapshot history: %v", entries)
	}
}

func TestFileReplacedByDirectoryHasSeparatePatches(t *testing.T) {
	s, c, e := fixture(t)
	ctx := context.Background()
	if err := os.Remove(filepath.Join(e.dir, "deleted")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(e.dir, "deleted"), 0700); err != nil {
		t.Fatal(err)
	}
	write(t, e.dir, "deleted/child", "new child\n")
	write(t, e.dir, "line\ndiff --git fake", "not a patch boundary\n")
	if err := s.Refresh(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	r, err := s.Read(ctx, c.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Snapshot.Files) != 3 {
		t.Fatalf("bad changed-file list: %+v", r.Snapshot.Files)
	}
	for _, f := range r.Snapshot.Files {
		if !strings.HasPrefix(f.Diff, "diff --git ") || strings.Contains(f.Diff, "\ndiff --git ") {
			t.Fatalf("mixed file patches: %q", f.Diff)
		}
		if f.Path == "deleted" && strings.Contains(f.Diff, "+new child") {
			t.Fatal("directory pathspec included child diff in parent")
		}
	}
}
