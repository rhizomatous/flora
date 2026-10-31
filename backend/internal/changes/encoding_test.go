package changes

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
	"testing"
)

type chunkSink struct {
	bytes.Buffer
	largest int
}

func (w *chunkSink) Write(p []byte) (int, error) {
	if len(p) > w.largest {
		w.largest = len(p)
	}
	return w.Buffer.Write(p)
}

func TestSnapshotEncodingBoundsChunksAndPreservesFullDiff(t *testing.T) {
	text := strings.Repeat("\x01\x02<>&\"\\\n🌸\u2028\u2029", 100000)
	snapshot := &Snapshot{ID: "content", CapturedAt: "now", Base: "base", Files: []File{{Path: "quoted\"path", Diff: text, Bytes: len(text), Status: "M"}}}
	var out chunkSink
	if err := encodeJSON(&budgetWriter{w: &out, remaining: snapshotLimit}, snapshot); err != nil {
		t.Fatal(err)
	}
	if out.largest > 6*4100 {
		t.Fatalf("unbounded string encoding chunk: %d", out.largest)
	}
	var saved Snapshot
	if err := json.Unmarshal(out.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Files[0].Diff != text || saved.Files[0].Bytes != len(text) {
		t.Fatal("full control-character diff changed during encoding")
	}
}

func TestEncodedBudgetRejectsWithoutReplacingSavedSnapshot(t *testing.T) {
	root, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	old := &Snapshot{ID: "old", Files: []File{{Path: "file", Diff: "saved full diff"}}}
	if err = save(root, "changes.json", old); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	w := &budgetWriter{w: &out, remaining: 1024}
	if err = encodeJSON(w, &Snapshot{Files: []File{{Diff: strings.Repeat("\x01", 1024)}}}); !errors.Is(err, errReviewLimit) {
		t.Fatalf("encoded amplification bypassed budget: %v", err)
	}
	if out.Len() > 1024 {
		t.Fatal("writer exceeded budget")
	}
	// Count encoded bytes without retaining another copy of the escaped diff.
	if err = encodeFiles(&budgetWriter{w: io.Discard, remaining: 1024}, []File{{Diff: strings.Repeat("\x01", 1024)}}); !errors.Is(err, errReviewLimit) {
		t.Fatal("content hashing bypassed encoded budget")
	}
	if err = saveWithBudget(root, "changes.json", &Snapshot{Files: []File{{Diff: strings.Repeat("\x01", 1024)}}}, 1024); !errors.Is(err, errReviewLimit) {
		t.Fatalf("save did not enforce encoded budget: %v", err)
	}
	if _, err = root.Stat("changes.json.tmp"); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("failed encoded snapshot left a temporary artifact")
	}
	var saved Snapshot
	if err = load(root, "changes.json", &saved); err != nil || saved.ID != old.ID || saved.Files[0].Diff != old.Files[0].Diff {
		t.Fatal("budget failure replaced saved full diff")
	}
}
