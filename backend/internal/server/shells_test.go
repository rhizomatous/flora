package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/chat"
	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/webassets"
)

type shellProvisioner struct {
	chat.Provisioner
	url    string
	state  string
	starts int
}

func (p *shellProvisioner) Endpoint(context.Context, string) (provisioning.Endpoint, error) {
	if p.state == "missing" || p.state == "stopped" {
		return provisioning.Endpoint{}, &provisioning.ExecutionEndedError{Reason: p.state, Missing: p.state == "missing"}
	}
	if p.state == "unknown" {
		return provisioning.Endpoint{}, fmt.Errorf("unavailable")
	}
	return provisioning.Endpoint{URL: p.url, ContainerID: "shell-container", Username: "opencode", Password: "shell-password"}, nil
}
func (p *shellProvisioner) Start(context.Context, string) (provisioning.Endpoint, error) {
	p.starts++
	return provisioning.Endpoint{}, fmt.Errorf("must not start")
}

func TestShellOwnershipLifecycleAndBounds(t *testing.T) {
	store, _, authentication, token, project, cleanup := chatAPI(t)
	defer cleanup()
	ctx := context.Background()
	createChat := func() storage.Chat {
		c, err := store.CreateChat(ctx, project.ID, "Shells", "flora@sha256:"+strings.Repeat("a", 64), "1.2.27")
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	first, other := createChat(), createChat()
	var mu sync.Mutex
	live := map[string]bool{}
	serial := 0
	runtime := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, password, _ := r.BasicAuth()
		if user != "opencode" || password != "shell-password" {
			t.Error("missing runtime authentication")
		}
		if r.URL.Query().Get("directory") != "/workspace" {
			t.Error("wrong directory")
		}
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		id := strings.TrimPrefix(r.URL.Path, "/pty/")
		switch r.Method {
		case "GET":
			items := []map[string]string{}
			for id := range live {
				items = append(items, map[string]string{"id": id, "status": "running"})
			}
			json.NewEncoder(w).Encode(items)
		case "POST":
			serial++
			id = fmt.Sprintf("pty_%d", serial)
			live[id] = true
			json.NewEncoder(w).Encode(map[string]string{"id": id, "status": "running"})
		case "DELETE":
			delete(live, id)
			fmt.Fprint(w, "true")
		case "PUT":
			if !live[id] {
				t.Error("resized wrong shell")
			}
			fmt.Fprint(w, `{"status":"running"}`)
		}
	}))
	defer runtime.Close()
	p := &shellProvisioner{url: runtime.URL}
	service := chat.New(ctx, store, p)
	handler := New(webassets.FS(), authentication, settings.New(store), "https://flora.test", service)
	call := func(method, path, body, session, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/api/chats/"+path, strings.NewReader(body))
		r.Header.Set("Origin", origin)
		r.Header.Set("Content-Type", "application/json")
		if session != "" {
			r.AddCookie(&http.Cookie{Name: cookieName, Value: session})
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	base := first.ID + "/shells"
	for _, method := range []string{"GET", "POST", "PUT", "DELETE"} {
		path := base
		if method == "PUT" || method == "DELETE" {
			path += "/anything"
		}
		if w := call(method, path, "{}", "", "https://flora.test"); w.Code != 401 {
			t.Fatalf("unauthenticated %s: %d", method, w.Code)
		}
	}
	if w := call("POST", base, "{}", token, "https://evil.test"); w.Code != 403 {
		t.Fatal("cross-origin creation accepted")
	}
	w := call("POST", base, "{}", token, "https://flora.test")
	var shell storage.Shell
	if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &shell) != nil {
		t.Fatal(w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "shell-container") || strings.Contains(w.Body.String(), "pty_") {
		t.Fatal("internal identity leaked")
	}
	for _, method := range []string{"PUT", "DELETE", "GET"} {
		suffix := ""
		if method == "GET" {
			suffix = "/connect"
		}
		w := call(method, other.ID+"/shells/"+shell.ID+suffix, `{"rows":24,"cols":80}`, token, "https://flora.test")
		if w.Code != 404 {
			t.Fatalf("cross-chat %s: %d %s", method, w.Code, w.Body.String())
		}
	}
	if w := call("PUT", base+"/"+shell.ID, `{"rows":0,"cols":501}`, token, "https://flora.test"); w.Code != 409 {
		t.Fatal("invalid resize accepted")
	}
	if w := call("PUT", base+"/"+shell.ID, `{"rows":24,"cols":80}`, token, "https://flora.test"); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	for range 7 {
		if w := call("POST", base, "{}", token, "https://flora.test"); w.Code != 201 {
			t.Fatal(w.Body.String())
		}
	}
	if w := call("POST", base, "{}", token, "https://flora.test"); w.Code != 409 {
		t.Fatal("unbounded shells")
	}
	until := time.Now().Add(time.Hour)
	if err := store.SetRuntimeLease(ctx, first.ID, until); err != nil {
		t.Fatal(err)
	}
	if w := call("GET", base, "", token, "https://flora.test"); w.Code != 200 || !strings.Contains(w.Body.String(), `"count":8`) {
		t.Fatal(w.Body.String())
	}
	savedUntil, err := store.RuntimeLease(ctx, first.ID)
	if err != nil || !savedUntil.Equal(until) {
		t.Fatal("shell extended lease")
	}
	for _, state := range []string{"unknown", "stopped", "missing"} {
		p.state = state
		w := call("GET", base, "", token, "https://flora.test")
		if state == "unknown" {
			if w.Code != 409 {
				t.Fatal("unknown runtime treated as exit")
			}
			continue
		}
		if w.Code != 200 || strings.Contains(w.Body.String(), `"state":"running"`) {
			t.Fatal(w.Body.String())
		}
		if w := call("POST", base, "{}", token, "https://flora.test"); w.Code != 409 {
			t.Fatal("created shell on stopped machine")
		}
	}
	p.state = ""
	if w := call("GET", base, "", token, "https://flora.test"); strings.Contains(w.Body.String(), `"state":"running"`) {
		t.Fatal("revived old shell")
	}
	if w := call("DELETE", base+"/"+shell.ID, "", token, "https://flora.test"); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if p.starts != 0 {
		t.Fatal("shell implicitly started a runtime")
	}
}
