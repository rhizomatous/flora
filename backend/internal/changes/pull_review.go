package changes

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type PullRevision struct {
	Repository string `json:"repository"`
	Ref        string `json:"ref"`
	SHA        string `json:"sha"`
}
type PullSnapshot struct {
	Snapshot
	URL          string       `json:"url"`
	Title        string       `json:"title"`
	BaseRevision PullRevision `json:"baseRevision"`
	HeadRevision PullRevision `json:"headRevision"`
}
type PullReview struct {
	Snapshot *PullSnapshot `json:"snapshot"`
	Error    string        `json:"error"`
	Stale    bool          `json:"stale"`
}
type pullDetail struct {
	Number       int            `json:"number"`
	URL          string         `json:"html_url"`
	Title        string         `json:"title"`
	ChangedFiles int            `json:"changed_files"`
	Base         revisionDetail `json:"base"`
	Head         revisionDetail `json:"head"`
}
type revisionDetail struct {
	Ref  string `json:"ref"`
	SHA  string `json:"sha"`
	Repo struct {
		Name string `json:"full_name"`
	} `json:"repo"`
}

func (r revisionDetail) revision() PullRevision { return PullRevision{r.Repo.Name, r.Ref, r.SHA} }

var pullReviews sync.Map
var errPullLimit = errors.New("Pull request exceeds review limits (3,000 files or 128 MiB). Open it on GitHub. Any saved comparison is retained.")
var errPullReview = errors.New("Pull request comparison unavailable. Check GitHub access and retry. Any saved comparison is retained.")

// PullComparison accepts only a saved, verified link belonging to this chat.
// A complete immutable artifact replaces the previous result only after GitHub
// reports the same base and head around all paginated files and the full diff.
func (s *Service) PullComparison(ctx context.Context, id, repository string, number int, refresh, inline bool, client *http.Client) (PullReview, error) {
	if _, err := s.Store.Chat(ctx, id); err != nil {
		return PullReview{}, err
	}
	link := pullURL(repository, number)
	verified := false
	for _, p := range s.ReadPulls(ctx, id).Items {
		if strings.EqualFold(p.URL, link) && p.State != "" {
			verified = true
		}
	}
	if !repositoryName.MatchString(repository) || number < 1 || !verified {
		return PullReview{}, os.ErrNotExist
	}
	paths, err := s.Store.Paths(ctx, id)
	if err != nil {
		return PullReview{}, err
	}
	digest := sha256.Sum256([]byte(link))
	name := fmt.Sprintf("pull-review-%x.json", digest)
	if refresh {
		entry, _ := pullReviews.LoadOrStore(paths.Artifacts+name, &sync.Mutex{})
		lock := entry.(*sync.Mutex)
		lock.Lock()
		defer lock.Unlock()
	}
	root, err := os.OpenRoot(paths.Artifacts)
	if err != nil {
		return PullReview{}, err
	}
	defer root.Close()
	var result PullReview
	if err = load(root, name, &result); err != nil && !errors.Is(err, os.ErrNotExist) {
		return result, err
	}
	if refresh {
		snapshot, fetchErr := s.fetchPullComparison(ctx, repository, number, client)
		result.Error = ""
		if fetchErr != nil {
			result.Error = errPullReview.Error()
			if errors.Is(fetchErr, errPullLimit) {
				result.Error = errPullLimit.Error()
			}
		} else {
			result.Snapshot = snapshot
		}
		result.Stale = result.Error != ""
		if err = save(root, name, result); err != nil {
			return result, err
		}
	}
	if result.Snapshot != nil {
		stamp, e := time.Parse(time.RFC3339Nano, result.Snapshot.CapturedAt)
		result.Stale = result.Stale || e != nil || time.Since(stamp) > 5*time.Minute
		if inline {
			prefs, e := s.Store.Preferences(ctx)
			if e != nil {
				return result, e
			}
			for i := range result.Snapshot.Files {
				f := &result.Snapshot.Files[i]
				if f.Bytes > prefs.InlineDiffBytes {
					f.Diff = ""
					f.Truncated = true
				}
				if f.Binary || f.Undisplayable {
					f.Diff = ""
				}
			}
		}
	}
	return result, nil
}

func (s *Service) fetchPullComparison(ctx context.Context, repository string, number int, client *http.Client) (*PullSnapshot, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	creds, err := s.Store.Credentials(ctx)
	if err != nil || githubDelayed(creds.GitHubToken, time.Now()) {
		return nil, errPullReview
	}
	secure := *client
	secure.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	get := func(path, accept string) ([]byte, error) {
		req, e := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/repos/"+repository+"/pulls/"+strconv.Itoa(number)+path, nil)
		if e != nil {
			return nil, e
		}
		req.Header.Set("Authorization", "Bearer "+creds.GitHubToken)
		req.Header.Set("Accept", accept)
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
		res, e := secure.Do(req)
		if e != nil {
			return nil, e
		}
		defer res.Body.Close()
		if res.StatusCode == 403 || res.StatusCode == 429 {
			delayGitHub(creds.GitHubToken, res.Header, time.Now())
		}
		if res.StatusCode != 200 {
			return nil, errPullReview
		}
		data, e := io.ReadAll(io.LimitReader(res.Body, captureLimit+1))
		if len(data) > captureLimit {
			return nil, errPullLimit
		}
		if e != nil {
			return nil, errPullReview
		}
		return data, nil
	}
	detail := func() (pullDetail, error) {
		var p pullDetail
		data, e := get("", "application/vnd.github+json")
		if e != nil {
			return p, e
		}
		e = json.Unmarshal(data, &p)
		if p.ChangedFiles > 3000 {
			return p, errPullLimit
		}
		if e != nil || p.Number != number || !strings.EqualFold(p.URL, pullURL(repository, number)) || !hash.MatchString(p.Base.SHA) || !hash.MatchString(p.Head.SHA) || !strings.EqualFold(p.Base.Repo.Name, repository) || p.ChangedFiles < 0 {
			return p, errPullReview
		}
		return p, nil
	}
	before, err := detail()
	if err != nil {
		return nil, err
	}
	type remoteFile struct {
		Path      string `json:"filename"`
		Previous  string `json:"previous_filename"`
		Status    string `json:"status"`
		Additions int    `json:"additions"`
		Deletions int    `json:"deletions"`
	}
	files := []remoteFile{}
	for page := 1; len(files) < before.ChangedFiles; page++ {
		data, e := get("/files?per_page=100&page="+strconv.Itoa(page), "application/vnd.github+json")
		if e != nil {
			return nil, e
		}
		var batch []remoteFile
		if json.Unmarshal(data, &batch) != nil || len(batch) == 0 || page > 30 {
			return nil, errPullReview
		}
		files = append(files, batch...)
	}
	if len(files) != before.ChangedFiles {
		return nil, errPullReview
	}
	patch, err := get("", "application/vnd.github.diff")
	if err != nil {
		return nil, err
	}
	after, err := detail()
	if err != nil || before.Base.revision() != after.Base.revision() || before.Head.revision() != after.Head.revision() || before.ChangedFiles != after.ChangedFiles {
		return nil, errPullReview
	}
	snapshot := &PullSnapshot{Snapshot: Snapshot{CapturedAt: time.Now().UTC().Format(time.RFC3339Nano), Base: before.Base.SHA, Files: []File{}}, URL: before.URL, Title: before.Title, BaseRevision: before.Base.revision(), HeadRevision: before.Head.revision()}
	blocks := strings.Split(string(patch), "\ndiff --git ")
	if len(patch) == 0 {
		blocks = nil
	} else if !strings.HasPrefix(blocks[0], "diff --git ") {
		return nil, errPullReview
	}
	for i := 1; i < len(blocks); i++ {
		blocks[i] = "diff --git " + blocks[i]
	}
	index := 0
	for _, remote := range files {
		previous := remote.Previous
		if previous == "" {
			previous = remote.Path
		}
		header := "diff --git " + gitDiffPath("a/"+previous) + " " + gitDiffPath("b/"+remote.Path)
		if index >= len(blocks) || strings.SplitN(blocks[index], "\n", 2)[0] != header {
			return nil, errPullReview
		}
		diff := blocks[index]
		index++
		// A file type change can have two patches for one file.
		if index < len(blocks) && strings.SplitN(blocks[index], "\n", 2)[0] == header {
			diff += "\n" + blocks[index]
			index++
		}
		if index < len(blocks) {
			diff += "\n"
		}
		status := map[string]string{"added": "A", "removed": "D", "renamed": "R", "copied": "C", "modified": "M", "changed": "T", "unchanged": "M"}[remote.Status]
		if status == "" {
			status = remote.Status
		}
		snapshot.Files = append(snapshot.Files, File{Repository: repository, Path: remote.Path, Previous: remote.Previous, Status: status, Diff: diff, Bytes: len(diff), Additions: remote.Additions, Deletions: remote.Deletions, Binary: strings.Contains(diff, "\nBinary files ") || strings.Contains(diff, "\nGIT binary patch\n"), Undisplayable: !utf8.ValidString(diff)})
	}
	if index != len(blocks) {
		return nil, errPullReview
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(encoded)
	snapshot.ID = fmt.Sprintf("%x", sum)
	return snapshot, nil
}

// Git quotes control bytes, non-ASCII bytes, quotes, and backslashes in headers.
func gitDiffPath(path string) string {
	quote := false
	var b strings.Builder
	b.WriteByte('"')
	for _, c := range []byte(path) {
		switch c {
		case '\a':
			b.WriteString(`\a`)
			quote = true
		case '\b':
			b.WriteString(`\b`)
			quote = true
		case '\v':
			b.WriteString(`\v`)
			quote = true
		case '\f':
			b.WriteString(`\f`)
			quote = true
		case '\t':
			b.WriteString(`\t`)
			quote = true
		case '\n':
			b.WriteString(`\n`)
			quote = true
		case '\r':
			b.WriteString(`\r`)
			quote = true
		case '\\', '"':
			b.WriteByte('\\')
			b.WriteByte(c)
			quote = true
		default:
			if c < 32 || c >= 127 {
				fmt.Fprintf(&b, "\\%03o", c)
				quote = true
			} else {
				b.WriteByte(c)
			}
		}
	}
	b.WriteByte('"')
	if quote {
		return b.String()
	}
	return path
}
