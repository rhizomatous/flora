package changes

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/containerd/errdefs"
	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

type observedExecutor struct {
	*localExecutor
	running, removed   bool
	execs, inspections int
}

func (e *observedExecutor) Exec(ctx context.Context, id, user string, args []string, in io.Reader, out, stderr io.Writer) (int, error) {
	e.execs++
	return e.localExecutor.Exec(ctx, id, user, args, in, out, stderr)
}
func (e *observedExecutor) ContainerInspect(context.Context, string) (docker.ContainerInfo, error) {
	e.inspections++
	if e.removed {
		return docker.ContainerInfo{}, errdefs.ErrNotFound
	}
	return docker.ContainerInfo{State: docker.ContainerState{Running: e.running}}, nil
}

func TestWorkerStoppedRemovedAndResume(t *testing.T) {
	s, c, local := fixture(t)
	ctx := context.Background()
	e := &observedExecutor{localExecutor: local, running: true}
	s.Engine = e
	write(t, local.dir, "unstaged", "first snapshot\n")
	s.sweep(ctx)
	initial, err := s.Read(ctx, c.ID, false)
	if err != nil || initial.Snapshot == nil || initial.Stale {
		t.Fatalf("initial capture: %+v %v", initial, err)
	}
	paths, _ := s.Store.Paths(ctx, c.ID)
	statePath := filepath.Join(paths.Artifacts, "changes-state.json")
	info, err := os.Stat(statePath)
	if err != nil {
		t.Fatal(err)
	}
	execs, inspections := e.execs, e.inspections
	if err = s.Store.Transition(ctx, c.ID, "", storage.Stopped, "Stopped by user"); err != nil {
		t.Fatal(err)
	}
	s.sweep(ctx)
	s.sweep(ctx)
	if e.execs != execs || e.inspections != inspections {
		t.Fatal("known-stopped chat was polled through Docker")
	}
	stopped, err := s.Read(ctx, c.ID, false)
	if err != nil || !stopped.Stale || stopped.Snapshot.ID != initial.Snapshot.ID {
		t.Fatal("stopped review not retained as stale")
	}
	after, _ := os.Stat(statePath)
	if !os.SameFile(info, after) {
		t.Fatal("stopped worker rewrote review state")
	}

	if err = s.Store.Transition(ctx, c.ID, "", storage.Idle, "Resumed"); err != nil {
		t.Fatal(err)
	}
	local.fail = true
	s.sweep(ctx)
	failed, _ := s.Read(ctx, c.ID, false)
	if failed.Error == "" || !failed.Stale {
		t.Fatal("running refresh failure hidden")
	}
	info, _ = os.Stat(statePath)
	s.sweep(ctx)
	after, _ = os.Stat(statePath)
	if !os.SameFile(info, after) {
		t.Fatal("unchanged capture error was rewritten")
	}

	e.removed = true
	s.sweep(ctx)
	execs = e.execs
	info, _ = os.Stat(statePath)
	s.sweep(ctx)
	s.sweep(ctx)
	after, _ = os.Stat(statePath)
	if e.execs != execs || !os.SameFile(info, after) {
		t.Fatal("removed container caused repeated exec or state replacement")
	}
	removed, _ := New(s.Store, nil).Read(ctx, c.ID, false)
	if removed.Error != errStopped.Error() || !removed.Stale || removed.Snapshot.ID != initial.Snapshot.ID {
		t.Fatal("removed review lost its snapshot or error")
	}
	e.removed = false
	e.running = false
	s.sweep(ctx)
	if e.execs != execs {
		t.Fatal("inspected stopped container was executed")
	}

	e.running = true
	local.fail = false
	write(t, local.dir, "unstaged", "resumed snapshot\n")
	s.sweep(ctx)
	resumed, _ := s.Read(ctx, c.ID, false)
	if e.execs == execs || resumed.Stale || resumed.Error != "" || resumed.Snapshot.ID == initial.Snapshot.ID {
		t.Fatal("worker did not resume and clear the saved error")
	}
}
