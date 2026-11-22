package provisioning

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

// ShellDirectories reads working directories only inside the freshly verified
// saved container. Process IDs come from that runtime's PTY metadata, never
// browser input. A missing process leaves its last observed folder unchanged.
func (m *Manager) ShellDirectories(ctx context.Context, chatID, containerID string, pids []int) (map[int]string, error) {
	if len(pids) > 8 {
		return nil, errors.New("too many shell processes")
	}
	endpoint, err := m.Endpoint(ctx, chatID)
	if err != nil {
		return nil, err
	}
	if endpoint.ContainerID != containerID {
		return nil, errors.New("shell container changed")
	}
	engine, ok := m.engine.(interface {
		Exec(context.Context, string, string, []string, io.Reader, io.Writer, io.Writer) (int, error)
	})
	if !ok {
		return nil, errors.New("shell directory inspection unavailable")
	}
	directories := make(map[int]string)
	for _, pid := range pids {
		if pid <= 0 {
			continue
		}
		var out shellDirectoryOutput
		exit, err := engine.Exec(ctx, containerID, "flora", []string{"readlink", "-n", "--", fmt.Sprintf("/proc/%d/cwd", pid)}, nil, &out, io.Discard)
		directory := out.String()
		if err == nil && exit == 0 && strings.HasPrefix(directory, "/") && utf8.ValidString(directory) {
			directories[pid] = directory
		}
	}
	return directories, nil
}

type shellDirectoryOutput struct{ buffer bytes.Buffer }

func (b *shellDirectoryOutput) String() string { return b.buffer.String() }

func (b *shellDirectoryOutput) Write(p []byte) (int, error) {
	if b.buffer.Len()+len(p) > 4096 {
		return 0, io.ErrShortBuffer
	}
	return b.buffer.Write(p)
}
