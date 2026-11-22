package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/webassets"
)

func TestEnvironmentAPISecretPresenceActionsAndImmutableChats(t *testing.T) {
	store, svc, authentication, cookie, project, cleanup := chatAPI(t)
	defer cleanup()
	app := New(webassets.FS(), authentication, settings.New(store), "https://flora.test", svc)
	call := func(method, path, body string, authenticated bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Origin", "https://flora.test")
		r.Header.Set("Content-Type", "application/json")
		if authenticated {
			r.AddCookie(&http.Cookie{Name: cookieName, Value: cookie})
		}
		w := httptest.NewRecorder()
		app.ServeHTTP(w, r)
		return w
	}
	path := "/api/projects/" + project.ID + "/environment"
	if w := call("GET", path, "", false); w.Code != 401 {
		t.Fatal("environment metadata accessible without login")
	}
	for _, scope := range []string{"/api/settings/environment", path} {
		w := call("PATCH", scope, `[{"name":"SERVICE_TOKEN","action":"replace","secret":true,"value":"fixture_api_secret_124"}]`, true)
		if w.Code != 200 || strings.Contains(w.Body.String(), "fixture_api_secret_124") || !strings.Contains(w.Body.String(), `"secret":true`) {
			t.Fatal("secret API did not return presence only")
		}
		w = call("PATCH", scope, `[{"name":"SERVICE_TOKEN","action":"replace","secret":true,"value":""}]`, true)
		if w.Code != 400 {
			t.Fatal("blank secret replacement succeeded")
		}
		w = call("PATCH", scope, `[{"name":"SERVICE_TOKEN","action":"keep","secret":true}]`, true)
		if w.Code != 200 {
			t.Fatal("keep secret failed")
		}
	}
	preview := call("POST", path+"/effective", `[{"name":"SERVICE_TOKEN","action":"keep","secret":true}]`, true)
	if preview.Code != 200 || strings.Contains(preview.Body.String(), "fixture_api_secret_124") {
		t.Fatal("effective preview exposed secret")
	}
	for _, input := range []string{`[{"name":"PATH","action":"set","value":"fixture_sensitive_error","secret":false}]`, `[{"name":"TOKEN","action":"replace","value":"fixture_sensitive_error","secret":false}]`} {
		w := call("PATCH", path, input, true)
		if w.Code != 400 || strings.Contains(w.Body.String(), "fixture_sensitive_error") {
			t.Fatal("validation exposed request value")
		}
	}
	existing, err := store.CreateChat(context.Background(), project.ID, "Environment", "flora@sha256:"+strings.Repeat("a", 64), "1.2.27")
	if err != nil {
		t.Fatal(err)
	}
	w := call("PATCH", "/api/chats/"+existing.ID+"/environment", `[]`, true)
	if w.Code != 405 {
		t.Fatal("existing chat environment accepts mutation")
	}

	w = call("PATCH", path, `[{"name":"SERVICE_TOKEN","action":"remove","secret":true}]`, true)
	if w.Code != 200 || strings.Contains(w.Body.String(), "SERVICE_TOKEN") {
		t.Fatal("explicit removal failed")
	}
}
