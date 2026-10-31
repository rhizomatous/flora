package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/chat"
	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/webassets"
	sse "github.com/tmaxmax/go-sse"
)

type browserProvisioner struct {
	store *storage.Store
	url   string
}

func (*browserProvisioner) Identity() (string, string) {
	return "flora@sha256:" + strings.Repeat("a", 64), "1.2.27"
}
func (p *browserProvisioner) Start(ctx context.Context, id string) (provisioning.Endpoint, error) {
	if err := p.store.BindRuntime(ctx, id, "browser-container", ""); err != nil {
		return provisioning.Endpoint{}, err
	}
	return p.Endpoint(ctx, id)
}
func (p *browserProvisioner) Endpoint(context.Context, string) (provisioning.Endpoint, error) {
	return provisioning.Endpoint{URL: p.url, Username: "opencode", Password: "test-runtime-password", ContainerID: "browser-container"}, nil
}
func (*browserProvisioner) BeginActivity(string)                           {}
func (*browserProvisioner) EndActivity(string)                             {}
func (*browserProvisioner) Stop(context.Context, string) error             { return nil }
func (*browserProvisioner) ConfirmInterrupt(context.Context, string) error { return nil }

func chatAPI(t *testing.T, interactive ...bool) (*storage.Store, *chat.Service, *auth.Service, string, storage.Project, func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	authentication := auth.New(store)
	token, _, err := authentication.Bootstrap(ctx, "browser test password")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveCredentials(ctx, storage.Credentials{Provider: "anthropic", Model: "model", ProviderKey: "provider-test-secret", GitHubToken: "github_pat_test-secret"}); err != nil {
		t.Fatal(err)
	}
	project, err := store.CreateProject(ctx, "Browser project", storage.Configuration{Repositories: []storage.Repository{{Name: "core", URL: "https://github.com/example/core", BaseBranch: "main", Role: "core"}}})
	if err != nil {
		t.Fatal(err)
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
			ask := len(interactive) > 0 && interactive[0] && n == 1
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
	svc := chat.New(ctx, store, &browserProvisioner{store, runtime.URL})
	return store, svc, authentication, token, project, func() { cancel(); runtime.Close(); store.Close() }
}

func TestChatAPIAuthenticationValidationAndReplay(t *testing.T) {
	store, svc, authentication, token, project, cleanup := chatAPI(t)
	defer cleanup()
	server := httptest.NewUnstartedServer(nil)
	origin := "http://" + server.Listener.Addr().String()
	server.Config.Handler = New(webassets.FS(), authentication, settings.New(store), origin, svc)
	server.Start()
	defer server.Close()
	call := func(method, path, body, cookie, requestOrigin string, want int) []byte {
		t.Helper()
		r, _ := http.NewRequest(method, server.URL+path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", requestOrigin)
		if cookie != "" {
			r.AddCookie(&http.Cookie{Name: cookieName, Value: cookie})
		}
		res, err := server.Client().Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		if res.StatusCode != want {
			t.Fatalf("%s %s = %d, want %d: %s", method, path, res.StatusCode, want, b)
		}
		if strings.Contains(string(b), "test-secret") {
			t.Fatal("credential leaked")
		}
		return b
	}
	for _, route := range []struct{ method, path string }{
		{"POST", "/api/chats/missing/interrupt"}, {"POST", "/api/chats/missing/stop"},
		{"GET", "/api/chats"}, {"GET", "/api/chats/missing/setup-log"}, {"HEAD", "/api/chats/missing/setup-log"}, {"GET", "/api/chats/missing"}, {"GET", "/api/chats/missing/events"}, {"GET", "/api/chats/missing/questions"}, {"POST", "/api/projects/" + project.ID + "/chats"}, {"POST", "/api/chats/missing/messages"}, {"POST", "/api/chats/missing/questions/question/reply"},
	} {
		call(route.method, route.path, "{}", "", origin, 401)
		if route.method == "POST" {
			call(route.method, route.path, "{}", token, "https://evil.test", 403)
		}
	}
	body := `{"title":"Persistent API chat","requestID":"initial","text":"First prompt"}`
	path := "/api/projects/" + project.ID + "/chats"
	for _, invalid := range []string{`{"title":"Test","requestID":"bad","text":""}`, `{"title":"Test","requestID":"bad","text":"` + strings.Repeat("🌸", 32769) + `"}`, "{\"text\":\"" + string([]byte{255}) + "\"}", `{} {}`, `{"unknown":1}`} {
		call("POST", path, invalid, token, origin, 400)
	}
	var c storage.Chat
	if err := json.Unmarshal(call("POST", path, body, token, origin, 202), &c); err != nil {
		t.Fatal(err)
	}
	var duplicate storage.Chat
	json.Unmarshal(call("POST", path, body, token, origin, 202), &duplicate)
	if c.ID != duplicate.ID {
		t.Fatal("creation retry created a second chat")
	}
	call("GET", "/api/chats/"+c.ID+"/setup-log", "", token, "", 404)
	paths, err := store.Paths(context.Background(), c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(paths.Logs, "setup.log"), []byte("full retained setup output\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := call("GET", "/api/chats/"+c.ID+"/setup-log", "", token, "", 200); string(got) != "full retained setup output\n" {
		t.Fatal("full setup log download lost output")
	}
	call("POST", "/api/chats/"+c.ID+"/messages", `{"requestID":"active","text":"not queued"}`, token, origin, 409)
	call("GET", "/api/chats/"+c.ID+"/events?after=invalid", "", token, "", 400)
	call("GET", "/api/chats/missing/events", "", token, "", 404)
	read := func(after string, stopKind string) []storage.Activity {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		r, _ := http.NewRequestWithContext(ctx, "GET", server.URL+"/api/chats/"+c.ID+"/events", nil)
		r.AddCookie(&http.Cookie{Name: cookieName, Value: token})
		r.Header.Set("Last-Event-ID", after)
		res, err := server.Client().Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.Header.Get("Content-Type") != "text/event-stream" {
			t.Fatal("not SSE")
		}
		rows := []storage.Activity{}
		for event, err := range sse.Read(res.Body, nil) {
			if err != nil {
				t.Fatal(err)
			}
			var row storage.Activity
			if json.Unmarshal([]byte(event.Data), &row) != nil {
				t.Fatal("invalid event JSON")
			}
			if len(rows) > 0 && row.Sequence <= rows[len(rows)-1].Sequence {
				t.Fatal("replay out of order")
			}
			rows = append(rows, row)
			if row.Kind == stopKind {
				return rows
			}
		}
		t.Fatal("missing event")
		return nil
	}
	initial := read("", "message.accepted")
	cursor := initial[len(initial)-1].Sequence
	// No browser stream remains connected. Work must still complete and persist.
	time.Sleep(time.Second)
	call("GET", "/api/chats/"+c.ID, "", token, "", 200)
	if err := store.AppendActivity(context.Background(), c.ID, "reconnect-marker", "test.reconnect", json.RawMessage(`{"saved":true}`)); err != nil {
		t.Fatal(err)
	}
	replayed := read(fmt.Sprint(cursor), "test.reconnect")
	for _, row := range replayed {
		if row.Sequence <= cursor {
			t.Fatal("duplicate after cursor")
		}
	}
	if len(replayed) < 2 {
		t.Fatal("missed completion activity")
	}
	// The maximum decoded size is accepted even when every codepoint is multibyte.
	maxBody, _ := json.Marshal(map[string]string{"requestID": "max", "text": strings.Repeat("🌸", 32768)})
	call("POST", "/api/chats/"+c.ID+"/messages", string(maxBody), token, origin, 202)
	call("POST", "/api/chats/"+c.ID+"/messages", string(maxBody), token, origin, 202)
	// New saves reach an already connected client within one second. Revoking
	// its session also ends that open stream rather than leaking future activity.
	streamCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(streamCtx, "GET", server.URL+"/api/chats/"+c.ID+"/events", nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: token})
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	arrival := make(chan time.Time, 1)
	closed := make(chan struct{})
	go func() {
		defer close(closed)
		for event, err := range sse.Read(res.Body, nil) {
			if err != nil {
				return
			}
			if strings.Contains(event.Data, "live-marker") {
				arrival <- time.Now()
			}
		}
	}()
	savedAt := time.Now()
	if err := store.AppendActivity(context.Background(), c.ID, "live-marker", "test.live", json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	select {
	case at := <-arrival:
		if at.Sub(savedAt) >= time.Second {
			t.Fatal("status delivery exceeded one second")
		}
	case <-time.After(time.Second):
		t.Fatal("no live event")
	}
	if err := authentication.Logout(context.Background(), token); err != nil {
		t.Fatal(err)
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("revoked stream stayed open")
	}
	call("GET", "/api/chats/"+c.ID+"/events", "", token, "", 401)
}

func TestChatBrowser(t *testing.T) {
	if os.Getenv("FLORA_CHAT_BROWSER_TEST") != "1" {
		t.Skip("set FLORA_CHAT_BROWSER_TEST=1 after installing Playwright Chromium")
	}
	store, svc, authentication, _, _, cleanup := chatAPI(t, true)
	defer cleanup()
	srv := httptest.NewUnstartedServer(nil)
	origin := "https://" + srv.Listener.Addr().String()
	srv.Config.Handler = New(webassets.FS(), authentication, settings.New(store), origin, svc)
	srv.StartTLS()
	defer srv.Close()
	script, err := filepath.Abs("../../../scripts/chat.browser.mjs")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("node", script)
	cmd.Env = append(os.Environ(), "FLORA_BROWSER_URL="+srv.URL)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("browser check failed: %v\n%s", err, output)
	}
	t.Log(string(output))
}
