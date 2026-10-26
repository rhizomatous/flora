package githubbroker

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

// GitBackend serves git smart HTTP for the bare repositories under
// projectRoot by wrapping `git http-backend`. The broker targets it as its
// git upstream. When RequireToken is non-empty, requests must carry
// `Authorization: Bearer <RequireToken>`, emulating GitHub's
// private-repository behavior. It powers the fake upstream used by tests
// and by the local container integration run.
type GitBackend struct {
	ProjectRoot  string
	RequireToken string
	// SawToken reports whether any request arrived with the required token.
	SawToken bool
	// Requests counts upstream hits.
	Requests int
}

func (g *GitBackend) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	g.Requests++
	if g.RequireToken != "" {
		if r.Header.Get("Authorization") != "Bearer "+g.RequireToken {
			http.Error(w, "upstream auth required", http.StatusUnauthorized)
			return
		}
		g.SawToken = true
	}
	cmd := exec.Command("git", "http-backend")
	cmd.Env = append(os.Environ(),
		"GIT_PROJECT_ROOT="+g.ProjectRoot,
		"GIT_HTTP_EXPORT_ALL=1",
		"PATH_INFO="+r.URL.Path,
		"REQUEST_METHOD="+r.Method,
		"QUERY_STRING="+r.URL.RawQuery,
		"CONTENT_TYPE="+r.Header.Get("Content-Type"),
		"CONTENT_LENGTH="+strconv.FormatInt(r.ContentLength, 10),
		"REMOTE_USER=probe",
	)
	cmd.Stdin = r.Body
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		http.Error(w, "backend failed", http.StatusInternalServerError)
		return
	}
	header, body, _ := bytes.Cut(out.Bytes(), []byte("\r\n\r\n"))
	status := http.StatusOK
	for _, line := range strings.Split(string(header), "\r\n") {
		k, v, ok := strings.Cut(line, ": ")
		if !ok {
			continue
		}
		if strings.EqualFold(k, "Status") {
			code, _, _ := strings.Cut(v, " ")
			if n, err := strconv.Atoi(code); err == nil {
				status = n
			}
			continue
		}
		w.Header().Set(k, v)
	}
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// FakeGitHub is a self-contained fake of the GitHub endpoints the broker
// proxies: git smart HTTP under /owner/repo.git plus minimal REST under
// /api/v3 and GraphQL under /api/graphql. Every route requires the
// administrator-style bearer token, so a passing integration run proves
// the broker injects credentials upstream. API responses are canned JSON;
// it is a transport fixture, not a GitHub emulator. DebugLog, when set,
// receives GraphQL request bodies for fixture development.
type FakeGitHub struct {
	Git      *GitBackend
	DebugLog *slog.Logger
}

func (f *FakeGitHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	// Explicit upstream denial fixture. The broker must preserve this denial.
	if strings.Contains(path, "/octo/denied") {
		http.Error(w, "Resource not accessible by personal access token", http.StatusForbidden)
		return
	}
	// Git smart-HTTP requests hit /owner/repo.git/...; the broker's API
	// traffic arrives as /repos/... (REST) or /graphql.
	if !strings.Contains(path, ".git") {
		if f.Git.RequireToken != "" &&
			r.Header.Get("Authorization") != "Bearer "+f.Git.RequireToken {
			http.Error(w, "upstream auth required", http.StatusUnauthorized)
			return
		}
		f.Git.SawToken = true
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if path == "/graphql" {
			body, _ := io.ReadAll(io.LimitReader(r.Body, maxGraphQLBody))
			if f.DebugLog != nil {
				f.DebugLog.Info("graphql", "body", string(body))
			}
			_, _ = io.WriteString(w, FakeGraphQL(body))
			return
		}
		_, _ = io.WriteString(w, cannedAPIResponse(path))
		return
	}
	f.Git.ServeHTTP(w, r)
}

// cannedAPIResponse returns plausible JSON for the repository-scoped calls
// the probe makes. Pull-request creation and views get stable fields so gh
// can print them.
func cannedAPIResponse(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	fullName := ""
	if len(parts) >= 3 && parts[0] == "repos" {
		fullName = parts[1] + "/" + parts[2]
	}
	switch {
	case strings.Contains(path, "/pulls"):
		return `{"number":1,"draft":true,"html_url":"https://example.test/` + fullName + `/pull/1","title":"probe"}`
	default:
		return `{"full_name":"` + fullName + `","private":true,"default_branch":"main"}`
	}
}

const FakeRepoNodeID = "repo-node-octo-demo"

// fakePullRequest is a superset of the fields gh pr view asks for, so the
// stock gh binary can render a draft PR from the fixture.
const fakePullRequest = `"id":"pr-node-1","number":1,"title":"Flora probe draft PR",` +
	`"state":"OPEN","isDraft":true,"url":"https://example.test/octo/demo/pull/1",` +
	`"body":"probe","author":{"login":"probe"},"baseRefName":"main",` +
	`"headRefName":"probe/change","headRepository":{"name":"demo"},` +
	`"headRepositoryOwner":{"login":"octo"},"isCrossRepository":false,` +
	`"maintainerCanModify":true,"createdAt":"2026-01-01T00:00:00Z",` +
	`"updatedAt":"2026-01-01T00:00:00Z","labels":{"nodes":[]},` +
	`"assignees":{"nodes":[]},"milestone":null,"projectCards":{"nodes":[]}`

// FakeGraphQL answers the GraphQL shapes the broker and the stock gh
// binary send, using only the request body. It is a test fixture: pattern
// matching is acceptable here because no security decision relies on it.
func FakeGraphQL(body []byte) string {
	var req struct {
		Query     string         `json:"query"`
		Variables map[string]any `json:"variables"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		return `{"errors":[{"message":"bad request"}]}`
	}
	q := req.Query
	switch {
	case strings.Contains(q, "createPullRequest"):
		return `{"data":{"createPullRequest":{"pullRequest":{` + fakePullRequest + `}}}}`
	case strings.Contains(q, "__schema"):
		return `{"data":{"__schema":{"queryType":{"name":"Query"},"mutationType":{"name":"Mutation"}}}}`
	case strings.Contains(q, "__type"):
		// gh's *_fields introspection; a plausible field list keeps the
		// stock binary moving. Answer under whatever alias the query
		// uses (gh 2.103 aliases it, e.g. `Issue: __type(...)`).
		fields := `{"name":"id"},{"name":"number"},{"name":"title"},{"name":"body"},` +
			`{"name":"state"},{"name":"url"},{"name":"author"},{"name":"labels"},` +
			`{"name":"assignees"},{"name":"milestone"},{"name":"projectCards"},` +
			`{"name":"createdAt"},{"name":"updatedAt"},{"name":"isDraft"},` +
			`{"name":"baseRefName"},{"name":"headRefName"},{"name":"headRepository"},` +
			`{"name":"headRepositoryOwner"},{"name":"isCrossRepository"},` +
			`{"name":"maintainerCanModify"}`
		typ := `{"fields":[` + fields + `]}`
		var data strings.Builder
		aliases := regexp.MustCompile(`(\w+)\s*:\s*__type`).FindAllStringSubmatch(q, -1)
		if len(aliases) == 0 {
			data.WriteString(`"__type":` + typ)
		}
		for i, m := range aliases {
			if i > 0 {
				data.WriteString(",")
			}
			data.WriteString(`"` + m[1] + `":` + typ)
		}
		return `{"data":{` + data.String() + `}}`
	case strings.Contains(q, "repository"):
		// Answer plain and aliased repository root fields with a rich
		// repository object covering what gh's repository-network and
		// pull-request queries read.
		repo := `"id":"` + FakeRepoNodeID + `","name":"demo","nameWithOwner":"octo/demo",` +
			`"owner":{"login":"octo"},"isPrivate":true,"viewerPermission":"ADMIN",` +
			`"defaultBranchRef":{"name":"main"},"parent":null,` +
			`"url":"https://example.test/octo/demo"`
		if strings.Contains(q, "pullRequests(") {
			repo += `,"pullRequests":{"nodes":[]}`
		}
		if strings.Contains(q, "pullRequest(") {
			repo += `,"pullRequest":{` + fakePullRequest + `}`
		}
		var data strings.Builder
		data.WriteString(`"repository":{` + repo + `}`)
		for _, m := range regexp.MustCompile(`(\w+)\s*:\s*repository\(`).FindAllStringSubmatch(q, -1) {
			data.WriteString(`,"` + m[1] + `":{` + repo + `}`)
		}
		if strings.Contains(q, "viewer") {
			data.WriteString(`,"viewer":{"login":"probe-admin"}`)
		}
		return `{"data":{` + data.String() + `}}`
	case strings.Contains(q, "viewer"):
		return `{"data":{"viewer":{"login":"probe-admin"}}}`
	default:
		return `{"data":{}}`
	}
}
