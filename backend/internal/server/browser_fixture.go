//go:build browserfixture

package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/projects"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/testfixture"
	"github.com/rhizomatous/flora/backend/internal/webassets"
)

type browserInstance struct {
	URL         string `json:"url"`
	ID          string `json:"id"`
	ChatID      string `json:"chatID"`
	OtherChatID string `json:"otherChatID"`
	store       *storage.Store
	close       func()
}

// BrowserFixtures allocates isolated backends for Playwright. It is compiled only
// into the loopback fixture executable, never into the shipped application.
func BrowserFixtures() (http.Handler, func()) {
	var mu sync.Mutex
	instances := map[string]*browserInstance{}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("POST /fixtures/{scenario}", func(w http.ResponseWriter, r *http.Request) {
		instance, err := newBrowserInstance(r.PathValue("scenario"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		mu.Lock()
		instances[instance.ID] = instance
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(instance)
	})
	mux.HandleFunc("DELETE /fixtures/{id}", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		instance := instances[r.PathValue("id")]
		delete(instances, r.PathValue("id"))
		mu.Unlock()
		if instance != nil {
			instance.close()
		}
		w.WriteHeader(http.StatusNoContent)
	})
	// Read saved values independently of the browser UI, including credentials that
	// the application deliberately never returns through its public settings API.
	mux.HandleFunc("GET /fixtures/{id}/settings", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		instance := instances[r.PathValue("id")]
		if instance == nil {
			http.NotFound(w, r)
			return
		}
		preferences, err := instance.store.Preferences(r.Context())
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		credentials, err := instance.store.Credentials(r.Context())
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
	return mux, func() {
		mu.Lock()
		defer mu.Unlock()
		for id, instance := range instances {
			instance.close()
			delete(instances, id)
		}
	}
}

type browserTransport func(*http.Request) (*http.Response, error)

func (f browserTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func newBrowserInstance(scenario string) (_ *browserInstance, err error) {
	switch scenario {
	case "chat", "changes", "enrollment", "notifications", "projects", "settings":
	default:
		return nil, fmt.Errorf("unknown browser scenario %q", scenario)
	}
	directory, err := os.MkdirTemp("", "flora-browser-")
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	cleanup := []func(){func() { os.RemoveAll(directory) }, cancel}
	instance := &browserInstance{ID: filepath.Base(directory)}
	instance.close = func() {
		for i := len(cleanup) - 1; i >= 0; i-- {
			cleanup[i]()
		}
	}
	defer func() {
		if err != nil {
			instance.close()
		}
	}()
	var authentication *auth.Service
	var fixture *testfixture.Fixture
	if scenario == "enrollment" {
		instance.store, err = storage.Open(ctx, filepath.Join(directory, "data"))
		if err != nil {
			return nil, err
		}
		cleanup = append(cleanup, func() { instance.store.Close() })
		file := filepath.Join(directory, "enrollment.sha256")
		if err = os.WriteFile(file, []byte(auth.TokenHash("fixture-installer-enrollment-code")), 0600); err != nil {
			return nil, err
		}
		authentication = auth.New(instance.store)
		if err = authentication.RequireEnrollment(file); err != nil {
			return nil, err
		}
	} else {
		fixture, err = testfixture.New(ctx, directory, scenario == "chat" || scenario == "settings" || scenario == "notifications")
		if err != nil {
			return nil, err
		}
		cleanup = append(cleanup, fixture.Close)
		instance.store, authentication = fixture.Store, fixture.Auth
	}
	store := instance.store
	configuration := settings.New(store)
	if scenario == "settings" {
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
	srv := httptest.NewUnstartedServer(nil)
	origin := "https://" + srv.Listener.Addr().String()
	var app http.Handler
	if fixture == nil {
		app = New(webassets.FS(), authentication, configuration, origin)
	} else {
		app = New(webassets.FS(), authentication, configuration, origin, fixture.Service)
	}
	if scenario == "projects" {
		validation := projects.New(store)
		validation.Client.Transport = browserTransport(func(r *http.Request) (*http.Response, error) {
			code := 200
			if strings.HasSuffix(r.URL.Path, "/branches/missing") {
				code = 404
			}
			return &http.Response{StatusCode: code, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"default_branch":"main"}`))}, nil
		})
		a := &api{auth: authentication, projects: validation, origin: origin}
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
	srv.Config.Handler = app
	srv.StartTLS()
	cleanup = append(cleanup, func() { srv.CloseClientConnections(); srv.Close() })
	instance.URL = srv.URL
	return instance, nil
}
