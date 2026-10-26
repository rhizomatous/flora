package githubbroker

import (
	"context"
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
	"sync"
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

	nodeMu    sync.Mutex
	nodeCache map[string]string
}

var (
	gitPathRE = regexp.MustCompile(`^/([A-Za-z0-9][A-Za-z0-9._-]*)/([A-Za-z0-9][A-Za-z0-9._-]*)\.git(/info/refs|/git-upload-pack|/git-receive-pack)$`)
	repoAPIRE = regexp.MustCompile(`^repos/([A-Za-z0-9][A-Za-z0-9._-]*)/([A-Za-z0-9][A-Za-z0-9._-]*)(/.*)?$`)
	// restWriteRE bounds the effective REST write scope to pull-request
	// operations. All other mutating endpoints (including destructive
	// ones like repository deletion) are denied even for write
	// capabilities; see ADR 0001.
	restWriteRE = regexp.MustCompile(`^repos/[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*/pulls(/[0-9]+)?$`)
)

// hasDotSegments reports whether a decoded URL path contains "." or ".."
// segments.
func hasDotSegments(path string) bool {
	for _, seg := range strings.Split(path, "/") {
		if seg == "." || seg == ".." {
			return true
		}
	}
	return false
}

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
		nodeCache:   map[string]string{},
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
	// Reject ambiguous paths before any authorization or forwarding
	// decision: percent-encoded paths and dot segments could otherwise
	// reach the upstream under a different shape than the scope check
	// evaluated.
	if r.URL.RawPath != "" || hasDotSegments(r.URL.Path) {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
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
	if op == "api-write" {
		// The effective write scope is pull-request operations only.
		if !cap.Write || (r.Method != http.MethodPost && r.Method != http.MethodPatch) ||
			!restWriteRE.MatchString(rest) {
			b.forbid(w, cap, full, op)
			return
		}
	}
	b.logger.Info("proxy", "chat", cap.ChatID, "repo", strings.ToLower(full), "op", op)
	b.forward(w, r, b.apiUpstream, "/"+rest, r.URL.RawQuery)
}

// graphQLRequest is the JSON envelope gh and other clients post.
type graphQLRequest struct {
	Query         string          `json:"query"`
	Variables     json.RawMessage `json:"variables"`
	OperationName string          `json:"operationName"`
}

// serveGraphQL authorizes GraphQL requests structurally. Every document
// is parsed and validated deny-by-default, first by root field shape and
// repository attribution, then by a full selection-tree schema policy
// (see gqlauthz.go), before anything is forwarded upstream:
//
//   - query: __schema/__type introspection (schema metadata only)
//   - query: repository(owner:, name:) naming an allowlisted repository
//   - query: viewer, constrained by the User policy to identity fields
//   - query: node(id:) whose ID the broker resolves upstream to an
//     allowlisted repository (or an issue/PR belonging to one)
//   - mutation: createPullRequest whose input.repositoryId resolves the
//     same way; requires a write capability
//
// Traversal fields stock gh requests itself (Repository.parent,
// PullRequest.headRepository) are pruned from the forwarded document so
// gh treats the repository as a non-fork. Everything else — multiple
// operations, subscriptions, unknown root fields, unknown nested fields
// or types, fragment cycles, unresolvable references — is denied. There
// is no claim of secure generic GraphQL proxying.
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
	forward, err := b.authorizeGraphQL(r.Context(), cap, gql)
	if err != nil {
		b.forbid(w, cap, "", "api-graphql: "+err.Error())
		return
	}
	b.logger.Info("proxy", "chat", cap.ChatID, "op", "api-graphql")
	r.Body = io.NopCloser(strings.NewReader(string(forward)))
	r.ContentLength = int64(len(forward))
	b.forward(w, r, b.apiUpstream, "/graphql", "")
}

// authorizeGraphQL returns the body to forward (the original, or a
// rewritten document with traversal fields pruned) when the request is
// within the capability's scope, or an error describing the denial.
func (b *Broker) authorizeGraphQL(ctx context.Context, cap Capability, gql graphQLRequest) ([]byte, error) {
	doc, err := ParseGraphQL(gql.Query)
	if err != nil {
		return nil, fmt.Errorf("unparseable document")
	}
	if len(doc.Operations) != 1 {
		return nil, fmt.Errorf("exactly one operation per document is allowed")
	}
	op := doc.Operations[0]
	if op.Type == "subscription" {
		return nil, fmt.Errorf("subscriptions are not supported")
	}
	vars := map[string]any{}
	if len(gql.Variables) > 0 {
		if err := json.Unmarshal(gql.Variables, &vars); err != nil {
			return nil, fmt.Errorf("invalid variables")
		}
	}
	fields, err := doc.RootFields(op)
	if err != nil {
		return nil, fmt.Errorf("invalid selection structure")
	}
	if len(fields) == 0 {
		return nil, fmt.Errorf("no root fields")
	}
	needWrite := false
	// rootTypes records the policy type beneath each root field for the
	// full-tree check. Introspection roots are skipped: they expose only
	// schema metadata.
	rootTypes := map[*GQLField]string{}
	for _, f := range fields {
		switch f.Name {
		case "__schema", "__type":
			if op.Type != "query" {
				return nil, fmt.Errorf("introspection outside query")
			}
		case "viewer":
			// Constrained by the User policy (identity fields only).
			if op.Type != "query" {
				return nil, fmt.Errorf("viewer outside query")
			}
			rootTypes[f] = "User"
		case "repository":
			if op.Type != "query" {
				return nil, fmt.Errorf("repository field outside query")
			}
			repo, err := repoFromArgs(f.Args, vars, op.VarDefaults)
			if err != nil {
				return nil, err
			}
			if !cap.AllowsRepo(repo) {
				return nil, fmt.Errorf("repository %s not authorized", repo)
			}
			rootTypes[f] = "Repository"
		case "node":
			if op.Type != "query" {
				return nil, fmt.Errorf("node field outside query")
			}
			id, ok := ResolveString(f.Args["id"], vars, op.VarDefaults)
			if !ok || id == "" {
				return nil, fmt.Errorf("node id not resolvable")
			}
			repo, err := b.resolveNodeRepo(ctx, id)
			if err != nil {
				return nil, fmt.Errorf("node id not attributable to an authorized repository")
			}
			if !cap.AllowsRepo(repo) {
				return nil, fmt.Errorf("node resolves to unauthorized repository %s", repo)
			}
			rootTypes[f] = "Node"
		case "createPullRequest":
			if op.Type != "mutation" {
				return nil, fmt.Errorf("createPullRequest outside mutation")
			}
			id, ok := resolveInputRepoID(f.Args["input"], vars, op.VarDefaults)
			if !ok || id == "" {
				return nil, fmt.Errorf("repositoryId not resolvable")
			}
			repo, err := b.resolveNodeRepo(ctx, id)
			if err != nil {
				return nil, fmt.Errorf("repositoryId not attributable to an authorized repository")
			}
			if !cap.AllowsRepo(repo) {
				return nil, fmt.Errorf("pull request targets unauthorized repository %s", repo)
			}
			needWrite = true
			rootTypes[f] = "CreatePullRequestPayload"
		default:
			return nil, fmt.Errorf("root field %q is not supported", f.Name)
		}
	}
	if needWrite && !cap.Write {
		return nil, fmt.Errorf("write capability required")
	}

	// Deep check: the entire selection tree beneath every root field must
	// stay within the schema policy, so no nested traversal can reach a
	// repository outside the authorized set. Traversal fields stock gh
	// requests itself (Repository.parent, PullRequest.headRepository) are
	// pruned rather than denied.
	st := &gqlWalk{fragStack: map[string]bool{}}
	for _, f := range fields {
		child, ok := rootTypes[f]
		if !ok {
			continue // introspection root
		}
		if len(f.Selections) == 0 {
			return nil, fmt.Errorf("root field %q requires selections", f.Name)
		}
		sub, err := doc.authorizeSelections(f.Selections, child, st)
		if err != nil {
			return nil, err
		}
		f.Selections = sub
	}
	if st.pruned {
		// Rewriting changes the document, so it must not carry
		// directives whose semantics the serializer cannot preserve.
		if doc.HasDirectives {
			return nil, fmt.Errorf("document requires pruning but uses directives")
		}
		out, err := json.Marshal(map[string]any{
			"query":         doc.String(),
			"variables":     vars,
			"operationName": gql.OperationName,
		})
		if err != nil {
			return nil, err
		}
		b.logger.Info("graphql traversal fields pruned", "chat", cap.ChatID)
		return out, nil
	}
	return json.Marshal(map[string]any{
		"query":         gql.Query,
		"variables":     vars,
		"operationName": gql.OperationName,
	})
}

// repoFromArgs extracts the owner/name pair from a repository field's
// arguments, resolving variables and defaults.
func repoFromArgs(args map[string]GQLValue, vars map[string]any, defaults map[string]GQLValue) (string, error) {
	owner, ok := ResolveString(args["owner"], vars, defaults)
	if !ok || owner == "" {
		return "", fmt.Errorf("repository owner not resolvable")
	}
	name, ok := ResolveString(args["name"], vars, defaults)
	if !ok || name == "" {
		return "", fmt.Errorf("repository name not resolvable")
	}
	repo, err := normalizeRepo(owner + "/" + name)
	if err != nil {
		return "", fmt.Errorf("invalid repository reference")
	}
	return repo, nil
}

// resolveInputRepoID extracts the repositoryId from a mutation input
// argument, whether the input is an inline object or a variable holding
// a JSON object (the shape stock gh uses).
func resolveInputRepoID(input GQLValue, vars map[string]any, defaults map[string]GQLValue) (string, bool) {
	switch input.Kind {
	case vObject:
		return ResolveString(input.Object["repositoryId"], vars, defaults)
	case vVariable:
		if vars != nil {
			if obj, ok := vars[input.Str].(map[string]any); ok {
				if id, ok := obj["repositoryId"].(string); ok && id != "" {
					return id, true
				}
			}
		}
		if d, ok := defaults[input.Str]; ok {
			return resolveInputRepoID(d, nil, nil)
		}
		return "", false
	default:
		return "", false
	}
}

// nodeResolutionQuery asks GitHub which repository a node ID belongs to.
// The broker resolves IDs with its own upstream request (administrator
// token, host-side) before authorizing the container's request.
const nodeResolutionQuery = `query($id:ID!){node(id:$id){__typename ` +
	`... on Repository{nameWithOwner} ` +
	`... on Issue{repository{nameWithOwner}} ` +
	`... on PullRequest{repository{nameWithOwner}}}}`

// resolveNodeRepo maps an opaque GitHub node ID to its owning repository
// via an upstream GraphQL query. Results are cached in memory.
func (b *Broker) resolveNodeRepo(ctx context.Context, id string) (string, error) {
	b.nodeMu.Lock()
	if repo, ok := b.nodeCache[id]; ok {
		b.nodeMu.Unlock()
		return repo, nil
	}
	b.nodeMu.Unlock()

	payload, err := json.Marshal(map[string]any{
		"query":     nodeResolutionQuery,
		"variables": map[string]string{"id": id},
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		b.apiUpstream.ResolveReference(&url.URL{Path: "/graphql"}).String(),
		strings.NewReader(string(payload)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := b.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("node resolution failed: %s", resp.Status)
	}
	var out struct {
		Data struct {
			Node *struct {
				Typename      string `json:"__typename"`
				NameWithOwner string `json:"nameWithOwner"`
				Repository    *struct {
					NameWithOwner string `json:"nameWithOwner"`
				} `json:"repository"`
			} `json:"node"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxGraphQLBody)).Decode(&out); err != nil {
		return "", err
	}
	node := out.Data.Node
	if node == nil {
		return "", fmt.Errorf("unknown node")
	}
	full := node.NameWithOwner
	if full == "" && node.Repository != nil {
		full = node.Repository.NameWithOwner
	}
	if full == "" {
		return "", fmt.Errorf("node type %q is not attributable to a repository", node.Typename)
	}
	repo, err := normalizeRepo(full)
	if err != nil {
		return "", err
	}
	b.nodeMu.Lock()
	// Bound the cache so a container cannot grow it without limit; on
	// overflow, drop it and rebuild (resolutions are cheap and rare).
	if len(b.nodeCache) >= 1024 {
		b.nodeCache = map[string]string{}
	}
	b.nodeCache[id] = repo
	b.nodeMu.Unlock()
	return repo, nil
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
