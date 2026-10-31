// Package projects validates GitHub configuration before saving projects.
package projects

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type Input struct {
	Name          string                `json:"name"`
	Configuration storage.Configuration `json:"configuration"`
}

const MaxRepositories = 100

// MaxInputBytes allows 100 repository rows, including fully JSON-escaped names,
// URLs (300 bytes), branches (255 bytes), and an 8192-byte setup command.
const MaxInputBytes = 512 << 10

type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }
func invalid(message string) error       { return &ValidationError{message} }

type Service struct {
	Store  *storage.Store
	Client *http.Client
}

func New(store *storage.Store) *Service {
	return &Service{Store: store, Client: &http.Client{Timeout: 10 * time.Second}}
}

var ownerPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,38}$`)
var repoPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,100}$`)

func repository(raw string) (string, error) {
	if strings.HasPrefix(raw, "https://") {
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawPath != "" {
			return "", invalid("Enter owner/repository or an HTTPS github.com repository URL without credentials or query parameters.")
		}
		raw = strings.TrimPrefix(u.Path, "/")
	}
	raw = strings.TrimSuffix(strings.TrimSuffix(raw, "/"), ".git")
	parts := strings.Split(raw, "/")
	if len(parts) != 2 || !ownerPattern.MatchString(parts[0]) || !repoPattern.MatchString(parts[1]) || parts[1] == "." || parts[1] == ".." {
		return "", invalid("Enter a GitHub repository as owner/repository or its HTTPS URL.")
	}
	return raw, nil
}

func validBranch(branch string) bool {
	if branch == "" || len(branch) > 255 || branch == "@" || strings.HasPrefix(branch, "-") || strings.Contains(branch, "..") || strings.Contains(branch, "@{") || strings.ContainsAny(branch, " ~^:?*[\\") {
		return false
	}
	for _, r := range branch {
		if r < 32 || r == 127 {
			return false
		}
	}
	for _, part := range strings.Split(branch, "/") {
		if part == "" || strings.HasPrefix(part, ".") || strings.HasSuffix(part, ".") || strings.HasSuffix(part, ".lock") {
			return false
		}
	}
	return true
}

// Validate uses only GitHub's fixed API host. The token remains in host request
// headers, and redirects, remote bodies, and transport errors never reach users.
// A branch tip observed here is not the chat's starting commit; checkout records it.
func (s *Service) Validate(ctx context.Context, in Input) (Input, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || len(in.Name) > 200 {
		return in, invalid("Enter a project name of at most 200 bytes.")
	}
	if len(in.Configuration.SetupCommand) > 8192 || strings.ContainsRune(in.Configuration.SetupCommand, 0) {
		return in, invalid("Setup command must be at most 8192 bytes and contain no NUL characters.")
	}
	if len(in.Configuration.Repositories) == 0 || len(in.Configuration.Repositories) > MaxRepositories {
		return in, invalid("Configure between 1 and 100 repositories for this project.")
	}
	seen := map[string]bool{}
	for i := range in.Configuration.Repositories {
		r := &in.Configuration.Repositories[i]
		if len(r.URL) > 300 || len(r.Name) > 140 {
			return in, invalid("Repository URL or name is too long.")
		}
		name, err := repository(r.URL)
		if err != nil {
			return in, err
		}
		r.Name, r.URL = name, "https://github.com/"+name+".git"
		if seen[strings.ToLower(name)] {
			return in, invalid("Configure each GitHub repository only once.")
		}
		seen[strings.ToLower(name)] = true
		if r.Role == "" {
			r.Role = "core"
		}
		if r.Role != "core" && r.Role != "extra" {
			return in, invalid(name + ": Repository role must be core or extra.")
		}
		if r.BaseBranch != "" && !validBranch(r.BaseBranch) {
			return in, invalid(name + ": Enter a valid Git branch name.")
		}
	}
	c, err := s.Store.Credentials(ctx)
	if errors.Is(err, storage.ErrNotFound) || (err == nil && c.GitHubToken == "") {
		return in, invalid("Save a GitHub token in installation settings before connecting a project.")
	}
	if err != nil {
		return in, err
	}
	client := *s.Client
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	for i := range in.Configuration.Repositories {
		r := &in.Configuration.Repositories[i]
		name := r.Name
		get := func(endpoint string, branch bool, out any) error {
			req, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/repos/"+name+endpoint, nil)
			if err != nil {
				return invalid("Unable to prepare GitHub repository validation.")
			}
			req.Header.Set("Authorization", "Bearer "+c.GitHubToken)
			req.Header.Set("Accept", "application/vnd.github+json")
			req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
			res, err := client.Do(req)
			if err != nil {
				return invalid("Cannot reach GitHub. Check the host network and try again.")
			}
			defer res.Body.Close()
			switch res.StatusCode {
			case 200:
				if out != nil && json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(out) != nil {
					return invalid("GitHub returned an invalid repository response. Try again.")
				}
				return nil
			case 401:
				return invalid("GitHub rejected the saved token. Check its value and expiry in installation settings.")
			case 403:
				return invalid("GitHub denied access or rate limited the request. Check token permissions and try again later.")
			case 404:
				if branch {
					return invalid("Base branch was not found. Check the branch name and repository access.")
				}
				return invalid("Repository was not found or the saved token cannot access it. Check the repository and token's selected repositories.")
			default:
				return invalid("GitHub validation is unavailable. Try again later.")
			}
		}
		var repo struct {
			DefaultBranch string `json:"default_branch"`
		}
		if err := get("", false, &repo); err != nil {
			return in, invalid(name + ": " + err.Error())
		}
		if r.BaseBranch == "" {
			r.BaseBranch = repo.DefaultBranch
		}
		if !validBranch(r.BaseBranch) {
			return in, invalid(name + ": Repository has no usable default branch. Create a branch on GitHub first.")
		}
		if err := get("/branches/"+url.PathEscape(r.BaseBranch), true, nil); err != nil {
			return in, invalid(name + ": " + err.Error())
		}
	}
	return in, nil
}
