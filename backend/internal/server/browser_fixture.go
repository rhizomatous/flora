//go:build browserfixture

package server

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/projects"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/testfixture"
	"github.com/rhizomatous/flora/backend/internal/webassets"
)

// BrowserInstance owns one isolated app server and its temporary data.
type BrowserInstance struct {
	URL         string `json:"url"`
	ChatID      string `json:"chatID"`
	OtherChatID string `json:"otherChatID"`
	Close       func() `json:"-"`
}

type browserTransport func(*http.Request) (*http.Response, error)

func (f browserTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// NewBrowserInstance starts one scenario. The caller must close it after the test.
// This code is compiled only into the fixture executable.
func NewBrowserInstance(scenario string) (_ *BrowserInstance, err error) {
	environmentPreview := scenario == "environment"
	if environmentPreview {
		scenario = "branches"
	}
	if scenario == "shells" {
		return newShellBrowserInstance()
	}
	switch scenario {
	case "mcps", "compaction", "model-summary", "models", "chat", "changes", "enrollment", "credential-setup", "passkeys", "notifications", "projects", "settings", "workspace", "branches", "context":
	default:
		return nil, fmt.Errorf("unknown browser scenario %q", scenario)
	}
	directory, err := os.MkdirTemp("", "flora-browser-")
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	cleanup := []func(){func() { os.RemoveAll(directory) }, cancel}
	instance := &BrowserInstance{}
	var store *storage.Store
	instance.Close = func() {
		for i := len(cleanup) - 1; i >= 0; i-- {
			cleanup[i]()
		}
	}
	defer func() {
		if err != nil {
			instance.Close()
		}
	}()
	var authentication *auth.Service
	var fixture *testfixture.Fixture
	if scenario == "enrollment" || scenario == "credential-setup" || scenario == "passkeys" {
		store, err = storage.Open(ctx, filepath.Join(directory, "data"))
		if err != nil {
			return nil, err
		}
		cleanup = append(cleanup, func() { store.Close() })
		authentication = auth.New(store)
		if err = store.SaveSetupLink(ctx, auth.TokenHash("fixture-installer-setup-secret-000000000000"), time.Now().Add(auth.SetupLinkLifetime), false); err != nil {
			return nil, err
		}

	} else {
		fixture, err = testfixture.New(ctx, directory, scenario == "chat" || scenario == "settings" || scenario == "notifications", scenario == "compaction")
		if err != nil {
			return nil, err
		}
		cleanup = append(cleanup, fixture.Close)
		store, authentication = fixture.Store, fixture.Auth
	}
	if scenario == "compaction" {
		c, e := store.CreateChat(ctx, fixture.Project.ID, "Plan the garden", "flora@sha256:"+strings.Repeat("a", 64), "1.2.27")
		if e != nil {
			return nil, e
		}
		instance.ChatID = c.ID
		selected := storage.Execution{Provider: "anthropic", Model: "compaction-fixture"}
		c, e = store.SetChatExecution(ctx, c.ID, selected, 0)
		if e != nil {
			return nil, e
		}
		accepted, e := store.AcceptMessage(ctx, c.ID, "compaction-preview", "Remember that the garden should include marigolds. Plan the next planting steps.")
		if e != nil {
			return nil, e
		}
		if e = store.BindRuntime(ctx, c.ID, "browser-container", "ses_browser"); e != nil {
			return nil, e
		}
		raw := json.RawMessage(`{"info":{"id":"compaction-preview-assistant","role":"assistant","providerID":"anthropic","modelID":"compaction-fixture","time":{"created":1,"completed":2},"tokens":{"input":30000,"output":10,"cache":{"read":0,"write":0}}},"parts":[{"type":"text","text":"We will plant marigolds along the sunny border, then water the seedlings."}]}`)
		if e = store.SaveUsageMessage(ctx, c.ID, "ses_browser", "", "", raw); e != nil {
			return nil, e
		}
		if e = store.SaveRuntimeMessage(ctx, "compaction-preview-assistant", storage.Message{ChatID: c.ID, Role: "assistant", Provider: "anthropic", Model: "compaction-fixture", RuntimeMessageID: "compaction-preview-assistant", Text: "We will plant marigolds along the sunny border, then water the seedlings.", Payload: raw}); e != nil {
			return nil, e
		}
		if e = store.SaveContextLimit(ctx, c.ID, "anthropic", "compaction-fixture", 100000); e != nil {
			return nil, e
		}
		if e = store.Transition(ctx, c.ID, accepted.Message.ID, storage.Idle, "Ready for input"); e != nil {
			return nil, e
		}
	}
	if scenario == "model-summary" {
		instance.ChatID, instance.OtherChatID, err = seedModelSummaries(ctx, store, fixture.Project)
		if err != nil {
			return nil, err
		}
	}
	if scenario == "branches" {
		repos := []storage.Repository{{Name: "rhizomatous/flora", URL: "https://github.com/rhizomatous/flora.git", BaseBranch: "main", Role: "core"}}
		if err = store.UpdateProject(ctx, fixture.Project.ID, "Flora", storage.Configuration{Repositories: repos}); err != nil {
			return nil, err
		}
		repos = append(repos, storage.Repository{Name: "rhizomatous/florets", URL: "https://github.com/rhizomatous/florets.git", BaseBranch: "develop", Role: "extra"})
		if _, err = store.CreateProject(ctx, "Flora workspace", storage.Configuration{Repositories: repos}); err != nil {
			return nil, err
		}
	}
	if scenario == "mcps" {
		closeFixture, e := seedMCPBrowser(ctx, store)
		if e != nil {
			return nil, e
		}
		cleanup = append(cleanup, closeFixture)
	}
	configuration := settings.New(store)
	if scenario == "credential-setup" {
		configuration.DiscoverModel = func(context.Context, storage.Credentials) (string, error) { return "fixture-model", nil }
	}
	var appInstalled atomic.Bool
	var appKey string
	if scenario == "credential-setup" {
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			return nil, err
		}
		appKey = string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}))
	}
	configuration.GitHub.Client.Transport = browserTransport(func(r *http.Request) (*http.Response, error) {
		body := `{}`
		status := 200
		installation := map[string]any{"id": 40, "app_id": 12, "account": map[string]string{"login": "flora-fixture"}, "suspended_at": nil, "html_url": "https://github.com/settings/installations/40"}
		repositories := []map[string]string{{"full_name": "flora/fixture", "html_url": "https://github.com/flora/fixture", "default_branch": "main"}}
		var result any
		switch r.URL.Path {
		case "/user/repos":
			result = repositories
		case "/app-manifests/fixture-code/conversions":
			result = map[string]any{"id": 12, "slug": "flora-fixture", "pem": appKey}
		case "/app/installations":
			if appInstalled.Load() {
				result = []any{installation}
			} else {
				result = []any{}
			}
		case "/app/installations/40":
			appInstalled.Store(true)
			result = installation
		case "/app/installations/40/access_tokens":
			result = map[string]any{"token": "fixture-installation-token", "expires_at": time.Now().Add(time.Hour)}
		case "/installation/repositories":
			result = map[string]any{"repositories": repositories}
		default:
			status = 503
		}
		if result != nil {
			raw, _ := json.Marshal(result)
			body = string(raw)
		}
		return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	if scenario == "settings" || scenario == "credential-setup" {
		configuration.MaxRunningOverride = 4
		configuration.Validate = func(_ context.Context, c storage.Credentials) error {
			if c.ProviderKey == "invalid-fixture-key" {
				return &settings.ValidationError{Message: "Anthropic rejected the credential. Check its value, expiry, and permissions."}
			}
			return nil
		}
		configuration.RuntimeDiagnostics = func(context.Context) []settings.Diagnostic {
			return []settings.Diagnostic{{Name: "Docker", Message: "Cannot reach Docker. Start Docker and check socket permissions."}, {Name: "Agent image", Message: "Image pull failed. Check registry access and disk space."}}
		}
	}
	if scenario == "changes" {
		c, createErr := testfixture.SavedReview(store, fixture.Project)
		if createErr != nil {
			return nil, createErr
		}
		instance.ChatID = c.ID
	}
	if scenario == "workspace" || scenario == "context" {
		project, createErr := store.CreateProject(ctx, "Workspace preview", storage.Configuration{Repositories: []storage.Repository{
			{Name: "flora/web", URL: "https://github.com/flora/web", BaseBranch: "main", Role: "core"},
			{Name: "flora/api", URL: "https://github.com/flora/api", BaseBranch: "main", Role: "core"},
		}})
		if createErr != nil {
			return nil, createErr
		}
		for _, multi := range []bool{true, false} {
			p := project
			if !multi {
				p = fixture.Project
			}
			c, createErr := store.CreateChat(ctx, p.ID, "Explore workspace files", "flora@sha256:"+strings.Repeat("a", 64), "1.2.27")
			if createErr != nil {
				return nil, createErr
			}
			binding := "workspace-stopped"
			if multi {
				if scenario == "workspace" {
					binding = "missing-browser-container"
				}
				instance.ChatID = c.ID
			} else {
				instance.OtherChatID = c.ID
			}
			if scenario != "context" {
				if err = store.BindRuntime(ctx, c.ID, binding, ""); err != nil {
					return nil, err
				}
			}
			if scenario == "context" {
				accepted, e := store.AcceptMessage(ctx, c.ID, "sample-first-message", "Help me understand this workspace.")
				if e != nil {
					return nil, e
				}
				if e := store.SaveRuntimeMessage(ctx, "sample-assistant", storage.Message{ChatID: c.ID, Role: "assistant", RuntimeMessageID: "sample-assistant", Text: "The workspace has web and API repositories. Start with each README.", Payload: json.RawMessage(`{}`)}); e != nil {
					return nil, e
				}
				if e := store.Transition(ctx, c.ID, accepted.Message.ID, storage.Idle, "Ready for input"); e != nil {
					return nil, e
				}
			}
			paths, pathErr := store.Paths(ctx, c.ID)
			if pathErr != nil {
				return nil, pathErr
			}
			for _, repo := range c.Configuration.Repositories {
				root := filepath.Join(paths.Workspace, strings.TrimPrefix(storage.RepositoryPath(c.Configuration, repo), "/workspace"))
				if err = os.MkdirAll(filepath.Join(root, "src"), 0700); err != nil {
					return nil, err
				}
				if err = os.MkdirAll(filepath.Join(root, "empty"), 0700); err != nil {
					return nil, err
				}
				files := map[string]string{
					".gitignore":                  "node_modules/\nresult\n.env\n",
					".github/workflows/check.yml": "name: Checks\non: [push, pull_request]\njobs:\n  check:\n    runs-on: ubuntu-latest\n",
					"README.md":                   "# Flora workspace\n\nA small development workspace for testing file navigation.\n",
					"flake.nix": `# Development tools for the workspace.
{
  description = "Flora development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        # Keep command-line tools in one place.
        tools = with pkgs; [
          git
          go
          nodejs_24
          ripgrep
        ];
      in {
        devShells.default = pkgs.mkShell {
          packages = tools;

          shellHook = ''
            echo "Workspace ready"
          '';
        };

        formatter = pkgs.nixfmt;
      });
}
`,
					"README.txt":        "Workspace preview fixture\nRepository: " + repo.Name + "\n\nBrowse files, open src, and download a file.\n",
					"package.json":      "{\n  \"name\": \"" + repo.Name + "\",\n  \"private\": true\n}\n",
					"src/navigation.ts": "export const views = [\n  \"Overview\",\n  \"Diffs\",\n  \"Files\",\n];\n\nexport function label(index: number) {\n  return views[index] ?? \"Overview\";\n}\n",
					"large.log":         strings.Repeat("Workspace checks passed. All services ready.\n", 20000),
					"picture.bin":       string([]byte{0, 1, 2, 3}),
					"empty.txt":         "",
				}
				for name, body := range files {
					if err = os.MkdirAll(filepath.Dir(filepath.Join(root, name)), 0700); err != nil {
						return nil, err
					}
					if err = os.WriteFile(filepath.Join(root, name), []byte(body), 0600); err != nil {
						return nil, err
					}
				}
				if err = os.Symlink("/etc/passwd", filepath.Join(root, "outside-link")); err != nil {
					return nil, err
				}
			}
		}
	}
	if scenario == "notifications" {
		image, harness := (&testfixture.Provisioner{}).Identity()
		other, createErr := store.CreateChat(ctx, fixture.Project.ID, "Other conversation", image, harness)
		if createErr != nil {
			return nil, createErr
		}
		if err = store.Transition(ctx, other.ID, "", storage.Idle, "Ready for input"); err != nil {
			return nil, err
		}
		instance.OtherChatID = other.ID
	}
	if scenario == "chat" {
		missing, createErr := store.CreateChat(ctx, fixture.Project.ID, "Missing container", "flora@sha256:"+strings.Repeat("a", 64), "1.2.27")
		if createErr != nil {
			return nil, createErr
		}
		accepted, acceptErr := store.AcceptMessage(ctx, missing.ID, "missing-saved", "Saved input from the missing container")
		if acceptErr != nil {
			return nil, acceptErr
		}
		if err = store.BindRuntime(ctx, missing.ID, "missing-browser-container", "saved-session"); err != nil {
			return nil, err
		}
		if err = store.Transition(ctx, missing.ID, accepted.Message.ID, storage.Failed, "The saved container is missing. Saved history remains available."); err != nil {
			return nil, err
		}
		gapCtx, stopGap := context.WithCancel(ctx)
		gapDone := make(chan struct{})
		go func() {
			defer close(gapDone)
			for {
				chats, readErr := store.Chats(gapCtx)
				if readErr == nil {
					for _, c := range chats {
						if c.Title == "First browser prompt 🌸" {
							_ = store.AppendActivity(gapCtx, c.ID, "browser-capture-gap", "capture.gap", json.RawMessage(`{"reason":"Transient runtime events cannot be recovered."}`))
							return
						}
					}
				}
				select {
				case <-gapCtx.Done():
					return
				case <-time.After(20 * time.Millisecond):
				}
			}
		}()
		cleanup = append(cleanup, func() { stopGap(); <-gapDone })
	}
	if environmentPreview {
		if err := store.SaveEnvironment(ctx, "installation", "", []storage.EnvironmentChange{{Name: "TASK_REGION", Action: "set", Value: "preview-region"}, {Name: "SERVICE_TOKEN", Action: "replace", Value: "fixture_preview_secret_124", Secret: true}}); err != nil {
			return nil, err
		}
		projects, err := store.Projects(ctx)
		if err != nil {
			return nil, err
		}
		description := "Staging deployment credentials"
		for _, project := range projects {
			if err := store.SaveEnvironment(ctx, "project", project.ID, []storage.EnvironmentChange{{Name: "DEPLOY_TOKEN", Action: "replace", Value: "fixture_preview_deploy_token", Secret: true, Description: &description}, {Name: "DEPLOY_REGION", Action: "set", Value: "staging"}}); err != nil {
				return nil, err
			}
		}
	}
	srv := httptest.NewUnstartedServer(nil)
	origin := "https://" + srv.Listener.Addr().String()
	if scenario == "passkeys" {
		origin = strings.Replace(origin, "127.0.0.1", "localhost", 1)
	}
	if scenario == "mcps" || scenario == "compaction" || scenario == "model-summary" || scenario == "models" || scenario == "workspace" || scenario == "branches" || scenario == "context" {
		origin = "http://" + srv.Listener.Addr().String()
		if scenario == "branches" {
			origin = strings.Replace(origin, "127.0.0.1", "localhost", 1)
		}
	}
	var authAge atomic.Int64
	if scenario == "passkeys" {
		authentication.Now = func() time.Time { return time.Now().Add(time.Duration(authAge.Load()) * time.Second) }
	}
	var app http.Handler
	if fixture == nil {
		app = New(webassets.FS(), authentication, configuration, origin)
	} else {
		app = New(webassets.FS(), authentication, configuration, origin, fixture.Service)
	}
	if scenario == "credential-setup" {
		validation := projects.New(store)
		validation.Client.Transport = browserTransport(func(r *http.Request) (*http.Response, error) {
			if strings.HasPrefix(r.URL.Path, "/repos/") {
				return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"default_branch":"main"}`))}, nil
			}
			return configuration.GitHub.Client.Transport.RoundTrip(r)
		})
		a := &api{auth: authentication, projects: validation, settings: configuration, origin: origin}
		mux := http.NewServeMux()
		a.projectRoutes(mux)
		projectHandler := a.protect(mux)
		original := app
		app = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/api/projects") {
				projectHandler.ServeHTTP(w, r)
				return
			}
			original.ServeHTTP(w, r)
		})
	}
	var githubUnavailable atomic.Bool
	if fixture != nil {
		validation := projects.New(store)
		validation.Client.Transport = browserTransport(func(r *http.Request) (*http.Response, error) {
			code := 200
			if strings.Contains(r.URL.Path, "/pulls") {
				body := `{"number":42,"title":"Keep workspace context with each message","body":"Read referenced files and chats while working.","state":"open","updated_at":"2026-11-20T10:00:00Z","head":{"sha":"abc123"},"base":{"sha":"def456"}}`
				if strings.HasSuffix(r.URL.Path, "/pulls") {
					body = "[" + body + "]"
				}
				return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, nil
			}
			if scenario == "branches" {
				body := `{"default_branch":"main"}`
				if githubUnavailable.Load() {
					code = 503
				}
				if strings.HasSuffix(r.URL.Path, "/branches/deleted") {
					code = 404
				}
				if strings.HasSuffix(r.URL.Path, "/branches") {
					body = `[{"name":"main"},{"name":"develop"},{"name":"release/stable"},{"name":"feature/branch-picker"},{"name":"deleted"}]`
				}
				return &http.Response{StatusCode: code, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, nil
			}
			if strings.HasSuffix(r.URL.Path, "/branches") {
				return &http.Response{StatusCode: code, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`[{"name":"main"},{"name":"release"}]`))}, nil
			}
			if strings.HasSuffix(r.URL.Path, "/branches/missing") {
				code = 404
			}
			return &http.Response{StatusCode: code, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"default_branch":"main"}`))}, nil
		})
		a := &api{auth: authentication, projects: validation, settings: configuration, chats: fixture.Service, origin: origin}
		mux := http.NewServeMux()
		a.projectRoutes(mux)
		a.environmentRoutes(mux)
		a.chatRoutes(mux)
		a.attachmentRoutes(mux)
		a.referenceRoutes(mux)
		projectHandler := a.protect(a.chatReferences(mux))
		original := app
		app = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/api/projects") {
				projectHandler.ServeHTTP(w, r)
				return
			}
			original.ServeHTTP(w, r)
		})
	}
	// Expose saved values only in this fixture executable so tests can verify
	// credentials that the public settings API deliberately does not return.
	mux := http.NewServeMux()
	mux.HandleFunc("GET /__fixture/settings", func(w http.ResponseWriter, r *http.Request) {
		preferences, err := store.Preferences(r.Context())
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		credentials, err := store.Credentials(r.Context())
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"cpus": preferences.CPUs, "messageBytes": preferences.MessageBytes, "sound": preferences.Sound,
			"providerKey": credentials.ProviderKey, "githubToken": credentials.GitHubToken,
		})
	})
	if scenario == "branches" {
		mux.HandleFunc("POST /__fixture/github", func(w http.ResponseWriter, r *http.Request) {
			githubUnavailable.Store(r.URL.Query().Get("unavailable") == "true")
			w.WriteHeader(204)
		})
	}
	if scenario == "passkeys" {
		mux.HandleFunc("POST /__fixture/auth-age", func(w http.ResponseWriter, r *http.Request) { authAge.Store(360); w.WriteHeader(204) })
		mux.HandleFunc("POST /__fixture/recovery", func(w http.ResponseWriter, r *http.Request) {
			proof := auth.NewSetupToken()
			if err := store.SaveRecoveryLink(r.Context(), auth.TokenHash(proof), time.Now().Add(15*time.Minute)); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			jsonResponse(w, 200, map[string]string{"link": origin + "/#recover/" + proof})
		})
	}
	mux.Handle("/", app)
	srv.Config.Handler = mux
	if scenario == "mcps" || scenario == "compaction" || scenario == "model-summary" || scenario == "models" || scenario == "workspace" || scenario == "branches" || scenario == "context" {
		srv.Start()
	} else {
		srv.StartTLS()
	}
	cleanup = append(cleanup, func() { srv.CloseClientConnections(); srv.Close() })
	instance.URL = srv.URL
	if scenario == "branches" || scenario == "passkeys" {
		instance.URL = strings.Replace(instance.URL, "127.0.0.1", "localhost", 1)
	}
	return instance, nil
}
