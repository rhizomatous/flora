package githubapp

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func reply(code int, value any) *http.Response {
	raw, _ := json.Marshal(value)
	return &http.Response{StatusCode: code, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(string(raw)))}
}
func fixture(t *testing.T) (*Service, storage.GitHubApp) {
	t.Helper()
	store, err := storage.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	app := storage.GitHubApp{ID: 12, Slug: "flora-fixture", PrivateKey: string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})), ClientSecret: "client-fixture-secret", WebhookSecret: "webhook-fixture-secret"}
	return New(store), app
}
func require(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func setupState(t *testing.T, start Start) string {
	t.Helper()
	u, err := url.Parse(start.URL)
	require(t, err)
	return u.Query().Get("state")
}

func TestManifestBindingAndResumption(t *testing.T) {
	ctx := context.Background()
	s, app := fixture(t)
	require(t, s.Store.SaveCredentials(ctx, storage.Credentials{GitHubToken: "github_pat_fixture"}))
	calls := 0
	s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host != "api.github.com" || r.Method != "POST" || r.URL.Path != "/app-manifests/fixture-code/conversions" || r.Header.Get("Authorization") != "" {
			t.Fatalf("unexpected conversion %s", r.URL)
		}
		return reply(201, map[string]any{"id": app.ID, "slug": app.Slug, "pem": app.PrivateKey, "client_secret": app.ClientSecret, "webhook_secret": app.WebhookSecret}), nil
	})
	start, err := s.Start(ctx, "admin-session", "https://flora.test")
	require(t, err)
	var manifest map[string]any
	require(t, json.Unmarshal([]byte(start.Manifest), &manifest))
	if manifest["redirect_url"] != "https://flora.test/github/callback" || manifest["setup_url"] != "https://flora.test/github/callback" || manifest["request_oauth_on_install"] != false || manifest["hook_attributes"].(map[string]any)["active"] != false {
		t.Fatal(manifest)
	}
	// Commit status summaries and check runs require separate GitHub permissions.
	permissions := manifest["default_permissions"].(map[string]any)
	if permissions["statuses"] != "read" || permissions["checks"] != "read" || permissions["contents"] != "write" || permissions["workflows"] != "write" {
		t.Fatal("manifest cannot read checks or push workflow changes", permissions)
	}
	for _, secret := range []string{app.PrivateKey, app.ClientSecret, app.WebhookSecret, "github_pat_fixture"} {
		if strings.Contains(start.Manifest, secret) {
			t.Fatal("manifest exposes credential")
		}
	}
	in := Callback{State: setupState(t, start), Code: "fixture-code"}
	if !errors.Is(s.Complete(ctx, "another-session", in), ErrSetup) || calls != 0 {
		t.Fatal("callback not bound to session")
	}
	require(t, s.Complete(ctx, "admin-session", in))
	if !errors.Is(s.Complete(ctx, "admin-session", in), ErrSetup) || calls != 1 {
		t.Fatal("callback replay accepted")
	}
	saved, err := s.Store.GitHubApp(ctx)
	require(t, err)
	if saved.PrivateKey != app.PrivateKey || saved.Enabled {
		t.Fatal("partial app not retained")
	}
	if _, err := s.Token(ctx); !errors.Is(err, storage.ErrNotFound) {
		t.Fatal("unfinished app allowed repository access", err)
	}
	// A new browser session can resume the saved app without another conversion.
	resume, err := s.Start(ctx, "new-session", "https://flora.test")
	require(t, err)
	if resume.Manifest != "" || !strings.Contains(resume.URL, "/apps/flora-fixture/installations/new?state=") || calls != 1 {
		t.Fatal(resume)
	}
	require(t, s.Store.BeginGitHubSetup(ctx, "expired", "new-session", "install", time.Now().Add(-time.Second)))
	if !errors.Is(s.Complete(ctx, "new-session", Callback{State: "expired", InstallationID: 40}), ErrSetup) || calls != 1 {
		t.Fatal("expired setup reached GitHub")
	}
}

func TestInstallationApprovalAndRecovery(t *testing.T) {
	ctx := context.Background()
	s, app := fixture(t)
	require(t, s.Store.SaveGitHubApp(ctx, app))
	suspended := false
	wrongApp := false
	revoked := false
	s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ey") {
			t.Fatal("missing app JWT")
		}
		id := app.ID
		if wrongApp {
			id++
		}
		row := map[string]any{"id": 40, "app_id": id, "account": map[string]string{"login": "garden-org"}, "suspended_at": nil}
		if suspended {
			row["suspended_at"] = time.Now().UTC()
		}
		if strings.HasPrefix(r.URL.Path, "/app/installations/") {
			return reply(200, row), nil
		}
		if revoked {
			return reply(200, []any{}), nil
		}
		return reply(200, []any{row}), nil
	})
	start, err := s.Start(ctx, "admin", "https://flora.test")
	require(t, err)
	require(t, s.Complete(ctx, "admin", Callback{State: setupState(t, start), Action: "request"}))
	saved, err := s.Store.GitHubApp(ctx)
	require(t, err)
	if !saved.Pending || saved.Enabled {
		t.Fatal(saved)
	}
	view, err := s.View(ctx)
	require(t, err)
	if view.State != "pending" || len(view.Installations) != 1 {
		t.Fatal(view)
	}
	wrongApp = true
	if s.Select(ctx, 40) == nil {
		t.Fatal("another app accepted")
	}
	wrongApp = false
	suspended = true
	if s.Select(ctx, 40) == nil {
		t.Fatal("suspended installation accepted")
	}
	suspended = false
	require(t, s.Select(ctx, 40))
	view, err = s.View(ctx)
	require(t, err)
	if view.State != "connected" || view.Account != "garden-org" || view.Active != "app" {
		t.Fatal(view)
	}
	suspended = true
	view, err = s.View(ctx)
	require(t, err)
	if view.State != "suspended" {
		t.Fatal(view)
	}
	revoked = true
	view, err = s.View(ctx)
	require(t, err)
	if view.State != "revoked" {
		t.Fatal(view)
	}
}

func TestTokenRenewalAndInstallationChanges(t *testing.T) {
	ctx := context.Background()
	s, app := fixture(t)
	app.Enabled = true
	app.InstallationID = 40
	require(t, s.Store.SaveGitHubApp(ctx, app))
	count := 0
	s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		count++
		if r.Method != "POST" || r.URL.Path != "/app/installations/40/access_tokens" {
			t.Fatal(r.URL)
		}
		return reply(201, map[string]any{"token": "ghs_fixture_token", "expires_at": time.Now().Add(time.Hour)}), nil
	})
	var wg sync.WaitGroup
	for range 12 {
		wg.Go(func() {
			token, err := s.Token(ctx)
			if err != nil || token != "ghs_fixture_token" {
				t.Error("token unavailable", err)
			}
		})
	}
	wg.Wait()
	if count != 1 {
		t.Fatal("parallel refreshes", count)
	}
	s.expires = time.Now().Add(30 * time.Second)
	_, err := s.Token(ctx)
	require(t, err)
	if count != 2 {
		t.Fatal("did not renew before expiry")
	}
	s.Invalidate()
	_, err = s.Token(ctx)
	require(t, err)
	if count != 3 {
		t.Fatal("did not renew rejected token")
	}
	app.InstallationID = 41
	require(t, s.Store.SaveGitHubApp(ctx, app))
	s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		count++
		if r.URL.Path != "/app/installations/41/access_tokens" {
			t.Fatal("old installation cached", r.URL)
		}
		return reply(201, map[string]any{"token": "ghs_new_installation", "expires_at": time.Now().Add(time.Hour)}), nil
	})
	token, err := s.Token(ctx)
	require(t, err)
	if token != "ghs_new_installation" || count != 4 {
		t.Fatal("installation change did not renew token")
	}

}

func TestRepositoriesAndPrivateFailures(t *testing.T) {
	ctx := context.Background()
	s, app := fixture(t)
	require(t, s.Store.SaveCredentials(ctx, storage.Credentials{GitHubToken: "github_pat_fixture"}))
	app.Enabled = true
	app.InstallationID = 40
	require(t, s.Store.SaveGitHubApp(ctx, app))
	paths := []string{}
	s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		paths = append(paths, r.URL.Path)
		if strings.HasSuffix(r.URL.Path, "/access_tokens") {
			return reply(201, map[string]any{"token": "ghs_fixture", "expires_at": time.Now().Add(time.Hour)}), nil
		}
		if r.URL.Path != "/installation/repositories" || r.URL.Query().Get("page") != "2" || r.Header.Get("Authorization") != "Bearer ghs_fixture" {
			t.Fatal(r.URL)
		}
		return reply(200, map[string]any{"repositories": []Repository{{Name: "garden/flora", URL: "https://github.com/garden/flora", DefaultBranch: "main"}}}), nil
	})
	page, err := s.Repositories(ctx, 2)
	require(t, err)
	if len(page.Repositories) != 1 || page.Repositories[0].Name != "garden/flora" || len(paths) != 2 {
		t.Fatal(page)
	}
	s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		return reply(403, "ghs_fixture private_key_secret"), nil
	})
	if _, err := s.Repositories(ctx, 1); err != ErrRemote {
		t.Fatal("raw remote error", err)
	}
	s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://evil.test/"}}, Body: io.NopCloser(strings.NewReader(""))}, nil
	})
	if _, err := s.Repositories(ctx, 1); err != ErrRemote {
		t.Fatal("redirect accepted", err)
	}
}

func TestDisconnectRetainsAppAndRejectsLateCallbacks(t *testing.T) {
	ctx := context.Background()
	s, app := fixture(t)
	app.Enabled = true
	app.InstallationID = 40
	app.Account = "garden"
	require(t, s.Store.SaveGitHubApp(ctx, app))
	require(t, s.Store.SaveCredentials(ctx, storage.Credentials{GitHubToken: "github_pat_unused_fixture"}))
	s.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		return reply(201, map[string]any{"token": "ghs_fixture_token", "expires_at": time.Now().Add(time.Hour)}), nil
	})
	_, err := s.Token(ctx)
	require(t, err)
	start, err := s.Start(ctx, "admin", "https://flora.test")
	require(t, err)
	require(t, s.Disconnect(ctx))
	configured, err := s.Store.GitHubConfigured(ctx)
	require(t, err)
	if configured {
		t.Fatal("disconnected App reports repository access")
	}
	if _, err := s.Token(ctx); !errors.Is(err, storage.ErrNotFound) {
		t.Fatal("disconnected App reused a credential", err)
	}
	if err := s.Complete(ctx, "admin", Callback{State: setupState(t, start), InstallationID: 40}); !errors.Is(err, ErrSetup) {
		t.Fatal("late callback restored access", err)
	}
	saved, err := s.Store.GitHubApp(ctx)
	require(t, err)
	if saved.PrivateKey != app.PrivateKey || saved.ID != app.ID || saved.Slug != app.Slug || saved.InstallationID != 0 || saved.Enabled {
		t.Fatal("App registration was lost or access retained")
	}
	next, err := s.Start(ctx, "admin", "https://flora.test")
	require(t, err)
	if next.Manifest != "" || !strings.Contains(next.URL, "/apps/flora-fixture/installations/new") {
		t.Fatal("reconnect created a second App")
	}
}
