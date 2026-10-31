// Package githubbroker authenticates container credentials and forwards ordinary
// git/gh traffic. GitHub alone enforces repository and operation permissions.
package githubbroker

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type Broker struct {
	store       *storage.Store
	transport   http.RoundTripper
	materialize func(context.Context, string, string) (string, error)
}

func New(store *storage.Store) *Broker {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DisableCompression = true
	return &Broker{store: store, transport: transport}
}

func (b *Broker) Revoke(ctx context.Context, chatID string) error {
	return b.store.RevokeGitHubCapability(ctx, chatID)
}

var gitPath = regexp.MustCompile(`^/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git/(info/refs|git-upload-pack|git-receive-pack)$`)

func (b *Broker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	credential := ""
	if user, password, ok := r.BasicAuth(); ok {
		credential = user
		if password != "" && password != "x-oauth-basic" {
			credential = password
		}
	} else {
		kind, value, _ := strings.Cut(r.Header.Get("Authorization"), " ")
		if strings.EqualFold(kind, "bearer") || strings.EqualFold(kind, "token") {
			credential = value
		}
	}
	if credential == "" {
		unauthorized(w)
		return
	}
	chatID, err := b.store.GitHubCapability(r.Context(), credential, time.Now())
	if err != nil {
		unauthorized(w)
		return
	}
	if r.Method == http.MethodConnect || r.URL.IsAbs() || r.URL.User != nil || r.URL.Opaque != "" || r.Header.Get("Upgrade") != "" {
		http.Error(w, "invalid destination", http.StatusBadRequest)
		return
	}
	path, escaped := r.URL.Path, r.URL.EscapedPath()
	if path == "/api/v3/flora/repositories" && escaped == path {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var in struct {
			Repository string `json:"repository"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&in) != nil || in.Repository == "" {
			http.Error(w, "provide a repository identity", http.StatusBadRequest)
			return
		}
		if b.materialize == nil {
			http.Error(w, "repository fetching unavailable", http.StatusServiceUnavailable)
			return
		}
		p, err := b.materialize(r.Context(), chatID, in.Repository)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"path": p})
		return
	}
	origin := "https://api.github.com"
	git := false
	switch {
	case gitPath.MatchString(path) && path == escaped:
		origin, git = "https://github.com", true
	case path == "/api/graphql" && escaped == path:
		path, escaped = "/graphql", "/graphql"
	case strings.HasPrefix(path, "/api/v3/") && strings.HasPrefix(escaped, "/api/v3/"):
		path, escaped = strings.TrimPrefix(path, "/api/v3"), strings.TrimPrefix(escaped, "/api/v3")
	default:
		http.NotFound(w, r)
		return
	}
	// Read the saved token for each request so credential rotation takes effect
	// without restarting containers or replacing their broker credentials.
	credentials, err := b.store.Credentials(r.Context())
	if err != nil || credentials.GitHubToken == "" {
		http.Error(w, "GitHub credential unavailable; check installation settings", http.StatusServiceUnavailable)
		return
	}
	upstream, _ := url.Parse(origin)
	proxy := &httputil.ReverseProxy{
		Transport: &authenticatedTransport{base: b.transport, token: credentials.GitHubToken, origin: origin, git: git},
		Rewrite: func(p *httputil.ProxyRequest) {
			p.SetURL(upstream)
			p.Out.Host = upstream.Host
			p.Out.URL.Path, p.Out.URL.RawPath = path, escaped
			p.Out.URL.RawQuery, p.Out.URL.ForceQuery = p.In.URL.RawQuery, p.In.URL.ForceQuery
			for _, header := range []string{"Authorization", "Cookie", "Proxy-Authorization", "Connection", "Upgrade", "Te"} {
				p.Out.Header.Del(header)
			}
			p.Out.Trailer = nil
			p.Out.Header.Set("Accept-Encoding", "identity")
		},
		ModifyResponse: func(resp *http.Response) error {
			if encoding := resp.Header.Get("Content-Encoding"); encoding != "" && encoding != "identity" {
				resp.Body.Close()
				return errors.New("unexpected upstream content encoding")
			}
			// Never let a client follow an authenticated redirect, or receive
			// upstream cookies, auth challenges or response trailers.
			for _, header := range []string{"Location", "Refresh", "Set-Cookie", "WWW-Authenticate", "Proxy-Authenticate", "Trailer"} {
				resp.Header.Del(header)
			}
			resp.Trailer = nil
			if resp.StatusCode >= 300 && resp.StatusCode < 400 {
				resp.Body.Close()
				return errors.New("upstream redirect denied")
			}
			secrets := credentialForms(credentials.GitHubToken)
			for key, values := range resp.Header {
				for i := range values {
					values[i] = redact(values[i], secrets)
				}
				resp.Header[key] = values
			}
			resp.Header.Del("Content-Length")
			resp.ContentLength = -1
			resp.Body = &noTrailerBody{ReadCloser: newRedactedBody(resp.Body, secrets), response: resp}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
			http.Error(w, "GitHub upstream unavailable or redirected; check repository and host network", http.StatusBadGateway)
		},
		ErrorLog: log.New(io.Discard, "", 0),
	}
	proxy.ServeHTTP(w, r)
}

func unauthorized(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", `Basic realm="flora-github"`)
	http.Error(w, "GitHub broker credential expired or revoked; restart the chat to renew access", http.StatusUnauthorized)
}

type authenticatedTransport struct {
	base          http.RoundTripper
	token, origin string
	git           bool
}

func (t *authenticatedTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Scheme+"://"+r.URL.Host != t.origin || r.URL.User != nil || r.Host != r.URL.Host {
		return nil, errors.New("upstream destination denied")
	}
	out := r.Clone(r.Context())
	if t.git {
		out.SetBasicAuth("x-access-token", t.token)
	} else {
		out.Header.Set("Authorization", "Bearer "+t.token)
	}
	return t.base.RoundTrip(out)
}
