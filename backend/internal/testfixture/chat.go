package testfixture

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"time"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/chat"
	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

// Fixture owns an isolated store and a deterministic runtime used by API and browser tests.
type Fixture struct {
	Store   *storage.Store
	Service *chat.Service
	Auth    *auth.Service
	Token   string
	Project storage.Project
	Close   func()
}

type Provisioner struct {
	store *storage.Store
	url   string
}

func (*Provisioner) Identity() (string, string) {
	return "flora@sha256:" + strings.Repeat("a", 64), "1.2.27"
}
func (p *Provisioner) Start(ctx context.Context, id string) (provisioning.Endpoint, error) {
	if err := p.store.BindRuntime(ctx, id, "browser-container", ""); err != nil {
		return provisioning.Endpoint{}, err
	}
	return p.Endpoint(ctx, id)
}
func (p *Provisioner) Endpoint(ctx context.Context, id string) (provisioning.Endpoint, error) {
	c, err := p.store.Chat(ctx, id)
	if err != nil {
		return provisioning.Endpoint{}, err
	}
	if c.ContainerID == "missing-browser-container" {
		return provisioning.Endpoint{}, &provisioning.ExecutionEndedError{Reason: "The saved container is missing", Missing: true}
	}
	return provisioning.Endpoint{URL: p.url, Username: "opencode", Password: "test-runtime-password", ContainerID: "browser-container"}, nil
}
func (*Provisioner) BeginActivity(string)                           {}
func (*Provisioner) EndActivity(string)                             {}
func (*Provisioner) Stop(context.Context, string) error             { return nil }
func (*Provisioner) ConfirmInterrupt(context.Context, string) error { return nil }

// New seeds credentials and a project in directory and starts a fake runtime.
// Call Close before removing directory. Interactive fixtures ask a question on the first turn.
func New(ctx context.Context, directory string, interactive bool) (*Fixture, error) {
	ctx, cancel := context.WithCancel(ctx)
	success := false
	defer func() {
		if !success {
			cancel()
		}
	}()
	store, err := storage.Open(ctx, directory)
	if err != nil {
		return nil, err
	}
	defer func() {
		if !success {
			store.Close()
		}
	}()
	authentication := auth.New(store)
	token, _, err := authentication.Bootstrap(ctx, "browser test password")
	if err != nil {
		return nil, err
	}
	if err := store.SaveCredentials(ctx, storage.Credentials{Provider: "anthropic", Model: "model", ProviderKey: "provider-test-secret", GitHubToken: "github_pat_test-secret"}); err != nil {
		return nil, err
	}
	project, err := store.CreateProject(ctx, "Browser project", storage.Configuration{Repositories: []storage.Repository{{Name: "core", URL: "https://github.com/example/core", BaseBranch: "main", Role: "core"}}})
	if err != nil {
		return nil, err
	}
	var mu sync.Mutex
	history := []json.RawMessage{}
	turn := 0
	pending := false
	answer := make(chan struct{})
	events := make(chan string, 10)
	runtime := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, _ := r.BasicAuth()
		if user != "opencode" || pass != "test-runtime-password" {
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/config":
			fmt.Fprint(w, `{"model":"anthropic/model"}`)
		case "/session":
			fmt.Fprint(w, `{"id":"ses_browser"}`)
		case "/session/status":
			fmt.Fprint(w, `{}`)
		case "/instance/dispose":
			fmt.Fprint(w, `true`)
		case "/session/ses_browser/abort":
			mu.Lock()
			pending = false
			mu.Unlock()
			fmt.Fprint(w, `true`)
		case "/question":
			mu.Lock()
			defer mu.Unlock()
			if pending {
				fmt.Fprint(w, `[{"id":"que_browser","sessionID":"ses_browser","questions":[{"question":"Continue workspace inspection?","header":"Continue","options":[{"label":"Yes","description":"Continue"}],"custom":false}]}]`)
			} else {
				fmt.Fprint(w, `[]`)
			}
		case "/question/que_browser/reply":
			mu.Lock()
			pending = false
			mu.Unlock()
			close(answer)
			fmt.Fprint(w, `true`)
		case "/event":
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, ": connected\n\n")
			w.(http.Flusher).Flush()
			for {
				select {
				case <-r.Context().Done():
					return
				case event := <-events:
					fmt.Fprintf(w, "data: %s\n\n", event)
					w.(http.Flusher).Flush()
				}
			}
		case "/session/ses_browser/message":
			if r.Method == "GET" {
				mu.Lock()
				defer mu.Unlock()
				json.NewEncoder(w).Encode(history)
				return
			}
			var input struct {
				Parts []struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"parts"`
			}
			if json.NewDecoder(r.Body).Decode(&input) != nil {
				w.WriteHeader(400)
				return
			}
			mu.Lock()
			turn++
			n := turn
			user, _ := json.Marshal(map[string]any{"info": map[string]string{"id": fmt.Sprintf("user_%d", n), "role": "user"}, "parts": input.Parts})
			history = append(history, user)
			ask := interactive && n == 1
			if ask {
				pending = true
			}
			mu.Unlock()
			if strings.Contains(input.Parts[0].Text, "control work") {
				<-r.Context().Done()
				return
			}
			if ask {
				events <- `{"type":"question.asked","properties":{"id":"que_browser","sessionID":"ses_browser"}}`
				select {
				case <-r.Context().Done():
					return
				case <-answer:
				}
			}
			select {
			case <-r.Context().Done():
				return
			case <-time.After(750 * time.Millisecond):
			}
			response := json.RawMessage(fmt.Sprintf(`{"info":{"id":"assistant_%d","parentID":"user_%d","role":"assistant","providerID":"anthropic","modelID":"model"},"parts":[{"type":"text","text":"Saved response %d"},{"type":"tool","tool":"bash","state":{"status":"completed","input":{"command":"pwd"},"output":"/workspace\nprovider-test-secret"}}]}`, n, n, n))
			mu.Lock()
			history = append(history, response)
			mu.Unlock()
			w.Write(response)
		default:
			w.WriteHeader(404)
		}
	}))
	svc := chat.New(ctx, store, &Provisioner{store, runtime.URL})
	success = true
	return &Fixture{Store: store, Service: svc, Auth: authentication, Token: token, Project: project, Close: func() { cancel(); runtime.Close(); store.Close() }}, nil
}
