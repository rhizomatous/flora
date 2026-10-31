package githubbroker

import (
	"bytes"
	"context"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/changes"
	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

// This fixture never uses a live GitHub token or sends a model request.
func TestMultiRepositoryDocker(t *testing.T) {
	image := os.Getenv("FLORA_MULTI_TEST_IMAGE")
	if image == "" {
		t.Skip("set FLORA_MULTI_TEST_IMAGE to a pinned local agent image")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	s, old, b := fixture(t)
	identity := image
	if !strings.Contains(identity, "@sha256:") {
		identity = old.ImageDigest
	}
	sha, _ := fixtureUpstream(t, b, "other/demo", "octo/extra")
	repos := []storage.Repository{
		{Name: "octo/demo", URL: "https://github.com/octo/demo.git", BaseBranch: "main", Role: "core"},
		{Name: "other/demo", URL: "https://github.com/other/demo.git", BaseBranch: "release", Role: "core"},
		{Name: "octo/extra", URL: "https://github.com/octo/extra.git", BaseBranch: "main", Role: "extra"},
	}
	p, err := s.CreateProject(ctx, "collection", storage.Configuration{Repositories: repos, SetupCommand: "test -d repos/octo/demo/.git && test -d repos/other/demo/.git && test ! -e repos/octo/extra && printf ready > setup-ran"})
	if err != nil {
		t.Fatal(err)
	}
	chat, err := s.CreateChat(ctx, p.ID, "multi", identity, old.HarnessVersion)
	if err != nil {
		t.Fatal(err)
	}
	ca, host := privateTLS(t, b, image)
	engine, err := docker.New("")
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	img, err := engine.ImageInspect(ctx, image)
	if err != nil {
		t.Fatal(err)
	}
	access, err := NewAccess(b, engine, CheckoutConfig{Host: host, CACert: ca, Timeout: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	m, err := provisioning.New(engine, s, provisioning.Config{ImageRef: image, ImageDigest: chat.ImageDigest, ImageID: img.ID, HarnessVersion: old.HarnessVersion, ReadyTimeout: time.Minute}, access)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = engine.ContainerRemove(context.Background(), "flora-chat-"+chat.ID, true) })
	upstream := b.transport
	var outage atomic.Bool
	var extraOutage atomic.Bool
	outage.Store(true)
	b.transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if outage.Load() && strings.HasPrefix(r.URL.Path, "/other/demo.git/") {
			return response(r, 503, "fixture outage"), nil
		}
		if extraOutage.Load() && strings.HasPrefix(r.URL.Path, "/octo/extra.git/") {
			return response(r, 404, "fixture missing extra"), nil
		}
		return upstream.RoundTrip(r)
	})
	if _, err := m.Start(ctx, chat.ID); err == nil {
		t.Fatal("partial checkout released setup")
	}
	chat, _ = s.Chat(ctx, chat.ID)
	if len(chat.StartingCommits) != 1 || chat.StartingCommits["octo/demo"] != sha {
		t.Fatal("partial checkout lost first base")
	}
	if err := engine.ContainerStart(ctx, chat.ContainerID); err != nil {
		t.Fatal(err)
	}
	run := func(script string) string {
		t.Helper()
		var out, diagnostic bytes.Buffer
		code, err := engine.Exec(ctx, chat.ContainerID, "flora", []string{"sh", "-c", "set -eu\n" + script}, nil, &out, &diagnostic)
		if err != nil || code != 0 {
			t.Fatalf("fixture command: %d %v %s", code, err, &diagnostic)
		}
		return strings.TrimSpace(out.String())
	}
	run("test ! -e /workspace/setup-ran; cd /workspace/repos/octo/demo; printf 'preserved\\n' > hello.txt; git add hello.txt; git commit -qm preserved")
	outage.Store(false)
	if _, err := m.Start(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	chat, _ = s.Chat(ctx, chat.ID)
	if len(chat.StartingCommits) != 2 {
		t.Fatal("wrong eager bases")
	}
	run("test -f /workspace/setup-ran; test ! -e /workspace/repos/octo/extra; grep preserved /workspace/repos/octo/demo/hello.txt")
	review := changes.New(s, engine)
	if err := review.Refresh(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	r, err := review.Read(ctx, chat.ID, false)
	if err != nil || len(r.Snapshot.Bases) != 2 || len(r.Snapshot.Files) != 1 || r.Snapshot.Files[0].Repository != "octo/demo" {
		t.Fatalf("before extra: %+v %v", r, err)
	}
	// The helper uses stock gh against the private broker and persists the base.
	extraOutage.Store(true)
	run("if /home/flora/bin/flora-repository octo/extra; then exit 1; fi; test ! -e /workspace/repos/octo/extra")
	chat, _ = s.Chat(ctx, chat.ID)
	if len(chat.StartingCommits) != 2 {
		t.Fatal("failed extra fetch recorded a base")
	}
	extraOutage.Store(false)
	// Later project edits cannot change what this chat fetches on demand.
	if err := s.UpdateProject(ctx, p.ID, "updated", storage.Configuration{Repositories: repos[:1], SetupCommand: "different setup"}); err != nil {
		t.Fatal(err)
	}
	next, err := s.CreateChat(ctx, p.ID, "later", identity, old.HarnessVersion)
	if err != nil || len(next.Configuration.Repositories) != 1 || next.Configuration.SetupCommand != "different setup" {
		t.Fatal("new chat did not use updated settings")
	}
	run("/home/flora/bin/flora-repository octo/extra; cd /workspace/repos/octo/extra; printf 'extra\\n' > hello.txt; printf '\\000binary' > binary; yes 'large line' | head -c 1100000 > large")
	chat, _ = s.Chat(ctx, chat.ID)
	if len(chat.StartingCommits) != 3 || chat.StartingCommits["octo/extra"] != sha {
		t.Fatal("extra base missing")
	}
	run("/home/flora/bin/flora-repository octo/extra; grep extra /workspace/repos/octo/extra/hello.txt")
	if _, err := access.Materialize(ctx, chat.ID, "unknown/repo"); err == nil {
		t.Fatal("unknown repository recorded")
	}
	if err := review.Refresh(ctx, chat.ID); err != nil {
		t.Fatal(err)
	}
	r, err = review.Read(ctx, chat.ID, true)
	if err != nil || len(r.Snapshot.Bases) != 3 || len(r.Snapshot.Files) != 4 {
		if r.Snapshot != nil {
			t.Logf("bases: %v", r.Snapshot.Bases)
			for _, f := range r.Snapshot.Files {
				t.Logf("file: %s %s %d", f.Repository, f.Path, f.Bytes)
			}
		}
		t.Fatalf("after extra: %+v %v", r, err)
	}
	for _, f := range r.Snapshot.Files {
		if f.Path == "binary" && (!f.Binary || f.Repository != "octo/extra") {
			t.Fatal("binary identity")
		}
		if f.Path == "large" && (!f.Truncated || f.Repository != "octo/extra") {
			t.Fatal("large identity")
		}
	}
	// GitHub's token permissions, rather than configured chat membership, decide
	// whether ordinary git/gh requests are authorized.
	run(". /home/flora/.flora-github.env; gh api repos/not-configured/repository >/dev/null")
	paths, _ := s.Paths(ctx, chat.ID)
	if err := access.Checkout(ctx, chat, paths, chat.ContainerID); err != nil {
		t.Fatal(err)
	}
	run("grep preserved /workspace/repos/octo/demo/hello.txt; grep extra /workspace/repos/octo/extra/hello.txt")
	run("mv /workspace/repos/other/demo /workspace/repos/other/backup")
	if err := access.Checkout(ctx, chat, paths, chat.ContainerID); err == nil {
		t.Fatal("missing recorded checkout was recreated")
	}
	run("test ! -e /workspace/repos/other/demo; grep preserved /workspace/repos/octo/demo/hello.txt")
}
