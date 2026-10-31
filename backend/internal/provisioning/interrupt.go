package provisioning

import (
	"context"
	"errors"
	"io"
	"time"
)

// ConfirmInterrupt checks for processes left by tools after OpenCode has saved
// terminal parts. This deliberately rejects lingering language servers and
// background jobs too: without proof of teardown, only an explicit container
// stop can safely release the chat. No process or workspace file is changed.
func (m *Manager) ConfirmInterrupt(ctx context.Context, chatID string) error {
	e, ok := m.engine.(interface {
		Exec(context.Context, string, string, []string, io.Reader, io.Writer, io.Writer) (int, error)
	})
	if !ok {
		return errors.New("container process verification unavailable")
	}
	c, err := m.store.Chat(ctx, chatID)
	if err != nil {
		return err
	}
	// The check runs in the container's PID namespace. Exclude only its own
	// shell and the image's PID 1 sudo with its direct OpenCode child. Tool
	// descendants and orphaned background jobs are not part of that chain.
	const check = `self=$$; runtime=0; init=0; for entry in /proc/[0-9]*; do
pid=${entry##*/}
[ "$pid" = "$self" ] && continue
if ! IFS= read -r stat < "$entry/stat" 2>/dev/null; then
[ -d "$entry" ] && exit 1
continue
fi
rest=${stat##*) }; set -- $rest; state=$1; parent=$2
[ "$state" = Z ] && continue
comm=${stat#*(}; comm=${comm%)*}
if [ "$pid" = 1 ] && [ "$comm" = sudo ]; then init=1; continue; fi
if [ "$parent" = 1 ] && [ "$comm" = opencode ] && [ "$runtime" = 0 ]; then runtime=1; continue; fi
exit 1
done
[ "$runtime" = 1 ] && [ "$init" = 1 ]`
	for {
		exit, err := e.Exec(ctx, c.ContainerID, "0", []string{"/bin/sh", "-c", check}, nil, io.Discard, io.Discard)
		if err != nil {
			return errors.New("container process verification unavailable")
		}
		if exit == 0 {
			return nil
		}
		select {
		case <-ctx.Done():
			return errors.New("tool process teardown could not be confirmed; stop the container")
		case <-time.After(100 * time.Millisecond):
		}
	}
}
