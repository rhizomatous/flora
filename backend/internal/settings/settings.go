// Package settings validates installation credentials without returning secrets.
package settings

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/rhizomatous/flora/backend/internal/githubapp"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

type Input struct {
	// MakeDefault=false saves only the connection. The first connection also
	// establishes a default. An omitted model is discovered for a new connection.
	MakeDefault *bool `json:"makeDefault,omitempty"`
	// Preferences, when present, replaces the complete non-secret record.
	// Omission preserves it. Blank credential fields preserve saved values.
	Preferences *storage.Preferences `json:"preferences,omitempty"`
	Provider    string               `json:"provider"`
	Model       string               `json:"model"`
	GitHubToken string               `json:"githubToken"`
	ProviderKey string               `json:"providerKey"`
}
type ProviderView struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
}
type View struct {
	Providers []ProviderView `json:"providers"`
	// Validation contains metadata checks performed by this save, never runtime readiness.
	Validation         []Diagnostic        `json:"validation,omitempty"`
	Preferences        storage.Preferences `json:"preferences"`
	MaxRunningOverride int                 `json:"maxRunningOverride,omitempty"`
	Provider           string              `json:"provider"`
	Model              string              `json:"model"`
	GitHubConfigured   bool                `json:"githubConfigured"`
	ProviderConfigured bool                `json:"providerConfigured"`
}
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }
func invalid(message string) error       { return &ValidationError{message} }

type Service struct {
	DiscoverModel      func(context.Context, storage.Credentials) (string, error)
	GitHub             *githubapp.Service
	RuntimeDiagnostics func(context.Context) []Diagnostic
	mu                 sync.Mutex
	MaxRunningOverride int
	Store              *storage.Store
	Validate           func(context.Context, storage.Credentials) error
}

type Diagnostic struct {
	Name    string `json:"name"`
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

// Diagnose checks only metadata endpoints, never generates model responses or
// starts containers. Transport errors and vendor response bodies stay private.
func (s *Service) Diagnose(ctx context.Context) []Diagnostic {
	result := []Diagnostic{{"Storage", true, "Storage is writable."}}
	if err := s.Store.CheckWritable(ctx); err != nil {
		result[0] = Diagnostic{"Storage", false, "Storage is unavailable or unwritable. Check data directory ownership, permissions and free space."}
	}
	if s.RuntimeDiagnostics != nil {
		result = append(result, s.RuntimeDiagnostics(ctx)...)
	} else {
		result = append(result, Diagnostic{"Runtime", false, "Chat execution is not configured. Set the pinned agent image and private GitHub transport startup options."})
	}
	c, err := s.Store.Credentials(ctx)
	if err != nil && !errors.Is(err, storage.ErrNotFound) {
		return append(result, Diagnostic{"Credentials", false, "Credential storage is unavailable. Restore the credential encryption key and database."})
	}
	app, appErr := s.Store.GitHubApp(ctx)
	if appErr != nil && !errors.Is(appErr, storage.ErrNotFound) {
		result = append(result, Diagnostic{"GitHub", false, "GitHub credential storage is unavailable."})
	} else if app.Enabled {
		d := Diagnostic{"GitHub", true, "GitHub installation repositories are accessible."}
		if _, err := s.GitHub.Repositories(ctx, 1); err != nil {
			d.OK = false
			d.Message = "GitHub access is unavailable. Check the installation and selected repositories in installation settings."
		}
		result = append(result, d)
	}
	for _, connection := range []struct {
		name        string
		credentials storage.Credentials
		configured  bool
	}{
		{"GitHub", storage.Credentials{GitHubToken: c.GitHubToken}, c.GitHubToken != ""},
		{"Model provider", storage.Credentials{Provider: c.Provider, Model: c.Model, ProviderKey: c.ProviderKey}, c.ProviderKey != ""},
	} {
		if connection.name == "GitHub" && (app.Enabled || (appErr != nil && !errors.Is(appErr, storage.ErrNotFound))) {
			continue
		}
		d := Diagnostic{connection.name, false, "Configure " + connection.name + " in installation settings."}
		if connection.configured {
			d = s.validate(ctx, connection.name, connection.credentials)
		}
		result = append(result, d)
	}
	return result
}

func New(store *storage.Store) *Service {
	return &Service{Store: store, Validate: ValidateRemote, GitHub: githubapp.New(store)}
}

func (s *Service) View(ctx context.Context) (View, error) {
	p, err := s.Store.Preferences(ctx)
	if err != nil {
		return View{}, err
	}
	c, err := s.Store.Credentials(ctx)
	if errors.Is(err, storage.ErrNotFound) {
		err = nil
	}
	providers, providerErr := s.Store.Providers(ctx)
	if providerErr != nil {
		return View{}, providerErr
	}
	available := []ProviderView{}
	for _, p := range providers {
		available = append(available, ProviderView{p.Provider, p.Model})
	}
	configured, connectionErr := s.Store.GitHubConfigured(ctx)
	if err == nil {
		err = connectionErr
	}
	return View{Providers: available, Provider: c.Provider, Model: c.Model, GitHubConfigured: configured, ProviderConfigured: c.ProviderKey != "", Preferences: p, MaxRunningOverride: s.MaxRunningOverride}, err
}

var modelID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$`)

// Save validates only supplied connections. Blank fields retain saved values;
// omitted preferences are preserved. A failed request replaces no saved values.
func (s *Service) Save(ctx context.Context, in Input) error {
	_, err := s.SaveAndView(ctx, in)
	return err
}

// SaveAndView returns saved configuration and the metadata checks from this
// request. Reads omit validation because saved keys do not prove current access.
func (s *Service) SaveAndView(ctx context.Context, in Input) (View, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	checks, err := s.save(ctx, in)
	if err != nil {
		return View{}, err
	}
	view, err := s.View(ctx)
	view.Validation = checks
	return view, err
}

func (s *Service) validate(ctx context.Context, name string, c storage.Credentials) Diagnostic {
	d := Diagnostic{name, true, "Credential metadata is accessible. Runtime readiness has not been checked."}
	if err := s.Validate(ctx, c); err != nil {
		d.OK = false
		d.Message = name + " validation failed. Check the connection and host networking."
		var validation *ValidationError
		if errors.As(err, &validation) {
			d.Message = name + ": " + validation.Message
		}
	}
	return d
}

func (s *Service) save(ctx context.Context, in Input) ([]Diagnostic, error) {
	connectionOnly := in.MakeDefault != nil && !*in.MakeDefault
	if connectionOnly && (in.GitHubToken != "" || in.Preferences != nil || in.Provider == "") {
		return nil, invalid("Save each connection separately.")
	}
	if in.Preferences != nil {
		if err := in.Preferences.Validate(); err != nil {
			return nil, invalid(err.Error())
		}
	}
	old, err := s.Store.Credentials(ctx)
	if err != nil && !errors.Is(err, storage.ErrNotFound) {
		return nil, err
	}
	c := old
	modelInput := in.Provider != "" || in.Model != "" || in.ProviderKey != ""
	if modelInput {
		if in.Provider != "" && in.Provider != old.Provider {
			prior, err := s.Store.ProviderCredentials(ctx, storage.Execution{Provider: in.Provider})
			if err != nil && !errors.Is(err, storage.ErrNotFound) {
				return nil, err
			}
			c.Provider, c.Model, c.ProviderKey = in.Provider, prior.Model, prior.ProviderKey
		}
		if in.Model != "" {
			c.Model = in.Model
		}
		if c.Provider != "openai" && c.Provider != "anthropic" && c.Provider != "google" {
			return nil, invalid("Choose OpenAI, Anthropic, or Google as the hosted provider.")
		}
		if c.Model != "" && !modelID.MatchString(c.Model) || c.Model == "" && !connectionOnly {
			return nil, invalid("Enter a model ID from your hosted provider, without a URL or provider prefix.")
		}
		if in.ProviderKey != "" {
			c.ProviderKey = in.ProviderKey
		}
		if !safeKey(c.ProviderKey) {
			return nil, invalid("Enter a model-provider API key without spaces or line breaks.")
		}
	}
	if connectionOnly && c.Model == "" {
		check := s.validate(ctx, "Model provider", storage.Credentials{Provider: c.Provider, ProviderKey: c.ProviderKey})
		if !check.OK {
			return nil, invalid(check.Message)
		}
		if s.DiscoverModel == nil {
			return nil, invalid("Model discovery is unavailable. Check the agent runtime in Settings and retry.")
		}
		model, err := s.DiscoverModel(ctx, storage.Credentials{Provider: c.Provider, ProviderKey: c.ProviderKey})
		if err != nil || !modelID.MatchString(model) {
			return nil, invalid("Could not discover models. Check the provider connection and agent runtime, then retry.")
		}
		c.Model = model
	}
	if in.GitHubToken != "" {
		if !strings.HasPrefix(in.GitHubToken, "github_pat_") || !safeKey(in.GitHubToken) {
			return nil, invalid("Enter a fine-grained GitHub personal access token restricted to your selected repositories.")
		}
		c.GitHubToken = in.GitHubToken
	}
	var checks []Diagnostic
	if in.GitHubToken != "" {
		checks = append(checks, s.validate(ctx, "GitHub", storage.Credentials{GitHubToken: c.GitHubToken}))
	}
	if modelInput {
		checks = append(checks, s.validate(ctx, "Model provider", storage.Credentials{Provider: c.Provider, Model: c.Model, ProviderKey: c.ProviderKey}))
	}
	for _, check := range checks {
		if !check.OK {
			return nil, invalid(check.Message)
		}
	}
	if c == (storage.Credentials{}) {
		if in.Preferences == nil {
			return nil, invalid("Enter a model-provider connection or GitHub token to save.")
		}
		return checks, s.Store.SavePreferences(ctx, *in.Preferences)
	}
	if connectionOnly {
		return checks, s.Store.SaveModelConnection(ctx, c)
	}
	return checks, s.Store.SaveInstallation(ctx, c, in.Preferences)
}

func safeKey(key string) bool {
	if len(key) < 8 || len(key) > 4096 {
		return false
	}
	for _, r := range key {
		if r < 33 || r > 126 {
			return false
		}
	}
	return true
}

// ValidateRemote contacts only fixed vendor endpoints. Neither response bodies
// nor transport errors are exposed because they may contain credential values.
func ValidateRemote(ctx context.Context, c storage.Credentials) error {
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return validateRemote(ctx, c, client)
}

func validateRemote(ctx context.Context, c storage.Credentials, client *http.Client) error {
	check := func(endpoint, label string, headers map[string]string) error {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return invalid("Unable to prepare credential validation.")
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		res, err := client.Do(req)
		if err != nil {
			return invalid(fmt.Sprintf("Cannot reach %s. Check the host network and try again.", label))
		}
		defer res.Body.Close()
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
		switch {
		case res.StatusCode == 401 || res.StatusCode == 403:
			return invalid(fmt.Sprintf("%s rejected the credential. Check its value, expiry, and permissions.", label))
		case res.StatusCode == 404:
			if label == "GitHub" {
				return invalid("GitHub account validation failed. Check the token and account access.")
			}
			return invalid(fmt.Sprintf("%s could not find this model. Check the model ID and account access.", label))
		case res.StatusCode == 429:
			return invalid(fmt.Sprintf("%s quota or rate limit reached. Check account billing and limits, then retry.", label))
		case res.StatusCode < 200 || res.StatusCode >= 300:
			return invalid(fmt.Sprintf("%s validation is unavailable (HTTP %d). Try again later.", label, res.StatusCode))
		}
		return nil
	}
	if c.GitHubToken != "" {
		if err := check("https://api.github.com/user", "GitHub", map[string]string{"Authorization": "Bearer " + c.GitHubToken, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}); err != nil {
			return err
		}
	}
	if c.ProviderKey == "" {
		return nil
	}
	model := ""
	if c.Model != "" {
		model = "/" + url.PathEscape(c.Model)
	}
	switch c.Provider {
	case "openai":
		return check("https://api.openai.com/v1/models"+model, "OpenAI", map[string]string{"Authorization": "Bearer " + c.ProviderKey})
	case "anthropic":
		return check("https://api.anthropic.com/v1/models"+model, "Anthropic", map[string]string{"x-api-key": c.ProviderKey, "anthropic-version": "2023-06-01"})
	case "google":
		return check("https://generativelanguage.googleapis.com/v1beta/models"+model, "Google", map[string]string{"x-goog-api-key": c.ProviderKey})
	}
	return invalid("Unsupported hosted provider.")
}
