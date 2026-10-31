package changes

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type Pull struct {
	Repository string `json:"repository,omitempty"`
	URL        string `json:"url"`
	Number     int    `json:"number"`
	State      string `json:"state"`
	Draft      bool   `json:"draft"`
}
type pullBranch struct {
	Repository     string `json:"repository"`
	HeadRepository string `json:"headRepository"`
	Ref            string `json:"ref"`
	SHA            string `json:"sha"`
	Page           int    `json:"page,omitempty"`
}
type Pulls struct {
	Items      []Pull       `json:"items"`
	CheckedAt  string       `json:"checkedAt"`
	Error      string       `json:"error"`
	Branches   []pullBranch `json:"branches,omitempty"`
	Cursor     int          `json:"cursor,omitempty"`
	Candidates []string     `json:"candidates,omitempty"`
}

var pullLink = regexp.MustCompile(`https://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/pull/([1-9][0-9]*)(?:[/?#\s<>"'\x60),.;\]}]|$)`)
var repositoryName = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

func githubRepository(raw string) string {
	if strings.HasPrefix(raw, "git@github.com:") {
		raw = "https://github.com/" + strings.TrimPrefix(raw, "git@github.com:")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host != "github.com" || (u.Scheme != "https" && u.Scheme != "ssh") || u.RawQuery != "" || u.Fragment != "" {
		return ""
	}
	name := strings.TrimSuffix(strings.Trim(u.Path, "/"), ".git")
	if !repositoryName.MatchString(name) {
		return ""
	}
	return strings.ToLower(name)
}

func pullURL(repo string, number int) string {
	return fmt.Sprintf("https://github.com/%s/pull/%d", strings.ToLower(repo), number)
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
	seen := map[pullBranch]bool{}
	for _, b := range state.Branches {
		b.Page = 0
		seen[b] = true
	}
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
			if !seen[b] {
				state.Branches = append(state.Branches, b)
				seen[b] = true
			}
		}
	}
	return failed
}

type remotePull struct {
	Number  int    `json:"number"`
	State   string `json:"state"`
	Draft   bool   `json:"draft"`
	Merged  bool   `json:"merged"`
	HTMLURL string `json:"html_url"`
	Head    struct {
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
	s.mu.Lock()
	defer s.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	p, err := s.Store.Paths(ctx, c.ID)
	if err != nil {
		return
	}
	root, err := os.OpenRoot(p.Artifacts)
	if err != nil {
		return
	}
	defer root.Close()
	state := Pulls{Items: []Pull{}}
	_ = load(root, "pulls.json", &state)
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
	for _, link := range state.Candidates {
		links[link] = true
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
	get := func(path string, target any) bool {
		if budget == 0 || blocked || ctx.Err() != nil {
			failure()
			return false
		}
		budget--
		req, e := http.NewRequestWithContext(ctx, "GET", "https://api.github.com"+path, nil)
		if e != nil {
			failure()
			return false
		}
		req.Header.Set("Authorization", "Bearer "+creds.GitHubToken)
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
		res, e := secure.Do(req)
		if e != nil {
			failure()
			return false
		}
		defer res.Body.Close()
		if res.StatusCode == 403 || res.StatusCode == 429 || res.StatusCode == 401 {
			blocked = true
		}
		if res.StatusCode != 200 {
			failure()
			return false
		}
		if json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(target) != nil {
			failure()
			return false
		}
		return true
	}
	verify := func(link string) {
		match := pullLink.FindStringSubmatch(link)
		if len(match) != 3 {
			failure()
			return
		}
		var remote remotePull
		if !get("/repos/"+match[1]+"/pulls/"+match[2], &remote) {
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
		known[link] = Pull{Repository: strings.ToLower(match[1]), URL: link, Number: number, State: remote.State, Draft: remote.Draft}
	}
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
			if !get("/repos/"+b.Repository+"/pulls?"+query.Encode(), &candidates) {
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
				if !links[link] {
					state.Candidates = append(state.Candidates, link)
					verify(link)
					links[link] = true
				}
			}
		}
	}
	state.Items = []Pull{}
	for _, p := range known {
		state.Items = append(state.Items, p)
	}
	sort.Slice(state.Items, func(i, j int) bool { return state.Items[i].URL < state.Items[j].URL })
	_ = save(root, "pulls.json", state)
}
