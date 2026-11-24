// Package githubapp keeps GitHub App credentials and installation tokens on the
// host. Browser responses contain only connection metadata and public manifests.
package githubapp

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"sync"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

var ErrSetup = errors.New("GitHub setup expired or belongs to another session. Resume Connect GitHub from installation settings.")
var ErrRemote = errors.New("GitHub connection unavailable. Check GitHub access and host networking, then retry.")
var slugPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$`)
var codePattern = regexp.MustCompile(`^[a-zA-Z0-9_\-]{1,200}$`)

type Service struct {
	Store    *storage.Store
	Client   *http.Client
	mu       sync.Mutex
	token    string
	expires  time.Time
	identity [32]byte
}

func New(store *storage.Store) *Service {
	return &Service{Store: store, Client: &http.Client{Timeout: 15 * time.Second}}
}

func (s *Service) call(ctx context.Context, method, path, token string, body, out any) error {
	var data []byte
	if body != nil {
		data, _ = json.Marshal(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, "https://api.github.com"+path, bytes.NewReader(data))
	if err != nil {
		return ErrRemote
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := *s.Client
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	res, err := client.Do(req)
	if err != nil {
		return ErrRemote
	}
	defer res.Body.Close()
	if res.StatusCode == 404 {
		return storage.ErrNotFound
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return ErrRemote
	}
	if out != nil && json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(out) != nil {
		return ErrRemote
	}
	return nil
}

func appJWT(app storage.GitHubApp, now time.Time) (string, error) {
	block, _ := pem.Decode([]byte(app.PrivateKey))
	if block == nil {
		return "", ErrRemote
	}
	key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		parsed, e := x509.ParsePKCS8PrivateKey(block.Bytes)
		if e != nil {
			return "", ErrRemote
		}
		var ok bool
		key, ok = parsed.(*rsa.PrivateKey)
		if !ok {
			return "", ErrRemote
		}
	}
	claims, _ := json.Marshal(map[string]any{"iat": now.Add(-time.Minute).Unix(), "exp": now.Add(9 * time.Minute).Unix(), "iss": strconv.FormatInt(app.ID, 10)})
	raw := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`)) + "." + base64.RawURLEncoding.EncodeToString(claims)
	digest := sha256.Sum256([]byte(raw))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		return "", ErrRemote
	}
	return raw + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

// Token chooses the active App installation or the saved PAT. Cached tokens are
// renewed before expiry; changing the installation or key invalidates the cache.
func (s *Service) Token(ctx context.Context) (string, error) {
	return s.TokenWithClient(ctx, s.Client)
}

// TokenWithClient uses the caller's host HTTP transport for token renewal.
func (s *Service) TokenWithClient(ctx context.Context, client *http.Client) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	app, err := s.Store.GitHubApp(ctx)
	if err != nil && !errors.Is(err, storage.ErrNotFound) {
		return "", err
	}
	if !app.Enabled {
		c, err := s.Store.Credentials(ctx)
		if err != nil {
			return "", err
		}
		if c.GitHubToken == "" {
			return "", storage.ErrNotFound
		}
		return c.GitHubToken, nil
	}
	if app.InstallationID <= 0 {
		return "", storage.ErrNotFound
	}
	identity := sha256.Sum256([]byte(fmt.Sprintf("%d:%d:%s", app.ID, app.InstallationID, app.PrivateKey)))
	if s.identity == identity && s.token != "" && time.Now().Add(time.Minute).Before(s.expires) {
		return s.token, nil
	}
	jwt, err := appJWT(app, time.Now())
	if err != nil {
		return "", err
	}
	var result struct {
		Token   string    `json:"token"`
		Expires time.Time `json:"expires_at"`
	}
	remote := &Service{Store: s.Store, Client: client}
	if err := remote.call(ctx, "POST", fmt.Sprintf("/app/installations/%d/access_tokens", app.InstallationID), jwt, struct{}{}, &result); err != nil {
		return "", err
	}
	if result.Token == "" || !result.Expires.After(time.Now().Add(time.Minute)) {
		return "", ErrRemote
	}
	s.identity, s.token, s.expires = identity, result.Token, result.Expires
	return s.token, nil
}

// Invalidate drops a rejected token without replaying an upstream write.
func (s *Service) Invalidate() { s.mu.Lock(); defer s.mu.Unlock(); s.token = "" }

type Start struct {
	URL      string `json:"url"`
	Manifest string `json:"manifest,omitempty"`
}

func (s *Service) Start(ctx context.Context, session, origin string) (Start, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	app, err := s.Store.GitHubApp(ctx)
	if err != nil && !errors.Is(err, storage.ErrNotFound) {
		return Start{}, err
	}
	state := rand.Text()
	kind := "install"
	if app.ID == 0 {
		kind = "manifest"
	}
	if err := s.Store.BeginGitHubSetup(ctx, state, session, kind, time.Now().Add(time.Hour)); err != nil {
		return Start{}, err
	}
	if app.ID != 0 {
		if !slugPattern.MatchString(app.Slug) {
			return Start{}, ErrRemote
		}
		return Start{URL: "https://github.com/apps/" + app.Slug + "/installations/new?state=" + url.QueryEscape(state)}, nil
	}
	manifest, _ := json.Marshal(map[string]any{
		"name": "Flora", "url": origin, "redirect_url": origin + "/github/callback",
		"setup_url": origin + "/github/callback", "setup_on_update": false,
		"public": true, "request_oauth_on_install": false,
		"hook_attributes":     map[string]any{"url": origin + "/github/events", "active": false},
		"default_permissions": map[string]string{"contents": "write", "pull_requests": "write", "issues": "write", "checks": "read", "actions": "read", "workflows": "write", "metadata": "read"},
	})
	return Start{URL: "https://github.com/settings/apps/new?state=" + url.QueryEscape(state), Manifest: string(manifest)}, nil
}

type Callback struct {
	State          string `json:"state"`
	Code           string `json:"code"`
	InstallationID int64  `json:"installationID"`
	Action         string `json:"action"`
}

// Complete exchanges manifest codes only after checking the initiating session.
// Installation IDs from redirects are verified with the saved app's signed JWT.
func (s *Service) Complete(ctx context.Context, session string, in Callback) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	kind := "install"
	if in.Code != "" {
		kind = "manifest"
	}
	at := time.Now()
	if err := s.Store.CheckGitHubSetup(ctx, in.State, session, kind, at); err != nil {
		return ErrSetup
	}
	if kind == "manifest" {
		if !codePattern.MatchString(in.Code) {
			return ErrSetup
		}
		var result struct {
			ID            int64  `json:"id"`
			Slug          string `json:"slug"`
			PEM           string `json:"pem"`
			ClientSecret  string `json:"client_secret"`
			WebhookSecret string `json:"webhook_secret"`
		}
		if err := s.call(ctx, "POST", "/app-manifests/"+url.PathEscape(in.Code)+"/conversions", "", nil, &result); err != nil {
			return ErrRemote
		}
		app := storage.GitHubApp{ID: result.ID, Slug: result.Slug, PrivateKey: result.PEM, ClientSecret: result.ClientSecret, WebhookSecret: result.WebhookSecret}
		if app.ID <= 0 || !slugPattern.MatchString(app.Slug) {
			return ErrRemote
		}
		if _, err := appJWT(app, time.Now()); err != nil {
			return err
		}
		return s.Store.FinishGitHubSetup(ctx, in.State, session, kind, app, at)
	}
	app, err := s.Store.GitHubApp(ctx)
	if err != nil {
		return err
	}
	if in.Action == "request" {
		app.Pending = true
	} else {
		if in.InstallationID <= 0 {
			return ErrSetup
		}
		installation, err := s.installation(ctx, app, in.InstallationID)
		if err != nil {
			return err
		}
		app.InstallationID, app.Account, app.Enabled, app.Pending = installation.ID, installation.Account.Login, true, false
	}
	s.token = ""
	return s.Store.FinishGitHubSetup(ctx, in.State, session, kind, app, at)
}

type Installation struct {
	ID      int64 `json:"id"`
	AppID   int64 `json:"app_id"`
	Account struct {
		Login string `json:"login"`
	} `json:"account"`
	SuspendedAt *time.Time `json:"suspended_at"`
}

func (s *Service) installation(ctx context.Context, app storage.GitHubApp, id int64) (Installation, error) {
	var installation Installation
	jwt, err := appJWT(app, time.Now())
	if err != nil {
		return installation, err
	}
	err = s.call(ctx, "GET", fmt.Sprintf("/app/installations/%d", id), jwt, nil, &installation)
	if err == nil && (installation.ID != id || installation.AppID != app.ID || installation.SuspendedAt != nil) {
		err = ErrRemote
	}
	return installation, err
}

type View struct {
	State          string         `json:"state"`
	Slug           string         `json:"slug"`
	Account        string         `json:"account"`
	InstallationID int64          `json:"installationID"`
	PAT            bool           `json:"pat"`
	Active         string         `json:"active"`
	Installations  []Installation `json:"installations"`
}

func (s *Service) View(ctx context.Context) (View, error) {
	view := View{State: "disconnected", Active: "none", Installations: []Installation{}}
	c, err := s.Store.Credentials(ctx)
	if err != nil && !errors.Is(err, storage.ErrNotFound) {
		return view, err
	}
	view.PAT = c.GitHubToken != ""
	if view.PAT {
		view.Active = "pat"
	}
	app, err := s.Store.GitHubApp(ctx)
	if errors.Is(err, storage.ErrNotFound) {
		return view, nil
	}
	if err != nil {
		return view, err
	}
	view.Slug, view.Account, view.InstallationID = app.Slug, app.Account, app.InstallationID
	view.State = "created"
	if app.Pending {
		view.State = "pending"
	}
	if app.Enabled {
		view.Active = "app"
		view.State = "connected"
	}
	jwt, err := appJWT(app, time.Now())
	if err == nil {
		// Fetch bounded pages from the fixed API host, never a response's Link URL.
		for page := 1; page <= 100; page++ {
			var rows []Installation
			err = s.call(ctx, "GET", fmt.Sprintf("/app/installations?per_page=100&page=%d", page), jwt, nil, &rows)
			if err != nil {
				break
			}
			for _, row := range rows {
				if row.AppID == app.ID {
					view.Installations = append(view.Installations, row)
				}
			}
			if len(rows) < 100 {
				break
			}
		}
	}
	if err != nil {
		view.State = "unavailable"
		return view, nil
	}
	if app.Enabled {
		view.State = "revoked"
		for _, row := range view.Installations {
			if row.ID == app.InstallationID {
				view.State = "connected"
				if row.SuspendedAt != nil {
					view.State = "suspended"
				}
			}
		}
	}
	return view, nil
}

// Select reuses an existing installation after approval or a canceled redirect.
// Its identity and suspension state are checked against GitHub before activation.
func (s *Service) Select(ctx context.Context, id int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	app, err := s.Store.GitHubApp(ctx)
	if err != nil {
		return err
	}
	installation, err := s.installation(ctx, app, id)
	if err != nil {
		return err
	}
	app.InstallationID, app.Account, app.Enabled, app.Pending = id, installation.Account.Login, true, false
	s.token = ""
	return s.Store.SaveGitHubApp(ctx, app)
}
func (s *Service) UsePAT(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, err := s.Store.Credentials(ctx)
	if err != nil || c.GitHubToken == "" {
		return storage.ErrNotFound
	}
	app, err := s.Store.GitHubApp(ctx)
	if errors.Is(err, storage.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	app.Enabled = false
	s.token = ""
	return s.Store.SaveGitHubApp(ctx, app)
}

type Repository struct {
	Name          string `json:"full_name"`
	URL           string `json:"html_url"`
	DefaultBranch string `json:"default_branch"`
}
type RepositoryPage struct {
	Repositories []Repository `json:"repositories"`
	NextPage     int          `json:"nextPage"`
}

func (s *Service) Repositories(ctx context.Context, page int) (RepositoryPage, error) {
	result := RepositoryPage{Repositories: []Repository{}}
	if page < 1 || page > 10000 {
		return result, ErrSetup
	}
	token, err := s.Token(ctx)
	if err != nil {
		return result, err
	}
	app, err := s.Store.GitHubApp(ctx)
	if err != nil && !errors.Is(err, storage.ErrNotFound) {
		return result, err
	}
	path := fmt.Sprintf("/user/repos?per_page=100&page=%d&sort=full_name", page)
	if app.Enabled {
		path = fmt.Sprintf("/installation/repositories?per_page=100&page=%d", page)
		err = s.call(ctx, "GET", path, token, nil, &result)
	} else {
		err = s.call(ctx, "GET", path, token, nil, &result.Repositories)
	}
	if len(result.Repositories) == 100 {
		result.NextPage = page + 1
	}
	return result, err
}
