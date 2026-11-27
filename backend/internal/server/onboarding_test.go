package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/webassets"
)

func TestReadinessHandoffRechecksSavedConfiguration(t *testing.T) {
	store, chats, authentication, token, project, cleanup := chatAPI(t)
	defer cleanup()
	ctx := context.Background()
	state := storage.Onboarding{Step: "finish", ProjectID: project.ID}
	if err := store.SaveOnboarding(ctx, state); err != nil {
		t.Fatal(err)
	}
	configuration := settings.New(store)
	metadataOK, dockerOK, changeSelection := true, true, false
	configuration.Validate = func(context.Context, storage.Credentials) error {
		if !metadataOK {
			return &settings.ValidationError{Message: "Model access revoked. Update the connection."}
		}
		return nil
	}
	configuration.RuntimeDiagnostics = func(context.Context) []settings.Diagnostic {
		if changeSelection {
			changeSelection = false
			if err := store.SaveOnboarding(ctx, storage.Onboarding{Step: "project"}); err != nil {
				t.Fatal(err)
			}
		}
		return []settings.Diagnostic{{Name: "Docker", OK: dockerOK, Message: "Start Docker and retry."}, {Name: "Agent image", OK: true}, {Name: "Runtime", OK: true}}
	}
	app := New(webassets.FS(), authentication, configuration, "https://flora.test", chats)
	call := func(method, path, body, cookie, origin string, status int) []byte {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Origin", origin)
		r.Header.Set("Content-Type", "application/json")
		if cookie != "" {
			r.AddCookie(&http.Cookie{Name: cookieName, Value: cookie})
		}
		w := httptest.NewRecorder()
		app.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body)
		}
		if strings.Contains(w.Body.String(), "test-secret") {
			t.Fatal("credentials leaked")
		}
		return w.Body.Bytes()
	}
	for _, tc := range []struct {
		cookie, origin string
		status         int
	}{{"", "https://flora.test", 401}, {token, "https://evil.test", 403}} {
		call("POST", "/api/onboarding/readiness", `{}`, tc.cookie, tc.origin, tc.status)
	}
	check := func(finish bool) (settings.Readiness, storage.Onboarding) {
		t.Helper()
		body := `{}`
		if finish {
			body = `{"finish":true}`
		}
		raw := call("POST", "/api/onboarding/readiness", body, token, "https://flora.test", 200)
		var response struct {
			Readiness  settings.Readiness
			Onboarding storage.Onboarding
		}
		if err := json.Unmarshal(raw, &response); err != nil {
			t.Fatal(err)
		}
		return response.Readiness, response.Onboarding
	}
	ready, progress := check(false)
	if !ready.Ready || progress.Completed || ready.ProjectID != project.ID {
		t.Fatal("check changed completion", ready, progress)
	}
	// A passed screen cannot authorize handoff after access has been revoked.
	metadataOK = false
	ready, progress = check(true)
	if ready.Ready || progress.Completed {
		t.Fatal("stale metadata accepted", ready, progress)
	}
	metadataOK, dockerOK = true, false
	ready, progress = check(true)
	if ready.Ready || progress.Completed {
		t.Fatal("failed Docker accepted")
	}
	dockerOK, changeSelection = true, true
	ready, _ = check(true)
	if ready.Ready {
		t.Fatal("selection changed during checks")
	}
	if err := store.SaveOnboarding(ctx, state); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(storage.Onboarding{Step: "finish", Completed: true, ProjectID: project.ID})
	call("PUT", "/api/onboarding", string(raw), token, "https://flora.test", 400)
	ready, progress = check(true)
	if !ready.Ready || !progress.Completed || progress.ProjectID != project.ID {
		t.Fatal("recovery did not hand off selected project", ready, progress)
	}
	saved, err := store.Onboarding(ctx)
	if err != nil || !saved.Completed {
		t.Fatal("completion not saved", saved, err)
	}
	list, err := store.Chats(ctx)
	if err != nil || len(list) != 0 {
		t.Fatal("checks or handoff submitted work", list, err)
	}
}
