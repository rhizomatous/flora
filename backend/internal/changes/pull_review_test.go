package changes

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestPullComparisonRevisionRetentionAndIsolation(t *testing.T) {
	s, c, _ := fixture(t)
	ctx := context.Background()
	credentials(t, s, "test-review-token")
	paths, _ := s.Store.Paths(ctx, c.ID)
	root, _ := os.OpenRoot(paths.Artifacts)
	defer root.Close()
	if err := save(root, "pulls.json", Pulls{Items: []Pull{{URL: pullURL("example/core", 42), State: "open"}, {URL: pullURL("other/repo", 42), State: "open"}}}); err != nil {
		t.Fatal(err)
	}
	head := strings.Repeat("a", 40)
	base := strings.Repeat("b", 40)
	fail := false
	race := false
	details := 0
	large := "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+" + strings.Repeat("new", 400000) + "\n"
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "api.github.com" || r.Header.Get("Authorization") != "Bearer test-review-token" {
			t.Fatal("unsafe GitHub request")
		}
		body := ""
		status := 200
		if fail {
			status = 404
		} else if strings.HasSuffix(r.URL.Path, "/files") {
			body = `[{"filename":"file.txt","status":"modified","additions":1,"deletions":1},{"filename":"image.png","status":"added"}]`
		} else if r.Header.Get("Accept") == "application/vnd.github.diff" {
			body = large + "diff --git a/image.png b/image.png\nnew file mode 100644\nBinary files /dev/null and b/image.png differ\n"
		} else {
			details++
			sha := head
			if race && details%2 == 0 {
				sha = strings.Repeat("c", 40)
			}
			repo := strings.Split(strings.TrimPrefix(r.URL.Path, "/repos/"), "/pulls/")[0]
			body = fmt.Sprintf(`{"number":42,"html_url":%q,"title":"Actual PR","changed_files":2,"base":{"ref":"main","sha":%q,"repo":{"full_name":%q}},"head":{"ref":"topic","sha":%q,"repo":{"full_name":"fork/core"}}}`, pullURL(repo, 42), base, repo, sha)
		}
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
	fetch := func(repo string, refresh, inline bool) PullReview {
		t.Helper()
		r, err := s.PullComparison(ctx, c.ID, repo, 42, refresh, inline, client)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	r := fetch("example/core", true, true)
	if r.Snapshot == nil || r.Error != "" || !r.Snapshot.Files[0].Truncated || r.Snapshot.Files[0].Diff != "" || !r.Snapshot.Files[1].Binary {
		t.Fatalf("bad comparison: %+v", r)
	}
	savedID := r.Snapshot.ID
	if f := fetch("example/core", false, false).Snapshot.Files[0]; !strings.Contains(f.Diff, strings.Repeat("new", 400000)) {
		t.Fatal("full download lost")
	}
	if fetch("other/repo", false, true).Snapshot != nil {
		t.Fatal("repositories share a snapshot")
	}
	fail = true
	r = fetch("example/core", true, true)
	if r.Snapshot.ID != savedID || r.Error == "" || !r.Stale {
		t.Fatal("failed refresh discarded saved comparison")
	}
	fail = false
	race = true
	details = 0
	r = fetch("example/core", true, true)
	if r.Snapshot.ID != savedID || r.Error == "" {
		t.Fatal("mixed revisions accepted")
	}
	race = false
	base = strings.Repeat("d", 40)
	head = strings.Repeat("e", 40)
	r = fetch("example/core", true, true)
	if r.Error != "" || r.Snapshot.ID == savedID || r.Snapshot.BaseRevision.SHA != base || r.Snapshot.HeadRevision.SHA != head {
		t.Fatal("changed base/head not captured")
	}
	if _, err := s.PullComparison(ctx, c.ID, "unlinked/repo", 42, true, true, client); !os.IsNotExist(err) {
		t.Fatal("unverified link accepted")
	}
	raw, _ := root.ReadFile("pulls.json")
	var pulls Pulls
	if json.Unmarshal(raw, &pulls) != nil || len(pulls.Items) != 2 {
		t.Fatal("links overwritten")
	}
}

func TestFetchPullComparisonPaginationAndEmpty(t *testing.T) {
	for _, count := range []int{0, 101, 3001} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			s, _, _ := fixture(t)
			credentials(t, s, "pagination-token")
			type file struct {
				Path   string `json:"filename"`
				Status string `json:"status"`
			}
			files := []file{}
			var patch strings.Builder
			for i := 0; i < count && count <= 3000; i++ {
				path := fmt.Sprintf("file-%03d.txt", i)
				files = append(files, file{path, "modified"})
				fmt.Fprintf(&patch, "diff --git a/%s b/%s\n--- a/%s\n+++ b/%s\n@@ -1 +1 @@\n-old\n+new\n", path, path, path, path)
			}
			pages := 0
			client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
				body := ""
				switch {
				case strings.HasSuffix(r.URL.Path, "/files"):
					pages++
					start := (pages - 1) * 100
					end := min(start+100, len(files))
					data, _ := json.Marshal(files[start:end])
					body = string(data)
				case r.Header.Get("Accept") == "application/vnd.github.diff":
					body = patch.String()
				default:
					body = fmt.Sprintf(`{"number":42,"html_url":"https://github.com/example/core/pull/42","changed_files":%d,"base":{"ref":"main","sha":%q,"repo":{"full_name":"example/core"}},"head":{"ref":"topic","sha":%q}}`, count, strings.Repeat("a", 40), strings.Repeat("b", 40))
				}
				return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
			})}
			snapshot, err := s.fetchPullComparison(context.Background(), "example/core", 42, client)
			if count > 3000 {
				if err != errPullLimit {
					t.Fatalf("missing limit diagnostic %v", err)
				}
				return
			}
			if err != nil || len(snapshot.Files) != count || (count == 101 && pages != 2) {
				t.Fatalf("incomplete comparison: %v, %d pages", err, pages)
			}
			if count > 0 && snapshot.Files[count-1].Diff != "diff --git a/file-100.txt b/file-100.txt\n--- a/file-100.txt\n+++ b/file-100.txt\n@@ -1 +1 @@\n-old\n+new\n" {
				t.Fatal("full patch bytes changed")
			}
		})
	}
}
