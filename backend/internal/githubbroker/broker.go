package githubbroker

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Config controls a Broker. The administrator fine-grained token enters only
// through Token and is injected on the upstream hop; it is never written to
// container-visible files, environment, process arguments, or responses.
type Config struct {
	// Token is the administrator fine-grained GitHub token, restricted to
	// the selected repositories. It stays host-side.
	Token string
	// GitUpstream serves git smart HTTP. Defaults to https://github.com.
	GitUpstream *url.URL
	// APIUpstream serves the GitHub REST and GraphQL APIs. Defaults to
	// https://api.github.com.
	APIUpstream *url.URL
	// Store holds the host-side capability set.
	Store *Store
	// Logger receives request logs. The broker never logs credentials.
	Logger *slog.Logger
	// Now overrides the clock for tests.
	Now func() time.Time
}

// Broker is an http.Handler that proxies scoped git and GitHub API traffic
// for agent containers.
type Broker struct {
	token       string
	gitUpstream *url.URL
	apiUpstream *url.URL
	store       *Store
	logger      *slog.Logger
	now         func() time.Time
	client      *http.Client
}

var (
	gitPathRE = regexp.MustCompile(`^/([A-Za-z0-9][A-Za-z0-9._-]*)/([A-Za-z0-9][A-Za-z0-9._-]*)\.git(/info/refs|/git-upload-pack|/git-receive-pack)$`)
	repoAPIRE = regexp.MustCompile(`^repos/([A-Za-z0-9][A-Za-z0-9._-]*)/([A-Za-z0-9][A-Za-z0-9._-]*)(/.*)?$`)
)

const maxGraphQLBody = 4 << 20

// New builds a Broker. The returned client never follows redirects, so the
// administrator token cannot be forwarded to a redirect target, and the
// transport injects the token only for requests aimed at the configured
// upstream hosts.
func New(cfg Config) (*Broker, error) {
	if cfg.Token == "" {
		return nil, errors.New("administrator token is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("capability store is required")
	}
	gitUpstream := cfg.GitUpstream
	if gitUpstream == nil {
		gitUpstream, _ = url.Parse("https://github.com")
	}
	apiUpstream := cfg.APIUpstream
	if apiUpstream == nil {
		apiUpstream, _ = url.Parse("https://api.github.com")
	}
	logger := cfg.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	b := &Broker{
		token:       cfg.Token,
		gitUpstream: gitUpstream,
		apiUpstream: apiUpstream,
		store:       cfg.Store,
		logger:      logger,
		now:         now,
	}
	b.client = &http.Client{
		Transport: &authTransport{
			base:  http.DefaultTransport,
			token: cfg.Token,
			hosts: map[string]bool{
				strings.ToLower(gitUpstream.Host): true,
				strings.ToLower(apiUpstream.Host): true,
			},
		},
		// Never follow redirects. GitHub does not redirect smart HTTP or
		// API traffic in normal operation, and following could carry the
		// request to a host we do not control.
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	return b, nil
}

// authTransport attaches the administrator token only to requests whose host
// is one of the configured GitHub upstreams. Even if a request is ever aimed
// elsewhere, the token stays behind.
type authTransport struct {
	base  http.RoundTripper
	token string
	hosts map[string]bool
}

func (t *authTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if t.hosts[strings.ToLower(req.URL.Host)] {
		req = req.Clone(req.Context())
		req.Header.Set("Authorization", "Bearer "+t.token)
	}
	return t.base.RoundTrip(req)
}

func (b *Broker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	cap, ok := b.authenticate(w, r)
	if !ok {
		return
	}
	path := r.URL.Path
	if m := gitPathRE.FindStringSubmatch(path); m != nil {
		b.serveGit(w, r, cap, m[1], m[2], m[3])
		return
	}
	if path == "/api/graphql" {
		b.serveGraphQL(w, r, cap)
		return
	}
	if rest := strings.TrimPrefix(path, "/api/v3/"); rest != path {
		b.serveREST(w, r, cap, rest)
		return
	}
	http.NotFound(w, r)
}

// authenticate extracts the container-side capability from the request. git
// presents it as the username of an HTTPS basic-auth URL
// (https://CAPABILITY@broker/owner/repo.git); gh presents it as the
// enterprise token (Authorization: token CAPABILITY).
func (b *Broker) authenticate(w http.ResponseWriter, r *http.Request) (Capability, bool) {
	fail := func() {
		// Generic message, no token material. The Basic challenge lets git
		// retry with the capability embedded in its remote URL; containers
		// run with GIT_TERMINAL_PROMPT=0 so a missing capability fails
		// cleanly instead of prompting.
		w.Header().Set("WWW-Authenticate", `Basic realm="flora-broker"`)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	}
	id := ""
	auth := r.Header.Get("Authorization")
	switch {
	case strings.HasPrefix(auth, "Basic "):
		raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(auth, "Basic "))
		if err != nil {
			fail()
			return Capability{}, false
		}
		user, _, _ := strings.Cut(string(raw), ":")
		id = user
	case strings.HasPrefix(auth, "token "):
		id = strings.TrimSpace(strings.TrimPrefix(auth, "token "))
	case strings.HasPrefix(auth, "Bearer "):
		id = strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	default:
		fail()
		return Capability{}, false
	}
	// The administrator token is never accepted as a container credential.
	if id == "" || id == b.token {
		fail()
		return Capability{}, false
	}
	cap, ok := b.store.Lookup(id)
	if !ok || !cap.ValidAt(b.now()) {
		fail()
		return Capability{}, false
	}
	return cap, true
}

func (b *Broker) forbid(w http.ResponseWriter, cap Capability, repo, op string) {
	b.logger.Info("denied", "chat", cap.ChatID, "repo", repo, "op", op)
	http.Error(w, "forbidden", http.StatusForbidden)
}

func (b *Broker) allow(w http.ResponseWriter, cap Capability, repo, op string) bool {
	repoNorm, err := normalizeRepo(repo)
	if err != nil || !cap.AllowsRepo(repoNorm) {
		b.forbid(w, cap, repo, op)
		return false
	}
	return true
}

func (b *Broker) serveGit(w http.ResponseWriter, r *http.Request, cap Capability, owner, repo, suffix string) {
	full := owner + "/" + repo
	write := suffix == "/git-receive-pack"
	if suffix == "/info/refs" {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		write = r.URL.Query().Get("service") == "git-receive-pack"
	} else if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	op := "git-fetch"
	if write {
		op = "git-push"
	}
	if !b.allow(w, cap, full, op) {
		return
	}
	if write && !cap.Write {
		b.forbid(w, cap, full, op)
		return
	}
	b.logger.Info("proxy", "chat", cap.ChatID, "repo", strings.ToLower(full), "op", op)
	b.forward(w, r, b.gitUpstream, r.URL.Path, r.URL.RawQuery)
}

func (b *Broker) serveREST(w http.ResponseWriter, r *http.Request, cap Capability, rest string) {
	m := repoAPIRE.FindStringSubmatch(rest)
	if m == nil {
		// Only repository-scoped endpoints are proxied. Account-level
		// endpoints such as /user would act on the administrator rather
		// than the chat's repositories.
		b.forbid(w, cap, "", "api:"+r.Method+" /api/v3/"+rest)
		return
	}
	full := m[1] + "/" + m[2]
	op := "api-read"
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		op = "api-write"
	}
	if !b.allow(w, cap, full, op) {
		return
	}
	if op == "api-write" && !cap.Write {
		b.forbid(w, cap, full, op)
		return
	}
	b.logger.Info("proxy", "chat", cap.ChatID, "repo", strings.ToLower(full), "op", op)
	b.forward(w, r, b.apiUpstream, "/"+rest, r.URL.RawQuery)
}

var (
	gqlOwnerRE = regexp.MustCompile(`owner:\s*"([^"]+)"`)
	gqlNameRE  = regexp.MustCompile(`name:\s*"([^"]+)"`)
)

type graphQLRequest struct {
	Query     string          `json:"query"`
	Variables json.RawMessage `json:"variables"`
}

// serveGraphQL proxies GraphQL only when every repository referenced by the
// query is authorized for this capability. gh uses GraphQL for `gh pr view`
// and `gh pr create`. The check is a conservative heuristic: it collects
// owner/name pairs from variables and inline literals, requires at least one
// reference, and denies anything it cannot attribute.
func (b *Broker) serveGraphQL(w http.ResponseWriter, r *http.Request, cap Capability) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxGraphQLBody))
	if err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	var gql graphQLRequest
	if err := json.Unmarshal(body, &gql); err != nil || gql.Query == "" {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	owners := map[string]bool{}
	names := map[string]bool{}
	for _, m := range gqlOwnerRE.FindAllStringSubmatch(gql.Query, -1) {
		owners[strings.ToLower(m[1])] = true
	}
	for _, m := range gqlNameRE.FindAllStringSubmatch(gql.Query, -1) {
		names[strings.ToLower(m[1])] = true
	}
	var vars map[string]any
	if len(gql.Variables) > 0 && json.Unmarshal(gql.Variables, &vars) == nil {
		if v, ok := vars["owner"].(string); ok {
			owners[strings.ToLower(v)] = true
		}
		if v, ok := vars["name"].(string); ok {
			names[strings.ToLower(v)] = true
		}
	}
	if len(owners) == 0 || len(names) == 0 {
		b.forbid(w, cap, "", "api-graphql")
		return
	}
	for owner := range owners {
		for name := range names {
			repo := owner + "/" + name
			op := "api-read"
			if strings.Contains(gql.Query, "mutation") {
				op = "api-write"
			}
			if !cap.AllowsRepo(repo) || (op == "api-write" && !cap.Write) {
				b.forbid(w, cap, repo, op)
				return
			}
		}
	}
	b.logger.Info("proxy", "chat", cap.ChatID, "op", "api-graphql")
	r.Body = io.NopCloser(strings.NewReader(string(body)))
	r.ContentLength = int64(len(body))
	b.forward(w, r, b.apiUpstream, "/graphql", "")
}

var hopHeaders = []string{
	"Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization",
	"Te", "Trailer", "Transfer-Encoding", "Upgrade",
}

// forward proxies one authorized request upstream and streams the response.
// The administrator token is added by the transport, host-side only.
func (b *Broker) forward(w http.ResponseWriter, r *http.Request, upstream *url.URL, path, rawQuery string) {
	out := r.Clone(r.Context())
	out.URL = &url.URL{
		Scheme:   upstream.Scheme,
		Host:     upstream.Host,
		Path:     path,
		RawQuery: rawQuery,
	}
	out.RequestURI = ""
	out.Host = upstream.Host
	out.Header = r.Header.Clone()
	out.Header.Del("Authorization")
	out.Header.Del("Cookie")
	for _, h := range hopHeaders {
		out.Header.Del(h)
	}
	resp, err := b.client.Do(out)
	if err != nil {
		b.logger.Info("upstream error", "error", sanitizeErr(err, b.token))
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	for k, vs := range resp.Header {
		if strings.EqualFold(k, "Www-Authenticate") {
			// Do not invite the container to answer an interactive
			// credential prompt.
			continue
		}
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

// sanitizeErr removes any accidental occurrence of the administrator token
// from an error before it reaches logs.
func sanitizeErr(err error, token string) string {
	msg := err.Error()
	if token != "" {
		msg = strings.ReplaceAll(msg, token, "[redacted]")
	}
	return fmt.Sprintf("%v", msg)
}
