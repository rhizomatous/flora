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
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

type Input struct {
	Provider    string `json:"provider"`
	Model       string `json:"model"`
	GitHubToken string `json:"githubToken"`
	ProviderKey string `json:"providerKey"`
}
type View struct {
	Provider           string `json:"provider"`
	Model              string `json:"model"`
	GitHubConfigured   bool   `json:"githubConfigured"`
	ProviderConfigured bool   `json:"providerConfigured"`
}
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }
func invalid(message string) error       { return &ValidationError{message} }

type Service struct {
	Store    *storage.Store
	Validate func(context.Context, storage.Credentials) error
}

func New(store *storage.Store) *Service { return &Service{Store: store, Validate: ValidateRemote} }

func (s *Service) View(ctx context.Context) (View, error) {
	c, err := s.Store.Credentials(ctx)
	if errors.Is(err, storage.ErrNotFound) {
		return View{}, nil
	}
	return View{c.Provider, c.Model, c.GitHubToken != "", c.ProviderKey != ""}, err
}

var modelID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$`)

// Save validates replacement keys before saving either one. Empty keys retain
// saved values; the first save requires both. Provider/model can only be set once.
func (s *Service) Save(ctx context.Context, in Input) error {
	old, err := s.Store.Credentials(ctx)
	if err != nil && !errors.Is(err, storage.ErrNotFound) {
		return err
	}
	if old.Provider != "" {
		if (in.Provider != "" && in.Provider != old.Provider) || (in.Model != "" && in.Model != old.Model) {
			return invalid("Provider and model are fixed for this installation.")
		}
		in.Provider, in.Model = old.Provider, old.Model
	}
	if in.Provider != "openai" && in.Provider != "anthropic" && in.Provider != "google" {
		return invalid("Choose OpenAI, Anthropic, or Google as the hosted provider.")
	}
	if !modelID.MatchString(in.Model) {
		return invalid("Enter a model ID from your hosted provider, without a URL or provider prefix.")
	}
	if in.GitHubToken == "" {
		in.GitHubToken = old.GitHubToken
	}
	if in.ProviderKey == "" {
		in.ProviderKey = old.ProviderKey
	}
	if !strings.HasPrefix(in.GitHubToken, "github_pat_") || !safeKey(in.GitHubToken) {
		return invalid("Enter a fine-grained GitHub personal access token restricted to your selected repositories.")
	}
	if !safeKey(in.ProviderKey) {
		return invalid("Enter a model-provider API key without spaces or line breaks.")
	}
	c := storage.Credentials{Provider: in.Provider, Model: in.Model, GitHubToken: in.GitHubToken, ProviderKey: in.ProviderKey}
	if err := s.Validate(ctx, c); err != nil {
		return err
	}
	if err := s.Store.SaveCredentials(ctx, c); errors.Is(err, storage.ErrConflict) {
		return invalid("Provider and model are already fixed for this installation.")
	} else {
		return err
	}
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
		case res.StatusCode < 200 || res.StatusCode >= 300:
			return invalid(fmt.Sprintf("%s validation is unavailable (HTTP %d). Try again later.", label, res.StatusCode))
		}
		return nil
	}
	if err := check("https://api.github.com/user", "GitHub", map[string]string{"Authorization": "Bearer " + c.GitHubToken, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}); err != nil {
		return err
	}
	model := url.PathEscape(c.Model)
	switch c.Provider {
	case "openai":
		return check("https://api.openai.com/v1/models/"+model, "OpenAI", map[string]string{"Authorization": "Bearer " + c.ProviderKey})
	case "anthropic":
		return check("https://api.anthropic.com/v1/models/"+model, "Anthropic", map[string]string{"x-api-key": c.ProviderKey, "anthropic-version": "2023-06-01"})
	case "google":
		return check("https://generativelanguage.googleapis.com/v1beta/models/"+model, "Google", map[string]string{"x-goog-api-key": c.ProviderKey})
	}
	return invalid("Unsupported hosted provider.")
}
