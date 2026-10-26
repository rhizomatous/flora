package githubbroker

import (
	"bytes"
	"io"
	"net/http"
	"os"
	"os/exec"
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
// it is a transport fixture, not a GitHub emulator.
type FakeGitHub struct {
	Git *GitBackend
}

func (f *FakeGitHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
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
	case path == "/graphql":
		return `{"data":{"repository":{"id":"fake"}}}`
	default:
		return `{"full_name":"` + fullName + `","private":true,"default_branch":"main"}`
	}
}
