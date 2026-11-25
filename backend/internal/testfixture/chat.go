package testfixture

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
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

// Runtime reports deterministic fixture machine states without starting work.
func (p *Provisioner) Runtime(ctx context.Context, id string) (provisioning.RuntimeState, error) {
	c, err := p.store.Chat(ctx, id)
	state := "unknown"
	if c.ContainerID == "missing-browser-container" {
		state = "missing"
	}
	if c.ContainerID == "workspace-stopped" {
		state = "stopped"
	}
	return provisioning.RuntimeState{State: state, ObservedAt: time.Now().UTC(), CollectionError: "Fixture runtime; Docker is not connected."}, err
}
func (*Provisioner) BeginActivity(string)                           {}
func (*Provisioner) EndActivity(string)                             {}
func (*Provisioner) Stop(context.Context, string) error             { return nil }
func (*Provisioner) ConfirmInterrupt(context.Context, string) error { return nil }

// New seeds credentials and a project in directory and starts a fake runtime.
// Call Close before removing directory. Interactive fixtures ask a question on the first turn.
func New(ctx context.Context, directory string, interactive bool, compaction ...bool) (*Fixture, error) {
	ctx, cancel := context.WithCancel(ctx)
	success := false
	defer func() {
		if !success {
			cancel()
		}
	}()
	store, err := storage.OpenWithKeyFile(ctx, filepath.Join(directory, "data"), filepath.Join(directory, "credentials.key"))
	if err != nil {
		return nil, err
	}
	defer func() {
		if !success {
			store.Close()
		}
	}()
	authentication := auth.New(store)
	token, _, err := Bootstrap(ctx, authentication, "browser test password")
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
	if err := store.SaveOnboarding(ctx, storage.Onboarding{Step: "finish", Paused: true, ProjectID: project.ID}); err != nil {
		return nil, err
	}
	var mu sync.Mutex
	history := []json.RawMessage{}
	var reserved *int64
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
		case "/command":
			fmt.Fprint(w, `[{"name":"review","description":"Review changes","source":"command"},{"name":"init","description":"Create or update AGENTS.md","source":"command"},{"name":"audit","description":"Custom runtime command","source":"command"}]`)
		case "/provider":
			metadata := `{"connected":["anthropic"],"all":[{"id":"anthropic","models":{"model":{"name":"Installation default","limit":{"context":200000,"output":64000},"variants":{},"capabilities":{"toolcall":true,"input":{"image":true,"pdf":true}}},"claude-sonnet-4-6":{"name":"Claude Sonnet 4.6","cost":{"input":3,"output":15},"variants":{"low":{},"medium":{},"high":{},"max":{}},"capabilities":{"toolcall":true,"input":{"image":true,"pdf":true}}},"claude-haiku-4-5":{"name":"Claude Haiku 4.5","cost":{"input":1,"output":5},"capabilities":{"toolcall":true,"input":{"image":true,"pdf":true}}}}}]}`
			if len(compaction) > 0 && compaction[0] {
				metadata = strings.Replace(metadata, `"models":{`, `"models":{"compaction-fixture":{"name":"Compaction fixture","limit":{"context":100000,"input":90000,"output":8000},"variants":{},"capabilities":{"toolcall":true,"input":{}}},`, 1)
			}
			fmt.Fprint(w, metadata)
		case "/config":
			mu.Lock()
			defer mu.Unlock()
			json.NewEncoder(w).Encode(map[string]any{"model": "anthropic/model", "compaction": map[string]any{"reserved": reserved}})
		case "/global/config":
			var in struct {
				Compaction struct {
					Reserved int64 `json:"reserved"`
				} `json:"compaction"`
			}
			if r.Method != "PATCH" || json.NewDecoder(r.Body).Decode(&in) != nil {
				w.WriteHeader(400)
				return
			}
			mu.Lock()
			reserved = &in.Compaction.Reserved
			mu.Unlock()
			fmt.Fprint(w, `{}`)
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
		case "/session/ses_browser/message", "/session/ses_browser/command":
			if r.Method == "GET" {
				mu.Lock()
				defer mu.Unlock()
				json.NewEncoder(w).Encode(history)
				return
			}
			var input struct {
				Model     json.RawMessage `json:"model"`
				Command   string          `json:"command"`
				Arguments string          `json:"arguments"`
				MessageID string          `json:"messageID"`
				Variant   string          `json:"variant"`
				Parts     []struct {
					Type     string `json:"type"`
					Text     string `json:"text"`
					Filename string `json:"filename,omitempty"`
					MIME     string `json:"mime,omitempty"`
					URL      string `json:"url,omitempty"`
				} `json:"parts"`
			}
			if json.NewDecoder(r.Body).Decode(&input) != nil {
				w.WriteHeader(400)
				return
			}
			var model struct {
				ID string `json:"modelID"`
			}
			_ = json.Unmarshal(input.Model, &model)
			if input.Command != "" {
				var selected string
				_ = json.Unmarshal(input.Model, &selected)
				_, model.ID, _ = strings.Cut(selected, "/")
				input.Parts = append(input.Parts, struct {
					Type     string `json:"type"`
					Text     string `json:"text"`
					Filename string `json:"filename,omitempty"`
					MIME     string `json:"mime,omitempty"`
					URL      string `json:"url,omitempty"`
				}{Type: "text", Text: "Runtime expanded " + input.Command + ": " + input.Arguments})
			}
			mu.Lock()
			turn++
			n := turn
			if input.MessageID == "" {
				input.MessageID = fmt.Sprintf("user_%d", n)
			}
			user, _ := json.Marshal(map[string]any{"info": map[string]string{"id": input.MessageID, "role": "user"}, "parts": input.Parts})
			history = append(history, user)
			ask := interactive && n == 1
			if ask {
				pending = true
			}
			mu.Unlock()
			if strings.Contains(input.Arguments, "control work") || strings.Contains(input.Parts[0].Text, "control work") {
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
			response := json.RawMessage(fmt.Sprintf(`{"info":{"id":"assistant_%d","parentID":%q,"role":"assistant","providerID":"anthropic","modelID":%q},"parts":[{"type":"text","text":"Saved response %d"},{"type":"tool","tool":"bash","state":{"status":"completed","input":{"command":"pwd"},"output":"/workspace\nprovider-test-secret"}}]}`, n, input.MessageID, model.ID, n))
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

func (p *Provisioner) ModelMetadata(ctx context.Context, c storage.Credentials) (json.RawMessage, error) {
	if c.Provider == "openai" {
		return json.RawMessage(`{"connected":["openai"],"default":{"openai":"gpt-5"},"all":[{"id":"openai","models":{"gpt-5":{"name":"GPT-5","limit":{"context":400000,"output":128000},"cost":{"input":1.25,"output":10},"variants":{"low":{},"medium":{},"high":{}},"capabilities":{"toolcall":true,"input":{"image":true,"pdf":true}}}}}]}`), nil
	}
	if c.Provider == "google" {
		return json.RawMessage(`{"connected":["google"],"default":{"google":"gemini-2.5-pro"},"all":[{"id":"google","models":{"gemini-2.5-pro":{"name":"Gemini 2.5 Pro","limit":{"context":1048576,"output":65536},"cost":{"input":1.25,"output":10},"capabilities":{"toolcall":true,"input":{"image":true,"pdf":true}}}}}]}`), nil
	}

	req, err := http.NewRequestWithContext(ctx, "GET", p.url+"/provider", nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth("opencode", "test-runtime-password")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	return json.RawMessage(raw), err
}

func (p *Provisioner) CommandMetadata(ctx context.Context, _ storage.Credentials) (json.RawMessage, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", p.url+"/command", nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth("opencode", "test-runtime-password")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	return json.RawMessage(raw), err
}

// Bootstrap exercises ownership exchange before creating a fixture account.
func Bootstrap(ctx context.Context, service *auth.Service, password string) (string, time.Time, error) {
	secret := auth.NewSetupToken()
	if err := service.Store.SaveSetupLink(ctx, auth.TokenHash(secret), service.Now().Add(auth.SetupLinkLifetime), false); err != nil {
		return "", time.Time{}, err
	}
	session, _, err := service.RedeemSetup(ctx, secret)
	if err != nil {
		return "", time.Time{}, err
	}
	return service.Bootstrap(ctx, password, session)
}
