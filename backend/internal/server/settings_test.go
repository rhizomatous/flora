package server

import (
	"context"
	"encoding/json"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/webassets"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSettingsAPIBoundsAndDiagnostics(t *testing.T) {
	store, svc, authentication, value, project, cleanup := chatAPI(t)
	defer cleanup()
	configuration := settings.New(store)
	configuration.MaxRunningOverride = 4
	calls := 0
	configuration.Validate = func(context.Context, storage.Credentials) error { calls++; return nil }
	configuration.RuntimeDiagnostics = func(context.Context) []settings.Diagnostic {
		return []settings.Diagnostic{{Name: "Docker", Message: "Start Docker and check socket permissions."}}
	}
	app := New(webassets.FS(), authentication, configuration, "https://flora.test", svc)
	call := func(method, path, body, origin, cookie string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", origin)
		if cookie != "" {
			r.AddCookie(&http.Cookie{Name: cookieName, Value: cookie})
		}
		w := httptest.NewRecorder()
		app.ServeHTTP(w, r)
		return w
	}
	for _, path := range []string{"/api/settings", "/api/settings/diagnostics"} {
		if w := call("POST", path, "{}", "https://flora.test", ""); w.Code != 401 {
			t.Fatal("unauthenticated settings allowed", w.Code)
		}
		if w := call("POST", path, "{}", "https://other.test", value); w.Code != 403 {
			t.Fatal("cross-site settings allowed", w.Code)
		}
	}
	for _, raw := range []string{`{"preferences":{"maxRunning":0}}`, `{"preferences":{"maxRunning":1.5}}`, `{"preferences":{"messageBytes":999999999999999999999}}`, `{"preferences":{"unexpected":1}}`, `{"providerKey":"bad\nkey"}`, `{"model":"other"}`} {
		w := call("PUT", "/api/settings", raw, "https://flora.test", value)
		if w.Code != 400 {
			t.Fatal("bad settings accepted", raw, w.Code)
		}
	}
	p := storage.DefaultPreferences()
	p.MessageBytes = 1024
	p.SessionSeconds = 3600
	p.MaxRunning = 2
	raw, _ := json.Marshal(settings.Input{Preferences: &p})
	w := call("PUT", "/api/settings", string(raw), "https://flora.test", value)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if calls != 0 {
		t.Fatal("limits-only save contacted vendors")
	}
	var view settings.View
	if err := json.Unmarshal(w.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if view.Preferences != p || view.MaxRunningOverride != 4 {
		t.Fatal("settings response missing saved limits or override")
	}
	w = call("POST", "/api/settings/diagnostics", "{}", "https://flora.test", value)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "socket permissions") || calls != 1 || strings.Contains(w.Body.String(), "test-secret") {
		t.Fatal("unsafe diagnostics", w.Code, w.Body.String())
	}
	message := `{"requestID":"too-big","title":"Big","text":"` + strings.Repeat("é", 513) + `"}`
	w = call("POST", "/api/projects/"+project.ID+"/chats", message, "https://flora.test", value)
	if w.Code != 400 {
		t.Fatal("oversized UTF-8 reached creation", w.Code)
	}
	chats, err := store.Chats(context.Background())
	if err != nil || len(chats) != 0 {
		t.Fatal("oversized input was saved")
	}
	w = call("POST", "/api/auth/login", `{"password":"browser test password"}`, "https://flora.test", "")
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || cookies[0].MaxAge < 3598 || cookies[0].MaxAge > 3600 || time.Until(cookies[0].Expires) > time.Hour {
		t.Fatal("cookie ignored configured absolute lifetime")
	}
}
