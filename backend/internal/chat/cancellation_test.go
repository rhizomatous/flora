package chat

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestCancellationJoinsSimultaneousStreamExit(t *testing.T) {
	for i := range 32 {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			f := newFixture(t)
			s, _, project := testService(t, f)
			c, err := s.Create(context.Background(), project.ID, "Cancel running capture", "initial", "held work")
			if err != nil {
				t.Fatal(err)
			}
			select {
			case <-f.started:
			case <-time.After(5 * time.Second):
				t.Fatal("prompt did not start")
			}
			// Cancellation ends both the HTTP prompt and its event stream. The
			// worker must join regardless of which ready select case it observes.
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if err := s.quiesce(ctx, c.ID); err != nil {
				t.Fatalf("capture shutdown did not finish: %v", err)
			}
		})
	}
}
