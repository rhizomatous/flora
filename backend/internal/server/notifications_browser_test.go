package server

import (
	"context"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/webassets"
)

func TestChatBrowserNotifications(t *testing.T) {
	if os.Getenv("FLORA_CHAT_BROWSER_TEST") != "1" {
		t.Skip("set FLORA_CHAT_BROWSER_TEST=1 to run Chromium")
	}
	store, svc, authentication, _, project, cleanup := chatAPI(t, true)
	defer cleanup()
	image, harness := (&browserProvisioner{}).Identity()
	other, err := store.CreateChat(context.Background(), project.ID, "Other conversation", image, harness)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Transition(context.Background(), other.ID, "", storage.Idle, "Ready for input"); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewUnstartedServer(nil)
	origin := "https://" + srv.Listener.Addr().String()
	srv.Config.Handler = New(webassets.FS(), authentication, settings.New(store), origin, svc)
	srv.StartTLS()
	defer srv.Close()
	script, err := filepath.Abs("../../../scripts/notifications.browser.ts")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("node", script)
	cmd.Env = append(os.Environ(), "FLORA_BROWSER_URL="+srv.URL, "FLORA_OTHER_CHAT="+other.ID)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("browser: %v\n%s", err, out)
	}
	t.Log(string(out))
}
