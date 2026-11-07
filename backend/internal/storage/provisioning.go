package storage

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

// LockContainer serializes one chat's container start and stop across handles
// using the same local storage. The returned release must be called once.
func (s *Store) LockContainer(ctx context.Context, chatID string) (func(), error) {
	return s.lockProvisioning(ctx, fmt.Sprintf("chat-%x", sha256.Sum256([]byte(chatID))))
}

// LockContainerCapacity reserves the admission decision through Docker create
// and start, never through checkout, readiness, or agent execution. Callers must
// hold LockContainer first and release this lock before releasing that one.
// Settings writes take only this lock so a lowered cap cannot commit between
// admission and Docker start. They must never acquire a chat lock while holding it.
// Docker's running set is authoritative, so process exit releases the lock
// without leaving a persisted reservation to reclaim on restart.
func (s *Store) LockContainerCapacity(ctx context.Context) (func(), error) {
	return s.lockProvisioning(ctx, "capacity")
}

func (s *Store) lockProvisioning(ctx context.Context, name string) (func(), error) {
	dir := filepath.Join(s.root, "container-locks")
	if err := privateDir(dir); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	// Never unlink lock files: another handle may already have the inode open.
	for {
		if err := ctx.Err(); err != nil {
			f.Close()
			return nil, err
		}
		err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return func() { _ = f.Close() }, nil
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) && !errors.Is(err, syscall.EINTR) {
			f.Close()
			return nil, err
		}
		select {
		case <-ctx.Done():
			f.Close()
			return nil, ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}
}
