package githubbroker

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"
)

func TestCheckoutLocksOnlyItsOwnChat(t *testing.T) {
	s, first, b := fixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	second, err := s.CreateChat(ctx, first.ProjectID, "independent", first.ImageDigest, first.HarnessVersion)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.BindRuntime(ctx, first.ID, "first", ""); err != nil {
		t.Fatal(err)
	}
	first, _ = s.Chat(ctx, first.ID)
	firstPaths, _ := s.Paths(ctx, first.ID)
	secondPaths, _ := s.Paths(ctx, second.ID)
	entered, release := make(chan struct{}), make(chan struct{})
	defer close(release)
	ready := false
	a, err := NewAccess(b, execFunc(func(ctx context.Context, id, user string, _ []string, in io.Reader, out, _ io.Writer) (int, error) {
		raw, _ := io.ReadAll(in)
		script := string(raw)
		if id == "first" && strings.Contains(script, "oauth_token:") {
			close(entered)
			select {
			case <-release:
			case <-ctx.Done():
				return 1, ctx.Err()
			}
		}
		if id == "first" && user == "0" {
			ready = true
		}
		if strings.Contains(script, "git cat-file") {
			if id == "first" && !strings.Contains(script, "clone --no-checkout") && !ready {
				t.Error("materialization overtook checkout")
			}
			_, _ = io.WriteString(out, strings.Repeat("b", 40))
		}
		return 0, nil
	}), CheckoutConfig{Host: "github.internal", CACert: "fixture-ca"})
	if err != nil {
		t.Fatal(err)
	}
	firstDone := make(chan error, 1)
	go func() { firstDone <- a.Checkout(ctx, first, firstPaths, "first") }()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("first checkout did not start")
	}
	materialized := make(chan error, 1)
	go func() { _, err := a.Materialize(ctx, first.ID, "octo/demo"); materialized <- err }()
	secondDone := make(chan error, 1)
	go func() { secondDone <- a.Checkout(ctx, second, secondPaths, "second") }()
	select {
	case err := <-secondDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("independent chat blocked behind checkout")
	}
	select {
	case err := <-materialized:
		t.Fatalf("same-chat helper did not wait: %v", err)
	default:
	}
	// Canceling a queued request must not wait for the active checkout's timeout.
	waitCtx, stop := context.WithTimeout(ctx, 10*time.Millisecond)
	defer stop()
	if _, err := a.Materialize(waitCtx, first.ID, "octo/demo"); err == nil {
		t.Fatal("queued cancellation ignored")
	}
	release <- struct{}{}
	if err := <-firstDone; err != nil {
		t.Fatal(err)
	}
	if err := <-materialized; err != nil {
		t.Fatal(err)
	}
}
