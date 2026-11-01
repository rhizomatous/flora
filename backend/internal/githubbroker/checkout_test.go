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

func TestCheckoutUsesSavedAuthorAfterSettingsChange(t *testing.T) {
	s, original, b := fixture(t)
	ctx := context.Background()
	prefs := storage.DefaultPreferences()
	prefs.AuthorName = "Author's Name"
	prefs.AuthorEmail = "saved@example.test"
	if err := s.SavePreferences(ctx, prefs); err != nil {
		t.Fatal(err)
	}
	chat, err := s.CreateChat(ctx, original.ProjectID, "Author", original.ImageDigest, "1.2.27")
	if err != nil {
		t.Fatal(err)
	}
	prefs.AuthorName = "Future Author"
	prefs.AuthorEmail = "future@example.test"
	if err := s.SavePreferences(ctx, prefs); err != nil {
		t.Fatal(err)
	}
	paths, err := s.Paths(ctx, chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	configured := false
	a, err := NewAccess(b, execFunc(func(_ context.Context, _ string, user string, _ []string, in io.Reader, out, diagnostics io.Writer) (int, error) {
		raw, _ := io.ReadAll(in)
		script := string(raw)
		if strings.Contains(script, "git config --global user.name") {
			configured = true
			if !strings.Contains(script, "git config --global user.name "+quote("Author's Name")) || !strings.Contains(script, "git config --global user.email 'saved@example.test'") || strings.Contains(script, "Future Author") {
				t.Fatal("checkout ignored saved author or failed to quote it")
			}
		}
		if strings.Contains(script, "clone --no-checkout") {
			io.WriteString(out, strings.Repeat("a", 40)+"\n")
		}
		return 0, nil
	}), CheckoutConfig{Host: "github.internal", CACert: "fixture-ca", UseChatAuthor: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Checkout(ctx, chat, paths, "container"); err != nil {
		t.Fatal(err)
	}
	if !configured {
		t.Fatal("no author configured")
	}
}

func TestCheckoutCoreCountsAndExtraMaterialization(t *testing.T) {
	s, fixtureChat, b := fixture(t)
	ctx := context.Background()
	var scripts []string
	a, err := NewAccess(b, execFunc(func(_ context.Context, _ string, _ string, _ []string, in io.Reader, out io.Writer, _ io.Writer) (int, error) {
		raw, _ := io.ReadAll(in)
		scripts = append(scripts, string(raw))
		if strings.Contains(string(raw), "git cat-file") {
			io.WriteString(out, strings.Repeat("a", 40))
		}
		return 0, nil
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
			scripts = nil
			if err := a.Checkout(ctx, chat, paths, "container"); err != nil {
				t.Fatal(err)
			}
			saved, err := s.Chat(ctx, chat.ID)
			if err != nil || len(saved.Configuration.Repositories) != len(repos) || len(saved.StartingCommits) != count {
				t.Fatal("wrong core checkout commits")
			}
			for _, script := range scripts[1:] {
				if strings.Contains(script, "/octo/extra") {
					t.Fatal("extra cloned eagerly")
				}
			}
			if _, err := a.Materialize(ctx, chat.ID, "octo/extra"); err != nil {
				t.Fatal(err)
			}
			saved, _ = s.Chat(ctx, chat.ID)
			if len(saved.StartingCommits) != count+1 {
				t.Fatal("extra base not recorded")
			}
			if _, err := a.Materialize(ctx, chat.ID, "other/repo"); err == nil {
				t.Fatal("unknown repository materialized")
			}
		})
	}
}
