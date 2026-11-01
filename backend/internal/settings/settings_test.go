package settings

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestVendorValidation(t *testing.T) {
	for _, tc := range []struct{ provider, host, header, value string }{
		{"openai", "api.openai.com", "Authorization", "Bearer provider-secret"},
		{"anthropic", "api.anthropic.com", "x-api-key", "provider-secret"},
		{"google", "generativelanguage.googleapis.com", "x-goog-api-key", "provider-secret"},
	} {
		t.Run(tc.provider, func(t *testing.T) {
			calls := 0
			client := &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.URL.Scheme != "https" || r.URL.RawQuery != "" {
					t.Fatal("unsafe credential URL")
				}
				if calls == 1 {
					if r.URL.Host != "api.github.com" || r.URL.Path != "/user" || r.Header.Get("Authorization") != "Bearer github_pat_secret" {
						t.Fatal("bad GitHub request")
					}
				} else if r.URL.Host != tc.host || !strings.HasSuffix(r.URL.Path, "/model-test") || r.Header.Get(tc.header) != tc.value {
					t.Fatal("bad model request")
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("{}")), Header: make(http.Header)}, nil
			})}
			c := storage.Credentials{Provider: tc.provider, Model: "model-test", GitHubToken: "github_pat_secret", ProviderKey: "provider-secret"}
			if err := validateRemote(context.Background(), c, client); err != nil {
				t.Fatal(err)
			}
			if calls != 2 {
				t.Fatalf("requests=%d", calls)
			}
		})
	}
}

func TestConcurrentRotationAndLimitsPreserveBlankSecrets(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	initial := storage.Credentials{Provider: "openai", Model: "model", GitHubToken: "github_pat_fixture", ProviderKey: "provider-fixture"}
	if err := store.SaveCredentials(ctx, initial); err != nil {
		t.Fatal(err)
	}
	s := New(store)
	entered, release := make(chan struct{}), make(chan struct{})
	s.Validate = func(context.Context, storage.Credentials) error { close(entered); <-release; return nil }
	var wg sync.WaitGroup
	wg.Add(2)
	results := make(chan error, 2)
	go func() { defer wg.Done(); results <- s.Save(ctx, Input{ProviderKey: "rotated-fixture"}) }()
	<-entered
	p := storage.DefaultPreferences()
	p.MaxRunning = 3
	go func() { defer wg.Done(); results <- s.Save(ctx, Input{Preferences: &p}) }()
	close(release)
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	c, err := store.Credentials(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if c.ProviderKey != "rotated-fixture" || c.GitHubToken != initial.GitHubToken || c.Model != initial.Model {
		t.Fatal("concurrent blank update reverted credentials")
	}
	view, err := s.View(ctx)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	if view.Preferences.MaxRunning != 3 || strings.Contains(string(raw), "fixture") {
		t.Fatal("view lost settings or exposed credentials")
	}
}

func TestDiagnosticsRedactTransportAndVendorBodies(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	c := storage.Credentials{Provider: "openai", Model: "model", GitHubToken: "github_pat_fixture", ProviderKey: "provider-fixture"}
	if err := store.SaveCredentials(ctx, c); err != nil {
		t.Fatal(err)
	}
	s := New(store)
	for _, code := range []int{0, 401, 403, 404, 429, 500} {
		t.Run(http.StatusText(code), func(t *testing.T) {
			s.Validate = func(ctx context.Context, c storage.Credentials) error {
				return validateRemote(ctx, c, &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) {
					if code == 0 {
						return nil, errors.New(c.GitHubToken + " " + c.ProviderKey)
					}
					return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(c.GitHubToken + " " + c.ProviderKey))}, nil
				})})
			}
			results := s.Diagnose(ctx)
			raw, err := json.Marshal(results)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(raw), "fixture") || results[len(results)-1].OK || results[len(results)-1].Message == "" {
				t.Fatal("unsafe or unhelpful diagnostics")
			}
		})
	}
}

func TestValidationDoesNotExposeVendorErrors(t *testing.T) {
	c := storage.Credentials{Provider: "openai", Model: "model-test", GitHubToken: "github_pat_secret", ProviderKey: "provider-secret"}
	for _, status := range []int{401, 403, 404, 429, 500, 302, 0} {
		client := &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
			if status == 0 {
				return nil, errors.New("provider-secret github_pat_secret")
			}
			return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("provider-secret github_pat_secret"))}, nil
		})}
		err := validateRemote(context.Background(), c, client)
		if err == nil || strings.Contains(err.Error(), "secret") {
			t.Fatalf("unsafe error: %v", err)
		}
	}
}

func TestSettingsValidationAndAtomicRotation(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := New(store)
	calls := 0
	service.Validate = func(context.Context, storage.Credentials) error { calls++; return nil }
	initial := Input{Provider: "openai", Model: "gpt-test", GitHubToken: "github_pat_initial", ProviderKey: "initial-provider"}
	for _, bad := range []Input{
		{}, {Provider: "local", Model: "gpt", GitHubToken: "github_pat_initial", ProviderKey: "initial-provider"},
		{Provider: "openai", Model: "https://evil.test", GitHubToken: "github_pat_initial", ProviderKey: "initial-provider"},
		{Provider: "openai", Model: "gpt", GitHubToken: "classic-token", ProviderKey: "initial-provider"},
		{Provider: "openai", Model: "gpt", GitHubToken: "github_pat_initial", ProviderKey: "key\r\nsecret"},
	} {
		if err := service.Save(ctx, bad); err == nil {
			t.Fatal("invalid settings saved")
		}
	}
	if calls != 0 {
		t.Fatal("invalid inputs reached vendor")
	}
	if err := service.Save(ctx, initial); err != nil {
		t.Fatal(err)
	}
	service.Validate = func(context.Context, storage.Credentials) error { return invalid("Provider rejected key.") }
	if err := service.Save(ctx, Input{GitHubToken: "github_pat_replacement", ProviderKey: "replacement-provider"}); err == nil {
		t.Fatal("failed validation saved")
	}
	saved, err := store.Credentials(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if saved.GitHubToken != initial.GitHubToken || saved.ProviderKey != initial.ProviderKey {
		t.Fatal("partial credentials update")
	}
	service.Validate = func(context.Context, storage.Credentials) error { return nil }
	if err := service.Save(ctx, Input{ProviderKey: "replacement-provider"}); err != nil {
		t.Fatal(err)
	}
	saved, err = store.Credentials(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if saved.GitHubToken != initial.GitHubToken || saved.ProviderKey != "replacement-provider" {
		t.Fatal("blank key did not retain saved credential")
	}
	if err := service.Save(ctx, Input{Model: "new-model"}); err == nil {
		t.Fatal("model switched")
	}
}
