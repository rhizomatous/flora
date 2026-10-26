package githubbroker

import (
	"encoding/base64"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// OfflineTestToken is deliberately public and has no GitHub authority. Only
// this token can be sent to loopback fixture upstreams, never a real secret.
const OfflineTestToken = "local-test-admin-token"
const maxGraphQLBody = 4 << 20 // Fake-upstream fixture limit, not a proxy limit.

// Config controls the host-side broker. GitHub enforces all repository and
// operation permissions of Token. The broker authenticates revocable access
// and confines that token to fixed GitHub destinations.
type Config struct {
	Token  string
	Store  *Store
	Logger *slog.Logger
	Now    func() time.Time
	// Overrides are only for offline fixtures. They require OfflineTest and
	// OfflineTestToken, and must be plain HTTP loopback origins.
	GitUpstream *url.URL
	APIUpstream *url.URL
	OfflineTest bool
}

type Broker struct {
	token       string
	gitUpstream *url.URL
	apiUpstream *url.URL
	store       *Store
	logger      *slog.Logger
	now         func() time.Time
	client      *http.Client
}

func New(cfg Config) (*Broker, error) {
	if cfg.Token == "" || cfg.Store == nil {
		return nil, errors.New("administrator token and capability store are required")
	}
	gitURL, _ := url.Parse("https://github.com")
	apiURL, _ := url.Parse("https://api.github.com")
	if cfg.OfflineTest {
		if cfg.Token != OfflineTestToken {
			return nil, errors.New("offline mode requires the public fixture token")
		}
	} else if cfg.GitUpstream != nil || cfg.APIUpstream != nil {
		return nil, errors.New("upstream overrides require offline test mode")
	}
	for _, pair := range []struct {
		src *url.URL
		dst **url.URL
	}{{cfg.GitUpstream, &gitURL}, {cfg.APIUpstream, &apiURL}} {
		if pair.src == nil {
			continue
		}
		u := *pair.src
		ip := net.ParseIP(u.Hostname())
		if u.Scheme != "http" || ip == nil || !ip.IsLoopback() || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
			return nil, errors.New("offline upstream must be an HTTP loopback origin")
		}
		*pair.dst = &u
	}
	logger := cfg.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	// Do not use environment HTTP proxies for credential-bearing requests.
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	b := &Broker{token: cfg.Token, store: cfg.Store, logger: logger, now: now, gitUpstream: gitURL, apiUpstream: apiURL}
	b.client = &http.Client{
		Transport:     &authTransport{base: transport, token: cfg.Token, origins: map[string]bool{gitURL.Scheme + "://" + gitURL.Host: true, apiURL.Scheme + "://" + apiURL.Host: true}},
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
	return b, nil
}

type authTransport struct {
	base    http.RoundTripper
	token   string
	origins map[string]bool
}

func (t *authTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if !t.origins[req.URL.Scheme+"://"+req.URL.Host] || req.URL.User != nil || req.Host != "" && req.Host != req.URL.Host {
		return nil, errors.New("upstream destination denied")
	}
	out := req.Clone(req.Context())
	out.Header.Set("Authorization", "Bearer "+t.token)
	return t.base.RoundTrip(out)
}

var gitPathRE = regexp.MustCompile(`^/[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*\.git(/info/refs|/git-upload-pack|/git-receive-pack)$`)

func (b *Broker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	cap, ok := b.authenticate(w, r)
	if !ok {
		return
	}
	// This is a reverse proxy, never a forward proxy or CONNECT tunnel.
	if r.URL.IsAbs() || r.Method == http.MethodConnect {
		http.Error(w, "invalid destination", http.StatusBadRequest)
		return
	}
	path := r.URL.Path
	escaped := r.URL.EscapedPath()
	upstream := b.apiUpstream
	switch {
	case gitPathRE.MatchString(path):
		upstream = b.gitUpstream
	case path == "/api/graphql":
		if escaped != "/api/graphql" {
			http.Error(w, "invalid API route prefix", http.StatusBadRequest)
			return
		}
		path = "/graphql"
		escaped = "/graphql"
	case strings.HasPrefix(path, "/api/v3/"):
		// Only the route prefix must be literal. Encoded suffixes remain
		// intact so API paths such as contents/a%2Fb pass through unchanged.
		if !strings.HasPrefix(escaped, "/api/v3/") {
			http.Error(w, "invalid API route prefix", http.StatusBadRequest)
			return
		}
		path = strings.TrimPrefix(path, "/api/v3")
		escaped = strings.TrimPrefix(escaped, "/api/v3")
	default:
		http.NotFound(w, r)
		return
	}
	b.logger.Info("proxy", "chat", cap.ChatID, "method", r.Method)
	// Preserve the escaped path, query, method and body, including GraphQL
	// variables, operationName, aliases, directives and unknown fields.
	b.forward(w, r, upstream, path, escaped)
}

// git uses the capability as Basic username; gh uses its enterprise token.
func (b *Broker) authenticate(w http.ResponseWriter, r *http.Request) (Capability, bool) {
	id := ""
	auth := r.Header.Get("Authorization")
	switch {
	case strings.HasPrefix(auth, "Basic "):
		raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(auth, "Basic "))
		if err == nil {
			id, _, _ = strings.Cut(string(raw), ":")
		}
	case strings.HasPrefix(auth, "token "):
		id = strings.TrimSpace(strings.TrimPrefix(auth, "token "))
	case strings.HasPrefix(auth, "Bearer "):
		id = strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	}
	if id != "" && id != b.token {
		if cap, ok := b.store.Lookup(id); ok && cap.ValidAt(b.now()) {
			return cap, true
		}
	}
	w.Header().Set("WWW-Authenticate", `Basic realm="flora-broker"`)
	http.Error(w, "unauthorized", http.StatusUnauthorized)
	return Capability{}, false
}

func stripHopHeaders(h http.Header) {
	for _, value := range h.Values("Connection") {
		for _, name := range strings.Split(value, ",") {
			h.Del(strings.TrimSpace(name))
		}
	}
	for _, name := range []string{"Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization", "Te", "Trailer", "Transfer-Encoding", "Upgrade"} {
		h.Del(name)
	}
}

func (b *Broker) forward(w http.ResponseWriter, r *http.Request, upstream *url.URL, path, escaped string) {
	out := r.Clone(r.Context())
	out.URL = &url.URL{Scheme: upstream.Scheme, Host: upstream.Host, Path: path, RawPath: escaped, RawQuery: r.URL.RawQuery}
	out.RequestURI = ""
	out.Host = upstream.Host
	out.Header = r.Header.Clone()
	stripHopHeaders(out.Header)
	out.Header.Del("Authorization")
	out.Header.Del("Cookie")
	resp, err := b.client.Do(out)
	if err != nil {
		// Transport errors can contain credential-bearing URLs. Never log them.
		b.logger.Info("upstream unavailable")
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	stripHopHeaders(resp.Header)
	resp.Header.Del("WWW-Authenticate")
	for k, vs := range resp.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
