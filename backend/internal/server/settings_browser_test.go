package server

import (
	"context"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/webassets"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestSettingsBrowser(t *testing.T) {
	if os.Getenv("FLORA_CHAT_BROWSER_TEST") != "1" {
		t.Skip("set FLORA_CHAT_BROWSER_TEST=1 to run Chromium")
	}
	store, svc, authentication, _, _, cleanup := chatAPI(t, true)
	defer cleanup()
	configuration := settings.New(store)
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
	srv := httptest.NewUnstartedServer(nil)
	origin := "https://" + srv.Listener.Addr().String()
	srv.Config.Handler = New(webassets.FS(), authentication, configuration, origin, svc)
	srv.StartTLS()
	defer srv.Close()
	script, err := filepath.Abs("../../../scripts/settings.browser.ts")
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
	p, err := store.Preferences(context.Background())
	if err != nil || p.CPUs != 3 || p.MessageBytes != 1024 || p.Sound {
		t.Fatal("browser settings not persisted", err)
	}
	c, err := store.Credentials(context.Background())
	if err != nil || c.ProviderKey != "rotated-fixture-key" || c.GitHubToken != "github_pat_test-secret" {
		t.Fatal("browser rotation lost credentials", err)
	}
}
