package changes

import (
	"context"
	"encoding/json"
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
	URL    string `json:"url"`
	Number int    `json:"number"`
	State  string `json:"state"`
	Draft  bool   `json:"draft"`
}
type Pulls struct {
	Items     []Pull `json:"items"`
	CheckedAt string `json:"checkedAt"`
	Error     string `json:"error"`
}

var pullLink = regexp.MustCompile(`https://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/pull/([1-9][0-9]*)`)

// Verify only links for the chat's configured repositories. Conversation text
// never selects an API hostname, and a link alone is not proof of a pull request.
func (s *Service) verifyPulls(ctx context.Context, c storage.Chat, client *http.Client) {
	s.mu.Lock()
	defer s.mu.Unlock()
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
	allowed := map[string]bool{}
	for _, r := range c.Configuration.Repositories {
		u, e := url.Parse(r.URL)
		if e == nil && u.Host == "github.com" {
			allowed[strings.TrimSuffix(strings.Trim(u.Path, "/"), ".git")] = true
		}
	}
	messages, err := s.Store.Messages(ctx, c.ID)
	if err != nil {
		return
	}
	links := map[string]bool{}
	for _, p := range state.Items {
		links[p.URL] = true
	}
	for _, m := range messages {
		for _, match := range pullLink.FindAllStringSubmatch(m.Text+"\n"+string(m.Payload), -1) {
			if allowed[match[1]] {
				links[match[0]] = true
			}
		}
	}
	if len(links) == 0 {
		return
	}
	creds, err := s.Store.Credentials(ctx)
	if err != nil {
		return
	}
	state.CheckedAt = time.Now().UTC().Format(time.RFC3339Nano)
	state.Error = ""
	known := map[string]Pull{}
	for _, p := range state.Items {
		known[p.URL] = p
	}
	secure := *client
	secure.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	for link := range links {
		match := pullLink.FindStringSubmatch(link)
		if len(match) != 3 || !allowed[match[1]] {
			continue
		}
		req, e := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/repos/"+match[1]+"/pulls/"+match[2], nil)
		if e != nil {
			continue
		}
		req.Header.Set("Authorization", "Bearer "+creds.GitHubToken)
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
		res, e := secure.Do(req)
		if e != nil {
			state.Error = "Pull request verification unavailable. Saved statuses may be out of date."
			continue
		}
		var remote struct {
			Number  int    `json:"number"`
			State   string `json:"state"`
			Draft   bool   `json:"draft"`
			Merged  bool   `json:"merged"`
			HTMLURL string `json:"html_url"`
		}
		e = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&remote)
		res.Body.Close()
		number, _ := strconv.Atoi(match[2])
		if e != nil || res.StatusCode != 200 || remote.Number != number || remote.HTMLURL != link || (remote.State != "open" && remote.State != "closed") {
			state.Error = "Pull request verification unavailable. Saved statuses may be out of date."
			continue
		}
		if remote.Merged {
			remote.State = "merged"
		}
		known[link] = Pull{URL: link, Number: number, State: remote.State, Draft: remote.Draft}
	}
	state.Items = []Pull{}
	for _, p := range known {
		state.Items = append(state.Items, p)
	}
	sort.Slice(state.Items, func(i, j int) bool { return state.Items[i].URL < state.Items[j].URL })
	_ = save(root, "pulls.json", state)
}
