package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"github.com/rhizomatous/flora/backend/internal/webassets"
)

func TestPublicChatReferencesAndLegacyAPI(t *testing.T) {
	store, svc, authentication, token, project, cleanup := chatAPI(t)
	defer cleanup()
	server := httptest.NewUnstartedServer(nil)
	origin := "http://" + server.Listener.Addr().String()
	server.Config.Handler = New(webassets.FS(), authentication, settings.New(store), origin, svc)
	server.Start()
	defer server.Close()
	call := func(method, path, body string, status int) (http.Header, []byte) {
		t.Helper()
		req, err := http.NewRequest(method, server.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.AddCookie(&http.Cookie{Name: cookieName, Value: token})
		req.Header.Set("Origin", origin)
		req.Header.Set("Content-Type", "application/json")
		res, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		raw, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != status {
			t.Fatalf("%s %s: %d %s", method, path, res.StatusCode, raw)
		}
		return res.Header, raw
	}
	body := `{"title":"Canonical chat","requestID":"canonical-create","text":"First prompt"}`
	headers, raw := call("POST", "/api/projects/"+project.ID+"/chats", body, 202)
	var c storage.Chat
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	if c.PublicID != "FLORA-1" || headers.Get("Location") != "/api/chats/FLORA-1" {
		t.Fatalf("missing canonical response: %s %v", raw, headers)
	}
	_, raw = call("POST", "/api/projects/"+project.ID+"/chats", body, 202)
	var retry storage.Chat
	json.Unmarshal(raw, &retry)
	if retry.ID != c.ID || retry.PublicID != c.PublicID {
		t.Fatal("retry changed identity")
	}
	for _, reference := range []string{c.ID, c.PublicID} {
		_, raw = call("GET", "/api/chats/"+reference, "", 200)
		var detail struct {
			Chat storage.Chat `json:"chat"`
		}
		if err := json.Unmarshal(raw, &detail); err != nil {
			t.Fatal(err)
		}
		if detail.Chat.ID != c.ID || detail.Chat.PublicID != c.PublicID {
			t.Fatal("lookup changed identity")
		}
		call("GET", "/api/models?chat="+reference, "", 200)
		call("GET", "/api/chats/"+reference+"/runtime", "", 200)
	}
	_, raw = call("PATCH", "/api/chats/"+c.PublicID, `{"title":"Renamed","archived":true,"revision":0}`, 200)
	var saved storage.Chat
	json.Unmarshal(raw, &saved)
	if saved.PublicID != c.PublicID || saved.ID != c.ID {
		t.Fatal("organization changed identity")
	}
	call("POST", "/api/chats/read", fmt.Sprintf(`{"observed":[{"chatID":%q,"revision":0}]}`, c.PublicID), 200)
	_, raw = call("GET", "/api/projects/"+project.ID+"/context?kind=chat&query=flora-1", "", 200)
	if !strings.Contains(string(raw), c.PublicID) {
		t.Fatalf("public search missing chat: %s", raw)
	}
	call("GET", "/api/chats/FLORA-01", "", 404)
	call("GET", "/api/chats/FLORA-999999", "", 404)
	call("GET", "/api/chats/FLORA-1/unknown", "", 404)
}
