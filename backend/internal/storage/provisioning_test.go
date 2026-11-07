package storage

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestContainerLockProcessExit(t *testing.T) {
	if root := os.Getenv("FLORA_TEST_LOCK_ROOT"); root != "" {
		s, err := Open(context.Background(), root)
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		release, err := s.LockContainerCapacity(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		defer release()
		fmt.Println("locked")
		_, _ = bufio.NewReader(os.Stdin).ReadByte()
		return
	}
	root := t.TempDir()
	s := openTest(t, root)
	cmd := exec.Command(os.Args[0], "-test.run=^TestContainerLockProcessExit$")
	cmd.Env = append(os.Environ(), "FLORA_TEST_LOCK_ROOT="+root)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer stdin.Close()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	ready := make(chan string, 1)
	go func() { line, _ := bufio.NewReader(stdout).ReadString('\n'); ready <- line }()
	select {
	case line := <-ready:
		if line != "locked\n" {
			t.Fatalf("child did not lock: %q", line)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("child lock timed out")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if release, err := s.LockContainerCapacity(ctx); err == nil {
		release()
		t.Fatal("separate process bypassed reservation")
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	ctx, cancel = context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	release, err := s.LockContainerCapacity(ctx)
	if err != nil {
		t.Fatal("process crash leaked reservation", err)
	}
	release()
}
