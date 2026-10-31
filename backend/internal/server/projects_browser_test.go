package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/projects"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/webassets"
)

func TestProjectsBrowser(t *testing.T) {
	if os.Getenv("FLORA_CHAT_BROWSER_TEST") != "1" {
		t.Skip("set FLORA_CHAT_BROWSER_TEST=1 to run Chromium")
	}
	store, svc, authentication, _, _, cleanup := chatAPI(t)
	defer cleanup()
	validation := projects.New(store)
	validation.Client.Transport = projectTransport(func(r *http.Request) (*http.Response, error) {
		code := 200
		if strings.HasSuffix(r.URL.Path, "/branches/missing") {
			code = 404
		}
		return &http.Response{StatusCode: code, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"default_branch":"main"}`))}, nil
	})
	srv := httptest.NewUnstartedServer(nil)
	origin := "https://" + srv.Listener.Addr().String()
	a := &api{auth: authentication, projects: validation, origin: origin}
	mux := http.NewServeMux()
	a.projectRoutes(mux)
	projectHandler := a.protect(mux)
	app := New(webassets.FS(), authentication, settings.New(store), origin, svc)
	srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/projects") {
			projectHandler.ServeHTTP(w, r)
			return
		}
		app.ServeHTTP(w, r)
	})
	srv.StartTLS()
	defer srv.Close()
	script, err := filepath.Abs("../../../scripts/projects.browser.mjs")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("node", script)
	cmd.Env = append(os.Environ(), "FLORA_BROWSER_URL="+srv.URL)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("browser: %v\n%s", err, out)
	}
	t.Log(string(out))
}
