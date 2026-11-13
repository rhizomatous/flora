package changes

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type Pull struct {
	Title      string `json:"title,omitempty"`
	Additions  *int   `json:"additions,omitempty"`
	Deletions  *int   `json:"deletions,omitempty"`
	Repository string `json:"repository,omitempty"`
	URL        string `json:"url"`
	Number     int    `json:"number"`
	State      string `json:"state"`
	Draft      bool   `json:"draft"`
}

// PullSummary contains saved links and their last discovery result without scan bookkeeping.
type PullSummary struct {
	Items     []Pull `json:"items"`
	CheckedAt string `json:"checkedAt"`
	Error     string `json:"error"`
}

// ReadPulls reads saved PRs without loading diffs or contacting GitHub.
func (s *Service) ReadPulls(ctx context.Context, id string) PullSummary {
	result := PullSummary{Items: []Pull{}}
	paths, err := s.Store.Paths(ctx, id)
	if err == nil {
		var root *os.Root
		root, err = os.OpenRoot(paths.Artifacts)
		if err == nil {
			defer root.Close()
			err = load(root, "pulls.json", &result)
		}
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return PullSummary{Items: []Pull{}, Error: "Saved pull requests unavailable."}
	}
	if result.Items == nil {
		result.Items = []Pull{}
	}
	return result
}

type pullBranch struct {
	Repository     string `json:"repository"`
	HeadRepository string `json:"headRepository"`
	Ref            string `json:"ref"`
	SHA            string `json:"sha"`
	Page           int    `json:"page,omitempty"`
}
type Pulls struct {
	Items      []Pull            `json:"items"`
	CheckedAt  string            `json:"checkedAt"`
	Error      string            `json:"error"`
	Branches   []pullBranch      `json:"branches,omitempty"`
	Cursor     int               `json:"cursor,omitempty"`
	Candidates []string          `json:"candidates,omitempty"`
	Missing    map[string]string `json:"missing,omitempty"`
}

var pullLink = regexp.MustCompile(`https://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/pull/([1-9][0-9]*)(?:[/?#\s<>"'\x60),.;\]}]|$)`)
var repositoryName = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

func githubRepository(raw string) string {
	if !strings.Contains(raw, "://") {
		host, path, ok := strings.Cut(raw, ":")
		if at := strings.LastIndex(host, "@"); at >= 0 {
			host = host[at+1:]
		}
		if ok && strings.EqualFold(host, "github.com") {
			raw = "https://github.com/" + path
		}
	}
	u, err := url.Parse(raw)
	if err != nil || !strings.EqualFold(u.Hostname(), "github.com") || (u.Scheme != "https" && u.Scheme != "ssh") || u.RawQuery != "" || u.Fragment != "" {
		return ""
	}
	if port := u.Port(); port != "" && !((u.Scheme == "https" && port == "443") || (u.Scheme == "ssh" && port == "22")) {
		return ""
	}
	// A single optional .git suffix denotes the transport URL, not part of the
	// repository identity. Preserve other dots and reject extra path segments.
	name := strings.TrimSuffix(strings.TrimSuffix(strings.TrimPrefix(u.Path, "/"), "/"), ".git")
	if !repositoryName.MatchString(name) {
		return ""
	}
	return strings.ToLower(name)
}

func pullURL(repo string, number int) string {
	return fmt.Sprintf("https://github.com/%s/pull/%d", strings.ToLower(repo), number)
}

// A scan is the sole writer of one pulls.json file. Other Service instances use
// the same lock, while readers can keep using the atomically replaced artifact.
// No scan holds the Changes capture/read mutex during Docker or GitHub calls.
var pullScans sync.Map

var githubBackoff = struct {
	sync.Mutex
	until map[[32]byte]time.Time
}{until: map[[32]byte]time.Time{}}

func githubDelayed(token string, now time.Time) bool {
	githubBackoff.Lock()
	defer githubBackoff.Unlock()
	return now.Before(githubBackoff.until[sha256.Sum256([]byte(token))])
}

func delayGitHub(token string, header http.Header, now time.Time) {
	until := now.Add(time.Minute)
	if seconds, err := strconv.ParseInt(header.Get("Retry-After"), 10, 64); err == nil && seconds >= 0 {
		if seconds > 3600 {
			seconds = 3600
		}
		until = now.Add(time.Duration(seconds) * time.Second)
	} else if date, err := http.ParseTime(header.Get("Retry-After")); err == nil {
		until = date
	} else if seconds, err := strconv.ParseInt(header.Get("X-RateLimit-Reset"), 10, 64); err == nil {
		until = time.Unix(seconds, 0)
	}
	if until.Before(now.Add(30 * time.Second)) {
		until = now.Add(30 * time.Second)
	}
	if until.After(now.Add(time.Hour)) {
		until = now.Add(time.Hour)
	}
	githubBackoff.Lock()
	defer githubBackoff.Unlock()
	for key, end := range githubBackoff.until {
		if !now.Before(end) {
			delete(githubBackoff.until, key)
		}
	}
	key := sha256.Sum256([]byte(token))
	if until.After(githubBackoff.until[key]) {
		githubBackoff.until[key] = until
	}
}

type branchKey struct{ repository, head, ref string }

func (b pullBranch) key() branchKey { return branchKey{b.Repository, b.HeadRepository, b.Ref} }

// Keep one tip per branch, including when loading older artifacts that retained
// a tip for every commit. Verified PRs and pending candidates are separate data.
func compactBranches(state *Pulls) map[branchKey]int {
	indices := map[branchKey]int{}
	branches := []pullBranch{}
	for _, b := range state.Branches {
		if i, ok := indices[b.key()]; ok {
			branches[i] = b
		} else {
			indices[b.key()] = len(branches)
			branches = append(branches, b)
		}
	}
	state.Branches = branches
	return indices
}

// Observe local branch tips that differ from the recorded checkout, never remote
// tracking refs. GitHub candidates must match the observed head repository, ref,
// and commit, so the starting default branch does not link unrelated PRs.
// Missing checkouts do not hide other repositories. Observations survive removal.
func (s *Service) observeBranches(ctx context.Context, c storage.Chat, state *Pulls) bool {
	if s.Engine == nil || c.ContainerID == "" || c.Status == storage.Stopped {
		return false
	}
	failed := false
	seen := compactBranches(state)
	for _, r := range c.Configuration.Repositories {
		base := c.StartingCommits[r.Name]
		if base == "" && r.Role == "extra" {
			continue
		}
		if !hash.MatchString(base) {
			failed = true
			continue
		}
		// NUL separators preserve spaces and shell punctuation in branch names.
		out, err := s.command(ctx, c, "cd "+quote(storage.RepositoryPath(c.Configuration, r))+`
git for-each-ref --format='%(refname:short)%00%(objectname)%00%(upstream:remotename)%00%(push:remotename)%00' refs/heads/
`)
		if err != nil {
			failed = true
			continue
		}
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			fields := strings.Split(line, "\x00")
			if len(fields) != 5 || fields[1] == base || !hash.MatchString(fields[1]) {
				continue
			}
			ref := fields[0]
			remote := fields[3]
			if remote == "" || remote == "." {
				remote = fields[2]
			}
			if remote == "" || remote == "." {
				remote = "origin"
			}
			out, err = s.command(ctx, c, "cd "+quote(storage.RepositoryPath(c.Configuration, r))+"\ngit remote get-url --push -- "+quote(remote)+"\n")
			if err != nil {
				failed = true
				continue
			}
			head := githubRepository(strings.TrimSpace(string(out)))
			repo := githubRepository(r.URL)
			if head == "" || repo == "" {
				continue
			}
			b := pullBranch{Repository: repo, HeadRepository: head, Ref: ref, SHA: fields[1]}
			if i, ok := seen[b.key()]; ok {
				if state.Branches[i].SHA != b.SHA {
					state.Branches[i] = b
				}
			} else {
				seen[b.key()] = len(state.Branches)
				state.Branches = append(state.Branches, b)
			}
		}
	}
	return failed
}

type remotePull struct {
	Title     string `json:"title"`
	Additions *int   `json:"additions"`
	Deletions *int   `json:"deletions"`
	Number    int    `json:"number"`
	State     string `json:"state"`
	Draft     bool   `json:"draft"`
	Merged    bool   `json:"merged"`
	HTMLURL   string `json:"html_url"`
	Head      struct {
		Ref  string `json:"ref"`
		SHA  string `json:"sha"`
		Repo struct {
			FullName string `json:"full_name"`
		} `json:"repo"`
	} `json:"head"`
}

// GitHub alone verifies candidate identity. Text can select a repository and PR
// number, but never an API host or redirect destination. Credentials are read
// anew for each bounded scan and are never copied into saved artifacts.
func (s *Service) verifyPulls(ctx context.Context, c storage.Chat, client *http.Client) {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	p, err := s.Store.Paths(ctx, c.ID)
	if err != nil {
		return
	}
	entry, _ := pullScans.LoadOrStore(p.Artifacts, &sync.Mutex{})
	lock := entry.(*sync.Mutex)
	if !lock.TryLock() {
		return
	}
	defer lock.Unlock()
	root, err := os.OpenRoot(p.Artifacts)
	if err != nil {
		return
	}
	defer root.Close()
	state := Pulls{Items: []Pull{}}
	_ = load(root, "pulls.json", &state)
	compactBranches(&state)
	if state.Missing == nil {
		state.Missing = map[string]string{}
	}
	stamp, _ := time.Parse(time.RFC3339Nano, state.CheckedAt)
	if time.Since(stamp) < 30*time.Second {
		return
	}
	state.CheckedAt = time.Now().UTC().Format(time.RFC3339Nano)
	state.Error = ""
	failure := func() {
		state.Error = "Pull request discovery or verification unavailable. Saved links are retained; statuses may be out of date."
	}
	if s.observeBranches(ctx, c, &state) {
		failure()
	}
	messages, err := s.Store.Messages(ctx, c.ID)
	if err != nil {
		failure()
		_ = save(root, "pulls.json", state)
		return
	}
	links := map[string]bool{}
	pendingLinks := map[string]bool{}
	for _, link := range state.Candidates {
		links[link] = true
		pendingLinks[link] = true
	}
	known := map[string]Pull{}
	for _, p := range state.Items {
		link := pullURL(p.Repository, p.Number)
		// Older artifacts may omit the repository field.
		if p.Repository == "" {
			link = strings.ToLower(p.URL)
		}
		links[link] = true
		known[link] = p
	}
	for _, m := range messages {
		for _, match := range pullLink.FindAllStringSubmatch(m.Text+"\n"+string(m.Payload), -1) {
			number, err := strconv.Atoi(match[2])
			if err != nil {
				continue
			}
			links[pullURL(match[1], number)] = true
		}
	}
	type task struct {
		link   string
		branch *pullBranch
	}
	tasks := []task{}
	for link := range links {
		if _, verified := known[link]; !verified {
			if until, err := time.Parse(time.RFC3339Nano, state.Missing[link]); err == nil && time.Now().Before(until) {
				continue
			}
		}
		tasks = append(tasks, task{link: link})
	}
	sort.Slice(tasks, func(i, j int) bool { return tasks[i].link < tasks[j].link })
	sort.Slice(state.Branches, func(i, j int) bool {
		a, b := state.Branches[i], state.Branches[j]
		return a.Repository+"/"+a.HeadRepository+"/"+a.Ref < b.Repository+"/"+b.HeadRepository+"/"+b.Ref
	})
	for i := range state.Branches {
		tasks = append(tasks, task{branch: &state.Branches[i]})
	}
	creds, err := s.Store.Credentials(ctx)
	if err != nil && len(tasks) > 0 {
		failure()
	}
	secure := *client
	secure.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	budget := 32
	blocked := false
	// A missing unverified candidate is not an outage. Remember it for a day so
	// the same saved message cannot reintroduce it on every scan. Known PRs that
	// become inaccessible still retain their saved status and show a warning.
	get := func(path string, target any) int {
		delayed := githubDelayed(creds.GitHubToken, time.Now())
		if budget == 0 || blocked || ctx.Err() != nil || delayed {
			failure()
			blocked = blocked || delayed
			return 0
		}
		budget--
		req, e := http.NewRequestWithContext(ctx, "GET", "https://api.github.com"+path, nil)
		if e != nil {
			failure()
			return 0
		}
		req.Header.Set("Authorization", "Bearer "+creds.GitHubToken)
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
		res, e := secure.Do(req)
		if e != nil {
			failure()
			return 0
		}
		defer res.Body.Close()
		if res.StatusCode == 403 || res.StatusCode == 429 || res.StatusCode == 401 {
			blocked = true
		}
		if res.StatusCode == 403 || res.StatusCode == 429 {
			delayGitHub(creds.GitHubToken, res.Header, time.Now())
		}
		if res.StatusCode == 404 {
			return 404
		}
		if res.StatusCode != 200 {
			failure()
			return 0
		}
		if json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(target) != nil {
			failure()
			return 0
		}
		return 200
	}
	attempted := map[string]bool{}
	verify := func(link string) {
		if attempted[link] {
			return
		}
		attempted[link] = true
		match := pullLink.FindStringSubmatch(link)
		if len(match) != 3 {
			failure()
			return
		}
		var remote remotePull
		status := get("/repos/"+match[1]+"/pulls/"+match[2], &remote)
		if status == 404 {
			if _, verified := known[link]; verified {
				failure()
			} else {
				state.Missing[link] = time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339Nano)
			}
			return
		}
		if status != 200 {
			return
		}
		number, _ := strconv.Atoi(match[2])
		if remote.Number != number || !strings.EqualFold(remote.HTMLURL, link) || (remote.State != "open" && remote.State != "closed") {
			failure()
			return
		}
		if remote.Merged {
			remote.State = "merged"
		}
		known[link] = Pull{Repository: strings.ToLower(match[1]), URL: link, Number: number, State: remote.State, Draft: remote.Draft, Title: remote.Title, Additions: remote.Additions, Deletions: remote.Deletions}
		delete(state.Missing, link)
	}
	confirmed := map[string]bool{}
	if err == nil && len(tasks) > 0 {
		start := state.Cursor % len(tasks)
		for n := 0; n < len(tasks); n++ {
			i := (start + n) % len(tasks)
			if budget == 0 || blocked || ctx.Err() != nil {
				failure()
				break
			}
			state.Cursor = (i + 1) % len(tasks)
			t := tasks[i]
			if t.branch == nil {
				verify(t.link)
				continue
			}
			b := t.branch
			if b.Page < 1 {
				b.Page = 1
			}
			query := url.Values{"state": {"all"}, "head": {strings.Split(b.HeadRepository, "/")[0] + ":" + b.Ref}, "per_page": {"100"}, "page": {strconv.Itoa(b.Page)}}
			var candidates []remotePull
			if get("/repos/"+b.Repository+"/pulls?"+query.Encode(), &candidates) != 200 {
				failure()
				continue
			}
			if len(candidates) == 100 {
				b.Page++
			} else {
				b.Page = 1
			}
			for _, remote := range candidates {
				if remote.Number <= 0 || remote.Head.Ref != b.Ref || remote.Head.SHA != b.SHA || !strings.EqualFold(remote.Head.Repo.FullName, b.HeadRepository) || !strings.EqualFold(remote.HTMLURL, pullURL(b.Repository, remote.Number)) {
					continue
				}
				link := pullURL(b.Repository, remote.Number)
				if _, verified := known[link]; verified || confirmed[link] {
					continue
				}
				confirmed[link] = true
				// A matching GitHub head supersedes a missing message link. Keep
				// the candidate even if this scan has no detail-request budget left.
				delete(state.Missing, link)
				if !pendingLinks[link] {
					state.Candidates = append(state.Candidates, link)
					pendingLinks[link] = true
				}
				verify(link)
			}
		}
	}
	state.Items = []Pull{}
	for _, p := range known {
		state.Items = append(state.Items, p)
	}
	sort.Slice(state.Items, func(i, j int) bool { return state.Items[i].URL < state.Items[j].URL })
	pending := state.Candidates[:0]
	for _, link := range state.Candidates {
		if _, missing := state.Missing[link]; !missing {
			pending = append(pending, link)
		}
	}
	state.Candidates = pending
	_ = save(root, "pulls.json", state)
}
