package settings

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
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
