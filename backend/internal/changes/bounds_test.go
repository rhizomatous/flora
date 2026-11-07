package changes

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type captureExecutor func(context.Context, io.Reader, io.Writer) (int, error)

func (f captureExecutor) Exec(ctx context.Context, _, _ string, _ []string, in io.Reader, out, _ io.Writer) (int, error) {
	return f(ctx, in, out)
}

func TestCaptureSharesDeadlineAndFileLimitAcrossRepositories(t *testing.T) {
	s, old, _ := fixture(t)
	ctx := context.Background()
	project, err := s.Store.CreateProject(ctx, "collection", storage.Configuration{Repositories: []storage.Repository{
		{Name: "owner/first", URL: "https://github.com/owner/first.git", BaseBranch: "main", Role: "core"},
		{Name: "owner/second", URL: "https://github.com/owner/second.git", BaseBranch: "main", Role: "core"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.Store.CreateChat(ctx, project.ID, "bounded", old.ImageDigest, old.HarnessVersion)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range project.Configuration.Repositories {
		if err := s.Store.RecordStartingCommit(ctx, c.ID, r.Name, strings.Repeat("b", 40)); err != nil {
			t.Fatal(err)
		}
	}
	var deadline time.Time
	calls := 0
	large := false
	s.Engine = captureExecutor(func(ctx context.Context, in io.Reader, out io.Writer) (int, error) {
		calls++
		current, ok := ctx.Deadline()
		if !ok {
			t.Error("capture has no deadline")
		}
		if deadline.IsZero() {
			deadline = current
		}
		if !current.Equal(deadline) {
			t.Error("capture renewed deadline for another repository")
		}
		raw, _ := io.ReadAll(in)
		script := string(raw)
		if strings.Contains(script, "git write-tree") {
			_, _ = io.WriteString(out, strings.Repeat("a", 40)+"\n")
		}
		if large && strings.Contains(script, "--raw") {
			_, _ = io.WriteString(out, strings.Repeat(":100644 100644 aaaaaaa bbbbbbb M\x00file\x00", 6000))
		}
		if large && strings.Contains(script, "--patch") {
			_, _ = io.WriteString(out, strings.Repeat("diff --git a/file b/file\n+change\n", 6000))
		}
		time.Sleep(time.Millisecond)
		return 0, nil
	})
	if err := s.Refresh(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	if calls != 6 || time.Until(deadline) > 90*time.Second {
		t.Fatalf("unbounded capture: %d %s", calls, deadline)
	}
	saved, err := s.Read(ctx, c.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	id := saved.Snapshot.ID
	large, calls, deadline = true, 0, time.Time{}
	if err := s.Refresh(ctx, c.ID); !errors.Is(err, errReviewLimit) {
		t.Fatalf("aggregate file limit ignored: %v", err)
	}
	saved, err = s.Read(ctx, c.ID, false)
	if err != nil || saved.Snapshot.ID != id || !saved.Stale {
		t.Fatal("oversized capture replaced saved review")
	}
	calls = 0
	s.Engine = captureExecutor(func(ctx context.Context, _ io.Reader, _ io.Writer) (int, error) {
		calls++
		<-ctx.Done()
		return 1, ctx.Err()
	})
	short, cancel := context.WithTimeout(ctx, 10*time.Millisecond)
	defer cancel()
	if err := s.Refresh(short, c.ID); err == nil || calls != 1 {
		t.Fatalf("deadline did not stop collection: %d %v", calls, err)
	}
	saved, err = s.Read(ctx, c.ID, false)
	if err != nil || saved.Snapshot.ID != id || !saved.Stale {
		t.Fatal("expired capture replaced saved review")
	}
}
