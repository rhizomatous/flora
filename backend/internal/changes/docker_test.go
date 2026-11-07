package changes

import (
	"bytes"
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/docker"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestDockerCaptureAndRemoval(t *testing.T) {
	if os.Getenv("FLORA_CHANGES_DOCKER_TEST") != "1" {
		t.Skip("set FLORA_CHANGES_DOCKER_TEST=1 with flora-agent-test:local available")
	}
	image := os.Getenv("FLORA_CHANGES_TEST_IMAGE")
	if image == "" {
		image = "flora-agent-test:local"
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	engine, err := docker.New("")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { engine.Close() })
	id, err := engine.ContainerCreate(ctx, docker.ContainerSpec{Name: "flora-changes-test-" + strings.ToLower(rand.Text()), Image: image, Env: []string{"OPENCODE_SERVER_PASSWORD=local-fixture-only", "FLORA_UID=1000", "FLORA_GID=1000", "FLORA_CHECKOUT_REQUIRED=1"}, NanoCPUs: 1e9, MemoryBytes: 512 << 20, PidsLimit: 128})
	if err != nil {
		t.Fatal(err)
	}
	removed := false
	t.Cleanup(func() {
		if !removed {
			_ = engine.ContainerRemove(context.Background(), id, true)
		}
	})
	if err = engine.ContainerStart(ctx, id); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	for {
		out.Reset()
		code, e := engine.Exec(ctx, id, "flora", []string{"sh", "-c", `cd /workspace && git init -q && git config user.name Fixture && git config user.email fixture@example.test && printf 'base\n' > hello && git add hello && git commit -qm base && git rev-parse HEAD`}, nil, &out, io.Discard)
		if e == nil && code == 0 {
			break
		}
		if ctx.Err() != nil {
			t.Fatal("fixture repository unavailable")
		}
		time.Sleep(100 * time.Millisecond)
	}
	s, old, _ := fixture(t)
	c, err := s.Store.CreateChat(ctx, old.ProjectID, "Docker review", old.ImageDigest, old.HarnessVersion)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Store.RecordStartingCommit(ctx, c.ID, "core", strings.TrimSpace(out.String())); err != nil {
		t.Fatal(err)
	}
	if err = s.Store.BindRuntime(ctx, c.ID, id, ""); err != nil {
		t.Fatal(err)
	}
	s.Engine = engine
	code, err := engine.Exec(ctx, id, "flora", []string{"sh", "-c", `printf 'changed\n' > /workspace/hello; printf 'new\n' > /workspace/untracked`}, nil, io.Discard, io.Discard)
	if err != nil || code != 0 {
		t.Fatalf("edit fixture: %v %d", err, code)
	}
	if err = s.Refresh(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	r, err := s.Read(ctx, c.ID, false)
	if err != nil || len(r.Snapshot.Files) != 2 {
		t.Fatalf("Docker capture: %+v %v", r, err)
	}
	stamp := r.Snapshot.CapturedAt
	out.Reset()
	code, err = engine.Exec(ctx, id, "flora", []string{"sh", "-c", `cd /workspace && git remote add origin https://github.com/example/core.git && git checkout -qb work && git add . && git commit -qm work && git rev-parse HEAD`}, nil, &out, io.Discard)
	if err != nil || code != 0 {
		t.Fatalf("branch fixture: %v %d", err, code)
	}
	sha := strings.TrimSpace(out.String())
	if err = s.Store.Transition(ctx, c.ID, "", storage.Idle, "Fixture ready"); err != nil {
		t.Fatal(err)
	}
	c, err = s.Store.Chat(ctx, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	credentials(t, s, "docker-fixture-token")
	merged := false
	client := &http.Client{Transport: transport(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/repos/example/core/pulls" {
			return reply(200, fmt.Sprintf(`[{"number":17,"html_url":"https://github.com/example/core/pull/17","head":{"ref":"work","sha":%q,"repo":{"full_name":"example/core"}}}]`, sha)), nil
		}
		state := "open"
		if merged {
			state = "closed"
		}
		return reply(200, fmt.Sprintf(`{"number":17,"state":%q,"merged":%t,"html_url":"https://github.com/example/core/pull/17"}`, state, merged)), nil
	})}
	s.verifyPulls(ctx, c, client)
	r, err = s.Read(ctx, c.ID, false)
	if err != nil || len(r.Pulls.Items) != 1 {
		t.Fatalf("Docker branch discovery: %+v %v", r.Pulls, err)
	}
	if err = engine.ContainerStop(ctx, id, 1); err != nil {
		t.Fatal(err)
	}
	if s.Refresh(ctx, c.ID) == nil {
		t.Fatal("stopped capture succeeded")
	}
	if err = engine.ContainerRemove(ctx, id, false); err != nil {
		t.Fatal(err)
	}
	removed = true
	expirePulls(t, s, c)
	c.Status = storage.Stopped
	merged = true
	s.verifyPulls(ctx, c, client)
	r, err = New(s.Store, nil).Read(ctx, c.ID, false)
	if err != nil || r.Snapshot.CapturedAt != stamp || !r.Stale || r.Error == "" {
		t.Fatalf("removed-container retention: %+v %v", r, err)
	}
	if len(r.Pulls.Items) != 1 || r.Pulls.Items[0].State != "merged" {
		t.Fatalf("removed-container PR retention: %+v", r.Pulls)
	}
}
