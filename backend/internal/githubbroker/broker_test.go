package githubbroker

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

const fixtureToken = "github_pat_public_fixture_not_a_secret"
const fixtureCapability = "public-fixture-container-credential-123456789"

func fixture(t *testing.T) (*storage.Store, storage.Chat, *Broker) {
	t.Helper()
	ctx := context.Background()
	s, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if err := s.SaveCredentials(ctx, storage.Credentials{GitHubToken: fixtureToken, Provider: "anthropic", Model: "fixture", ProviderKey: "unused-fixture"}); err != nil {
		t.Fatal(err)
	}
	p, err := s.CreateProject(ctx, "fixture", storage.Configuration{Repositories: []storage.Repository{{Name: "octo/demo", URL: "https://github.com/octo/demo.git", BaseBranch: "main", Role: "core"}}})
	if err != nil {
		t.Fatal(err)
	}
	chat, err := s.CreateChat(ctx, p.ID, "fixture", "fixture@sha256:"+strings.Repeat("a", 64), "1.2.27")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ReplaceGitHubCapability(ctx, chat.ID, fixtureCapability, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	return s, chat, New(s)
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(r *http.Request, status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: r}
}

func request(b *Broker, method, path, body, credential string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+credential)
	w := httptest.NewRecorder()
	b.ServeHTTP(w, r)
	return w
}

func TestTransportPreservesTokenAuthority(t *testing.T) {
	s, _, b := fixture(t)
	cases := []struct {
		method, path, upstream, body string
		git                          bool
	}{
		{"POST", "/other/repository.git/git-receive-pack", "https://github.com/other/repository.git/git-receive-pack", "pack bytes", true},
		{"DELETE", "/api/v3/repos/other/repository", "https://api.github.com/repos/other/repository", "", false},
		{"PATCH", "/api/v3/repos/other/repository/contents/a%2Fb?x=%2f&bad=%zz", "https://api.github.com/repos/other/repository/contents/a%2Fb?x=%2f&bad=%zz", "fixture write", false},
		{"POST", "/api/graphql", "https://api.github.com/graphql", `{"query":"mutation($id:ID!){arbitraryOperation(id:$id)}","variables":{"id":"outside-project"}}`, false},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			b.transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.URL.String() != tc.upstream || r.Method != tc.method || r.Host != r.URL.Host {
					t.Fatalf("destination/method changed: %s %s", r.Method, r.URL)
				}
				var raw []byte
				if r.Body != nil {
					raw, _ = io.ReadAll(r.Body)
				}
				if string(raw) != tc.body {
					t.Fatal("body changed")
				}
				if tc.git {
					user, pass, ok := r.BasicAuth()
					if !ok || user != "x-access-token" || pass != fixtureToken {
						t.Fatal("git auth mismatch")
					}
				} else if r.Header.Get("Authorization") != "Bearer "+fixtureToken {
					t.Fatal("API auth mismatch")
				}
				if r.Header.Get("Cookie") != "" || r.Header.Get("Proxy-Authorization") != "" || r.Header.Get("X-Forwarded-Host") != "" {
					t.Fatal("inbound credentials or forwarding headers leaked")
				}
				return response(r, 200, "ok"), nil
			})
			r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			r.Header.Set("Authorization", "token "+fixtureCapability)
			r.Header.Set("Cookie", "bad=credential")
			r.Header.Set("Proxy-Authorization", "bad")
			r.Header.Set("X-Forwarded-Host", "attacker")
			w := httptest.NewRecorder()
			b.ServeHTTP(w, r)
			if w.Code != 200 || w.Body.String() != "ok" {
				t.Fatalf("status %d", w.Code)
			}
		})
	}
	rotated := "github_pat_rotated_fixture"
	if err := s.SaveCredentials(context.Background(), storage.Credentials{GitHubToken: rotated, Provider: "anthropic", Model: "fixture", ProviderKey: "unused-fixture"}); err != nil {
		t.Fatal(err)
	}
	b.transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Authorization") != "Bearer "+rotated {
			t.Fatal("stale administrator token")
		}
		return response(r, 403, "upstream denial"), nil
	})
	if w := request(b, "GET", "/api/v3/repos/denied/repo", "", fixtureCapability); w.Code != 403 || w.Body.String() != "upstream denial" {
		t.Fatal("GitHub denial changed")
	}
}

func TestCredentialAndDestinationBoundary(t *testing.T) {
	s, chat, b := fixture(t)
	hits := 0
	b.transport = roundTripFunc(func(r *http.Request) (*http.Response, error) { hits++; return response(r, 200, "ok"), nil })
	for _, credential := range []string{"", fixtureToken, "unknown"} {
		if w := request(b, "GET", "/api/v3/user", "", credential); w.Code != 401 {
			t.Fatalf("accepted invalid credential: %d", w.Code)
		}
	}
	for _, path := range []string{"https://attacker.test/api/v3/user", "/api/%76%33/user", "/%61pi/graphql", "/api/v3evil/user", "/owner/repo.git/../../attacker"} {
		if w := request(b, "GET", path, "", fixtureCapability); w.Code < 400 {
			t.Fatalf("accepted route %s", path)
		}
	}
	if w := request(b, "CONNECT", "/api/v3/user", "", fixtureCapability); w.Code != 400 {
		t.Fatal("accepted CONNECT")
	}
	if hits != 0 {
		t.Fatal("invalid requests reached upstream")
	}
	if err := b.Revoke(context.Background(), chat.ID); err != nil {
		t.Fatal(err)
	}
	if w := request(b, "GET", "/api/v3/user", "", fixtureCapability); w.Code != 401 {
		t.Fatal("revocation failed")
	}
	if err := s.ReplaceGitHubCapability(context.Background(), chat.ID, fixtureCapability, time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GitHubCapability(context.Background(), fixtureCapability, time.Now().Add(2*time.Second)); err == nil {
		t.Fatal("expiry failed")
	}
	newCredential := fixtureCapability + "new"
	if err := s.ReplaceGitHubCapability(context.Background(), chat.ID, newCredential, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if w := request(b, "GET", "/api/v3/user", "", fixtureCapability); w.Code != 401 {
		t.Fatal("rotation kept old credential")
	}
	if w := request(b, "GET", "/api/v3/user", "", newCredential); w.Code != 200 {
		t.Fatal("replacement credential rejected")
	}
	other, err := s.CreateChat(context.Background(), chat.ProjectID, "independent", chat.ImageDigest, chat.HarnessVersion)
	if err != nil {
		t.Fatal(err)
	}
	otherCredential := fixtureCapability + "other"
	if err := s.ReplaceGitHubCapability(context.Background(), other.ID, otherCredential, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := b.Revoke(context.Background(), chat.ID); err != nil {
		t.Fatal(err)
	}
	if w := request(b, "GET", "/api/v3/user", "", otherCredential); w.Code != 200 {
		t.Fatal("revoking one chat revoked another")
	}
	tx := &authenticatedTransport{base: b.transport, token: fixtureToken, origin: "https://api.github.com"}
	r, _ := http.NewRequest("GET", "https://attacker.test/", nil)
	if _, err := tx.RoundTrip(r); err == nil {
		t.Fatal("transport allowed foreign origin")
	}
}

func TestLateTrailersAndCompressedResponsesCannotLeak(t *testing.T) {
	_, _, b := fixture(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/compressed" {
			w.Header().Set("Content-Encoding", "gzip")
			io.WriteString(w, "opaque compressed credential")
			return
		}
		w.Header().Set("Trailer", "X-Credential")
		w.WriteHeader(200)
		io.WriteString(w, "ordinary body")
		w.Header().Set("X-Credential", fixtureToken)
	}))
	defer upstream.Close()
	b.transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		out := r.Clone(r.Context())
		u, _ := http.NewRequest("GET", upstream.URL+r.URL.Path, nil)
		out.URL = u.URL
		out.Host = u.URL.Host
		return http.DefaultTransport.RoundTrip(out)
	})
	w := request(b, "GET", "/api/v3/trailers", "", fixtureCapability)
	result := w.Result()
	defer result.Body.Close()
	_, _ = io.ReadAll(result.Body)
	if result.Trailer.Get("X-Credential") != "" || w.Header().Get("X-Credential") != "" {
		t.Fatal("late response trailer leaked")
	}
	if w := request(b, "GET", "/api/v3/compressed", "", fixtureCapability); w.Code != 502 {
		t.Fatal("uninspectable compressed response accepted")
	}
}

func TestUpstreamLeakAndRedirectBoundary(t *testing.T) {
	_, _, b := fixture(t)
	for _, status := range []int{301, 302, 307, 308} {
		b.transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
			resp := response(r, status, fixtureToken)
			resp.Header.Set("Location", "https://attacker.test/"+fixtureToken)
			return resp, nil
		})
		w := request(b, "GET", "/api/v3/user", "", fixtureCapability)
		if w.Code != 502 || strings.Contains(w.Body.String(), fixtureToken) || w.Header().Get("Location") != "" {
			t.Fatal("redirect leaked")
		}
	}
	b.transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return nil, fmt.Errorf("transport error %s", fixtureToken)
	})
	if w := request(b, "GET", "/api/v3/user", "", fixtureCapability); w.Code != 502 || strings.Contains(w.Body.String(), fixtureToken) {
		t.Fatal("error leaked")
	}
	b.transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		resp := response(r, 200, strings.Repeat("x", 32767)+fixtureToken+"/"+base64.StdEncoding.EncodeToString([]byte("x-access-token:"+fixtureToken)))
		resp.Header.Set("X-Echo", fixtureToken)
		resp.Header.Set("WWW-Authenticate", fixtureToken)
		resp.Header.Set("Set-Cookie", fixtureToken)
		return resp, nil
	})
	w := request(b, "GET", "/api/v3/user", "", fixtureCapability)
	if strings.Contains(w.Body.String(), fixtureToken) || !strings.HasSuffix(w.Body.String(), "[redacted]/[redacted]") || w.Header().Get("X-Echo") != "[redacted]" || w.Header().Get("Set-Cookie") != "" {
		t.Fatal("upstream credential reflection leaked")
	}
	for _, form := range credentialForms(fixtureToken) {
		for size := 1; size < 80; size++ {
			body := newRedactedBody(io.NopCloser(strings.NewReader("prefix"+form+"suffix")), credentialForms(fixtureToken))
			var out strings.Builder
			buf := make([]byte, size)
			for {
				n, err := body.Read(buf)
				out.Write(buf[:n])
				if err != nil {
					break
				}
			}
			if out.String() != "prefix[redacted]suffix" {
				t.Fatalf("redaction chunk %d", size)
			}
		}
	}
}
