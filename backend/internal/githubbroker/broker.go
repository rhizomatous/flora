package githubbroker

import (
	"encoding/base64"
	"errors"
	"io"
	"log"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
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
	transport   http.RoundTripper
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
	b.transport = &authTransport{base: transport, token: cfg.Token, origins: map[string]bool{gitURL.Scheme + "://" + gitURL.Host: true, apiURL.Scheme + "://" + apiURL.Host: true}}
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

func (b *Broker) forward(w http.ResponseWriter, r *http.Request, upstream *url.URL, path, escaped string) {
	proxy := &httputil.ReverseProxy{
		// ReverseProxy uses RoundTrip directly, so redirects are not followed.
		Transport: b.transport,
		Rewrite: func(req *httputil.ProxyRequest) {
			req.SetURL(upstream) // Fixed origin and outbound Host, never the inbound Host.
			req.Out.URL.Path = path
			req.Out.URL.RawPath = escaped
			// Rewrite normally cleans unparsable queries. We do not interpret
			// query parameters for authorization, so preserve the original bytes.
			req.Out.URL.RawQuery = req.In.URL.RawQuery
			req.Out.URL.ForceQuery = req.In.URL.ForceQuery
			req.Out.Header.Del("Authorization")
			req.Out.Header.Del("Cookie")
			// The standard proxy strips hop headers, but opts back into
			// upgrades and trailer negotiation. This broker supports neither.
			req.Out.Header.Del("Connection")
			req.Out.Header.Del("Upgrade")
			req.Out.Header.Del("Te")
		},
		ModifyResponse: func(resp *http.Response) error {
			resp.Header.Del("WWW-Authenticate")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
			// Transport errors can contain credential-bearing URLs. Never log them.
			b.logger.Info("upstream unavailable")
			http.Error(w, "upstream unavailable", http.StatusBadGateway)
		},
		// Internal copy/stream errors can contain secrets too.
		ErrorLog: log.New(io.Discard, "", 0),
	}
	proxy.ServeHTTP(w, r)
}
