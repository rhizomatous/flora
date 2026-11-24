package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	if err := service.Save(ctx, Input{Model: "new-model"}); err != nil {
		t.Fatal(err)
	}
}

func TestIndependentConnectionsSurviveRestartAndFailure(t *testing.T) {
	for _, githubFirst := range []bool{true, false} {
		t.Run(map[bool]string{true: "github-first", false: "model-first"}[githubFirst], func(t *testing.T) {
			ctx := context.Background()
			root := t.TempDir()
			store, err := storage.Open(ctx, root)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { store.Close() }()
			s := New(store)
			var checked []storage.Credentials
			s.Validate = func(_ context.Context, c storage.Credentials) error {
				checked = append(checked, c)
				if c.GitHubToken == "github_pat_rejected" || c.ProviderKey == "rejected-key" {
					return invalid("Credential rejected.")
				}
				return nil
			}
			p := storage.DefaultPreferences()
			p.AuthorName, p.MaxRunning = "Custom author", 7
			if err := s.Save(ctx, Input{Preferences: &p}); err != nil {
				t.Fatal(err)
			}
			github := Input{GitHubToken: "github_pat_saved"}
			model := Input{Provider: "openai", Model: "model-test", ProviderKey: "provider-saved"}
			first, second := model, github
			if githubFirst {
				first, second = github, model
			}
			view, err := s.SaveAndView(ctx, first)
			if err != nil {
				t.Fatal(err)
			}
			if view.GitHubConfigured != githubFirst || view.ProviderConfigured == githubFirst || len(view.Validation) != 1 || !view.Validation[0].OK {
				t.Fatalf("wrong first-save response: %+v", view)
			}
			if len(checked) != 1 || (checked[0].GitHubToken != "" && checked[0].ProviderKey != "") {
				t.Fatal("validated an unrelated connection")
			}
			store.Close()
			store, err = storage.Open(ctx, root)
			if err != nil {
				t.Fatal(err)
			}
			s.Store = store
			view, err = s.View(ctx)
			if err != nil || view.Preferences != p || view.GitHubConfigured != githubFirst || view.ProviderConfigured == githubFirst || len(view.Validation) != 0 {
				t.Fatalf("partial configuration lost on restart: %+v %v", view, err)
			}
			results := s.Diagnose(ctx)
			if results[len(results)-2].OK != githubFirst || results[len(results)-1].OK == githubFirst {
				t.Fatalf("partial diagnostics: %+v", results)
			}
			bad := Input{Provider: "openai", Model: "model-test", ProviderKey: "rejected-key"}
			if !githubFirst {
				bad = Input{GitHubToken: "github_pat_rejected"}
			}
			if err := s.Save(ctx, bad); err == nil {
				t.Fatal("failed connection was saved")
			}
			if err := s.Save(ctx, second); err != nil {
				t.Fatal(err)
			}
			before, err := store.Credentials(ctx)
			if err != nil {
				t.Fatal(err)
			}
			// An unavailable existing connection must not block rotating the other one.
			s.Validate = func(_ context.Context, c storage.Credentials) error {
				if c.ProviderKey != "" {
					return invalid("Model provider unavailable.")
				}
				return nil
			}
			if err := s.Save(ctx, Input{GitHubToken: "github_pat_rotated"}); err != nil {
				t.Fatal(err)
			}
			if err := s.Save(ctx, Input{ProviderKey: "rejected-key"}); err == nil {
				t.Fatal("failed replacement was saved")
			}
			after, err := store.Credentials(ctx)
			if err != nil || after.ProviderKey != before.ProviderKey || after.GitHubToken != "github_pat_rotated" {
				t.Fatal("failed replacement changed credentials", err)
			}
			results = s.Diagnose(ctx)
			if !results[len(results)-2].OK || results[len(results)-1].OK {
				t.Fatal("failed model check hid working GitHub", results)
			}
			s.Validate = func(_ context.Context, c storage.Credentials) error {
				if c.GitHubToken != "" {
					return errors.New("github_pat_rotated transport failure")
				}
				return nil
			}
			if err := s.Save(ctx, Input{ProviderKey: "provider-rotated"}); err != nil {
				t.Fatal(err)
			}
			if err := s.Save(ctx, Input{GitHubToken: "github_pat_rejected"}); err == nil || strings.Contains(err.Error(), "github_pat_") {
				t.Fatal("unsafe GitHub failure", err)
			}
			after, err = store.Credentials(ctx)
			if err != nil || after.ProviderKey != "provider-rotated" || after.GitHubToken != "github_pat_rotated" {
				t.Fatal("failed GitHub replacement changed credentials", err)
			}
			view, err = s.View(ctx)
			if err != nil || !view.GitHubConfigured || !view.ProviderConfigured || view.Preferences != p {
				t.Fatal("independent saves changed preferences", err)
			}
		})
	}
}

func TestRemoteValidationOnlyContactsSuppliedConnection(t *testing.T) {
	for _, c := range []storage.Credentials{
		{GitHubToken: "github_pat_fixture"},
		{Provider: "openai", Model: "model-test", ProviderKey: "provider-fixture"},
	} {
		calls := 0
		client := &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
			calls++
			if (r.URL.Host == "api.github.com") != (c.GitHubToken != "") {
				t.Fatal("contacted unrelated connection")
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("{}"))}, nil
		})}
		if err := validateRemote(context.Background(), c, client); err != nil || calls != 1 {
			t.Fatal("independent validation failed", err, calls)
		}
	}
}

func TestMultipleProviderDefaultsRetainKeysAndValidateEachModel(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := New(store)
	var validated []storage.Credentials
	service.Validate = func(_ context.Context, c storage.Credentials) error { validated = append(validated, c); return nil }
	for _, in := range []Input{
		{Provider: "anthropic", Model: "sonnet", ProviderKey: "anthropic-secret"},
		{GitHubToken: "github_pat_secret"},
		{Provider: "openai", Model: "gpt", ProviderKey: "openai-secret"},
		{Provider: "anthropic", Model: "haiku"},
	} {
		if err := service.Save(ctx, in); err != nil {
			t.Fatal(err)
		}
	}
	saved, err := store.Credentials(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Provider != "anthropic" || saved.Model != "haiku" || saved.ProviderKey != "anthropic-secret" || saved.GitHubToken != "github_pat_secret" {
		t.Fatal("default switch lost a connection")
	}
	if len(validated) != 4 || validated[3].Model != "haiku" || validated[3].ProviderKey != "anthropic-secret" || validated[3].GitHubToken != "" {
		t.Fatal("model was not independently validated")
	}
	view, err := service.View(ctx)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Providers) != 2 || strings.Contains(string(raw), "secret") {
		t.Fatal("provider view lost configuration or exposed credentials")
	}
}

func TestConnectionOnlyDiscoveryPreservesDefaultAndGitHub(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	initial := storage.Credentials{Provider: "anthropic", Model: "original", ProviderKey: "anthropic-secret", GitHubToken: "github_pat_secret"}
	if err := store.SaveCredentials(ctx, initial); err != nil {
		t.Fatal(err)
	}
	service := New(store)
	var checks []storage.Credentials
	service.Validate = func(_ context.Context, c storage.Credentials) error { checks = append(checks, c); return nil }
	service.DiscoverModel = func(_ context.Context, c storage.Credentials) (string, error) {
		if c.Provider != "openai" || c.Model != "" || c.GitHubToken != "" || c.ProviderKey != "openai-secret" {
			t.Fatal("discovery received unrelated credentials")
		}
		return "discovered-model", nil
	}
	makeDefault := false
	if err := service.Save(ctx, Input{Provider: "openai", ProviderKey: "openai-secret", MakeDefault: &makeDefault}); err != nil {
		t.Fatal(err)
	}
	saved, err := store.Credentials(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if saved != initial {
		t.Fatal("adding a connection changed the default", saved)
	}
	c, err := store.ProviderCredentials(ctx, storage.Execution{Provider: "openai"})
	if err != nil {
		t.Fatal(err)
	}
	if c.Model != "discovered-model" || c.ProviderKey != "openai-secret" {
		t.Fatal("discovered connection was not saved")
	}
	if len(checks) != 2 || checks[0].Model != "" || checks[1].Model != "discovered-model" {
		t.Fatal("connection and model access were not checked", checks)
	}
	if err := service.Save(ctx, Input{Provider: "anthropic", ProviderKey: "rotated-secret", Model: "validation-model", MakeDefault: &makeDefault}); err != nil {
		t.Fatal(err)
	}
	saved, err = store.Credentials(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Model != initial.Model || saved.ProviderKey != "rotated-secret" || saved.GitHubToken != initial.GitHubToken {
		t.Fatal("key rotation replaced the default or GitHub")
	}
}

func TestFirstConnectionDiscoversDefaultAndFailuresSaveNothing(t *testing.T) {
	for _, failure := range []bool{true, false} {
		t.Run(fmt.Sprint(failure), func(t *testing.T) {
			ctx := context.Background()
			store, err := storage.Open(ctx, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			defer store.Close()
			service := New(store)
			service.Validate = func(context.Context, storage.Credentials) error { return nil }
			service.DiscoverModel = func(context.Context, storage.Credentials) (string, error) {
				if failure {
					return "", errors.New("private transport details")
				}
				return "discovered", nil
			}
			makeDefault := false
			err = service.Save(ctx, Input{Provider: "google", ProviderKey: "google-secret", MakeDefault: &makeDefault})
			view, viewErr := service.View(ctx)
			if viewErr != nil {
				t.Fatal(viewErr)
			}
			if failure {
				if err == nil || strings.Contains(err.Error(), "private") || len(view.Providers) != 0 {
					t.Fatal("failed discovery saved configuration or leaked errors", err)
				}
				return
			}
			if err != nil || view.Provider != "google" || view.Model != "discovered" || !view.ProviderConfigured {
				t.Fatal("first connection did not establish a default", view, err)
			}
		})
	}
}

func TestAppConnectionSurvivesIndependentProviderAndPATSaves(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	app := storage.GitHubApp{ID: 12, Slug: "flora-fixture", PrivateKey: "fixture-host-key", InstallationID: 40, Account: "garden", Enabled: true}
	if err := store.SaveGitHubApp(ctx, app); err != nil {
		t.Fatal(err)
	}
	service := New(store)
	service.Validate = func(context.Context, storage.Credentials) error { return nil }
	for _, input := range []Input{
		{Provider: "openai", Model: "model-one", ProviderKey: "openai-fixture-key"},
		{GitHubToken: "github_pat_fixture"},
		{Provider: "google", Model: "model-two", ProviderKey: "google-fixture-key"},
		{Provider: "openai", Model: "model-three"},
	} {
		if err := service.Save(ctx, input); err != nil {
			t.Fatal(err)
		}
		saved, err := store.GitHubApp(ctx)
		if err != nil || saved != app {
			t.Fatal("connection save replaced App credentials", err)
		}
	}
	view, err := service.View(ctx)
	if err != nil || !view.GitHubConfigured || len(view.Providers) != 2 || view.Provider != "openai" || view.Model != "model-three" {
		t.Fatal(view, err)
	}
	credentials, err := store.Credentials(ctx)
	if err != nil || credentials.GitHubToken != "github_pat_fixture" || credentials.ProviderKey != "openai-fixture-key" {
		t.Fatal("independent credentials changed", err)
	}
}
