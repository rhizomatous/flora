package githubbroker

import (
	"context"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type execFunc func(context.Context, string, string, []string, io.Reader, io.Writer, io.Writer) (int, error)

func (f execFunc) Exec(ctx context.Context, id, user string, cmd []string, in io.Reader, out, diagnostics io.Writer) (int, error) {
	return f(ctx, id, user, cmd, in, out, diagnostics)
}

func TestCheckoutPersistenceBeforeReleaseAndRetry(t *testing.T) {
	s, chat, b := fixture(t)
	ctx := context.Background()
	paths, err := s.Paths(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	sha := strings.Repeat("b", 40)
	resolved := "invalid-sha"
	releases := 0
	clones := 0
	engine := execFunc(func(ctx context.Context, id, user string, cmd []string, in io.Reader, out, diagnostics io.Writer) (int, error) {
		raw, _ := io.ReadAll(in)
		script := string(raw)
		if user == "0" {
			saved, err := s.Chat(ctx, chat.ID)
			if err != nil || saved.StartingCommits["octo/demo"] != sha {
				t.Fatal("released setup before commit persistence")
			}
			releases++
			return 0, nil
		}
		if strings.Contains(script, "git clone") || strings.Contains(script, "clone --no-checkout") {
			clones++
			io.WriteString(out, resolved+"\n")
		} else if strings.Contains(script, "git cat-file") {
			if strings.Contains(script, "fetch") || strings.Contains(script, "checkout -B") {
				t.Fatal("retry resets existing work")
			}
			io.WriteString(out, sha+"\n")
		}
		if strings.Contains(script, fixtureToken) {
			t.Fatal("administrator token entered exec script")
		}
		return 0, nil
	})
	a, err := NewAccess(b, engine, CheckoutConfig{Host: "github.internal", CACert: "fixture-ca"})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Checkout(ctx, chat, paths, "container"); err == nil {
		t.Fatal("invalid resolved SHA accepted")
	}
	if releases != 0 {
		t.Fatal("failed persistence released setup")
	}
	saved, err := s.Chat(ctx, chat.ID)
	if err != nil || len(saved.StartingCommits) != 0 {
		t.Fatal("failed persistence left a base")
	}
	resolved = sha
	if err := a.Checkout(ctx, chat, paths, "container"); err != nil {
		t.Fatal(err)
	}
	chat, err = s.Chat(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Checkout(ctx, chat, paths, "container"); err != nil {
		t.Fatal(err)
	}
	if clones != 2 || releases != 2 {
		t.Fatalf("unexpected retries: clones=%d releases=%d", clones, releases)
	}
}

func TestCanceledCheckoutDoesNotRelease(t *testing.T) {
	s, chat, b := fixture(t)
	paths, err := s.Paths(context.Background(), chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	var issued string
	a, err := NewAccess(b, execFunc(func(_ context.Context, _ string, user string, _ []string, input io.Reader, _ io.Writer, diagnostics io.Writer) (int, error) {
		if user == "0" {
			t.Fatal("released canceled checkout")
		}
		raw, _ := io.ReadAll(input)
		matches := regexp.MustCompile(`oauth_token: ([A-Z2-7]+)`).FindStringSubmatch(string(raw))
		if len(matches) != 2 {
			t.Fatal("credential was not delivered")
		}
		issued = matches[1]
		cancel()
		io.WriteString(diagnostics, "network interrupted\n")
		return -1, context.Canceled
	}), CheckoutConfig{Host: "github.internal", CACert: "fixture-ca"})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Checkout(ctx, chat, paths, "container"); err == nil {
		t.Fatal("cancellation succeeded")
	}
	chat, err = s.Chat(context.Background(), chat.ID)
	if err != nil || len(chat.StartingCommits) != 0 {
		t.Fatal("cancellation recorded base")
	}
	if _, err := s.GitHubCapability(context.Background(), issued, time.Now()); !errors.Is(err, storage.ErrNotFound) {
		t.Fatal("issued credential survived cancellation")
	}
}

func TestCheckoutRejectsUnsupportedCoreCountWithoutChangingSnapshotOrAccess(t *testing.T) {
	s, fixtureChat, b := fixture(t)
	ctx := context.Background()
	a, err := NewAccess(b, execFunc(func(context.Context, string, string, []string, io.Reader, io.Writer, io.Writer) (int, error) {
		t.Fatal("unsupported checkout executed a container command")
		return -1, nil
	}), CheckoutConfig{Host: "github.internal", CACert: "fixture-ca"})
	if err != nil {
		t.Fatal(err)
	}
	for _, count := range []int{0, 2} {
		t.Run(fmt.Sprintf("%d core repositories", count), func(t *testing.T) {
			repos := []storage.Repository{{Name: "octo/extra", URL: "https://github.com/octo/extra.git", BaseBranch: "main", Role: "extra"}}
			for i := 0; i < count; i++ {
				name := fmt.Sprintf("octo/core-%d", i)
				repos = append(repos, storage.Repository{Name: name, URL: "https://github.com/" + name + ".git", BaseBranch: "main", Role: "core"})
			}
			project, err := s.CreateProject(ctx, "collection", storage.Configuration{Repositories: repos})
			if err != nil {
				t.Fatal(err)
			}
			chat, err := s.CreateChat(ctx, project.ID, "collection", fixtureChat.ImageDigest, fixtureChat.HarnessVersion)
			if err != nil {
				t.Fatal(err)
			}
			paths, err := s.Paths(ctx, chat.ID)
			if err != nil {
				t.Fatal(err)
			}
			credential := fixtureCapability + fmt.Sprint(count)
			if err := s.ReplaceGitHubCapability(ctx, chat.ID, credential, time.Now().Add(time.Hour)); err != nil {
				t.Fatal(err)
			}
			if err := a.Checkout(ctx, chat, paths, "container"); err == nil || !strings.Contains(err.Error(), fmt.Sprintf("found %d", count)) || !strings.Contains(err.Error(), "create a new chat") {
				t.Fatalf("unsupported configuration diagnostic: %v", err)
			}
			saved, err := s.Chat(ctx, chat.ID)
			if err != nil || len(saved.Configuration.Repositories) != len(repos) || len(saved.StartingCommits) != 0 {
				t.Fatal("unsupported checkout changed the snapshot or starting commits")
			}
			if id, err := s.GitHubCapability(ctx, credential, time.Now()); err != nil || id != chat.ID {
				t.Fatal("unsupported checkout replaced existing access")
			}
		})
	}
}
