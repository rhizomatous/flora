package provisioning

import (
	"context"
	"io"
	"reflect"
	"strings"
	"testing"
)

type directoryEngine struct {
	Engine
	container string
	calls     int
	output    string
}

func (e *directoryEngine) Exec(_ context.Context, container, user string, args []string, _ io.Reader, stdout, stderr io.Writer) (int, error) {
	e.calls++
	if container != e.container || user != "flora" || !reflect.DeepEqual(args, []string{"readlink", "-n", "--", "/proc/42/cwd"}) {
		return 1, io.ErrUnexpectedEOF
	}
	_, err := io.WriteString(stdout, e.output)
	return 0, err
}
func TestShellDirectoriesVerifyContainerAndBoundOutput(t *testing.T) {
	ctx := context.Background()
	base := newFakeEngine()
	manager, store := newTestManager(t, base, Config{}, nil)
	c := newChat(t, store)
	endpoint, err := manager.Start(ctx, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	engine := &directoryEngine{Engine: base, container: endpoint.ContainerID, output: "/workspace/folder with spaces"}
	manager.engine = engine
	directories, err := manager.ShellDirectories(ctx, c.ID, endpoint.ContainerID, []int{42})
	if err != nil || directories[42] != engine.output {
		t.Fatalf("%v %v", directories, err)
	}
	before := engine.calls
	if _, err := manager.ShellDirectories(ctx, c.ID, "other-container", []int{42}); err == nil || engine.calls != before {
		t.Fatal("inspected a different container")
	}
	engine.output = "/" + strings.Repeat("x", 4096)
	directories, err = manager.ShellDirectories(ctx, c.ID, endpoint.ContainerID, []int{42})
	if err != nil || len(directories) != 0 {
		t.Fatal("accepted oversized directory output")
	}
	directories, err = manager.ShellDirectories(ctx, c.ID, endpoint.ContainerID, []int{-1, 0})
	if err != nil || len(directories) != 0 {
		t.Fatal("accepted invalid process IDs")
	}
}
