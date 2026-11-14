package testfixture

import (
	"context"
	"encoding/json"
	"github.com/rhizomatous/flora/backend/internal/changes"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"os"
	"path/filepath"
	"strings"
)

// SavedReview writes saved diffs and pull requests for a new chat in the supplied project.
func SavedReview(store *storage.Store, p storage.Project) (storage.Chat, error) {
	ctx := context.Background()
	c, err := store.CreateChat(ctx, p.ID, "Saved changes", "flora@sha256:"+strings.Repeat("a", 64), "1.2.27")
	if err != nil {
		return storage.Chat{}, err
	}
	paths, err := store.Paths(ctx, c.ID)
	if err != nil {
		return storage.Chat{}, err
	}
	snap := changes.Snapshot{ID: "fixture-snapshot", CapturedAt: "2026-01-01T00:00:00Z", Base: strings.Repeat("b", 40), Files: []changes.File{
		{Path: "src/hello.ts", Status: "M", Diff: "diff --git a/src/hello.ts b/src/hello.ts\n+hello review\n", Bytes: 61},
		{Path: "big.txt", Status: "A", Diff: strings.Repeat("+large line\n", 100000), Bytes: 1200000},
		{Path: "picture.png", Status: "M", Binary: true, Diff: "Binary files differ\n", Bytes: 20},
		{Path: "removed.txt", Status: "D", Diff: "-removed\n", Bytes: 9},
	}}
	snap.Bases = map[string]string{"first/app": strings.Repeat("b", 40), "second/app": strings.Repeat("c", 40)}
	for i := range snap.Files {
		snap.Files[i].Repository = "first/app"
	}
	snap.Files[1].Repository = "second/app"
	snap.Files = append(snap.Files, changes.File{Repository: "second/app", Path: "src/hello.ts", Status: "M", Diff: "+second repository review\n", Bytes: 26})
	b, _ := json.Marshal(snap)
	if err = os.WriteFile(filepath.Join(paths.Artifacts, "changes.json"), b, 0600); err != nil {
		return storage.Chat{}, err
	}
	pulls := changes.Pulls{CheckedAt: "2026-01-01T00:00:00Z", Error: "Pull request verification unavailable. Saved statuses may be out of date.", Items: []changes.Pull{
		{Repository: "first/app", URL: "https://github.com/first/app/pull/7", Number: 7, State: "open", Draft: true},
		{Repository: "second/app", URL: "https://github.com/second/app/pull/7", Number: 7, State: "merged"},
		{Repository: "first/app", URL: "https://github.com/first/app/pull/8", Number: 8, State: "closed"},
		{Repository: "third/private", URL: "https://github.com/third/private/pull/9", Number: 9, State: "open"},
		{Repository: "third/private", URL: "https://github.com/third/private/pull/10", Number: 10, State: ""},
	}}
	b, _ = json.Marshal(pulls)
	if err = os.WriteFile(filepath.Join(paths.Artifacts, "pulls.json"), b, 0600); err != nil {
		return storage.Chat{}, err
	}
	return c, nil
}
