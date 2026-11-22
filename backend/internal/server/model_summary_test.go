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

func TestReportedModelAPIsWithoutRuntime(t *testing.T) {
	store, _, authentication, token, project, cleanup := chatAPI(t)
	defer cleanup()
	ctx := context.Background()
	c, err := store.CreateChat(ctx, project.ID, "Saved model", "flora@sha256:"+strings.Repeat("a", 64), "1")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.BindRuntime(ctx, c.ID, "stopped-container", "main"); err != nil {
		t.Fatal(err)
	}
	raw := json.RawMessage(`{"info":{"id":"response","role":"assistant","providerID":"reported-provider","modelID":"reported-model","time":{"created":1,"completed":2}},"parts":[]}`)
	if err = store.SaveUsageMessage(ctx, c.ID, "main", "", "", raw); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewUnstartedServer(nil)
	server.Config.Handler = New(webassets.FS(), authentication, settings.New(store), "http://"+server.Listener.Addr().String())
	server.Start()
	defer server.Close()
	for _, path := range []string{"/api/chats", "/api/chats/" + c.ID, "/api/notifications"} {
		req, _ := http.NewRequest("GET", server.URL+path, nil)
		req.AddCookie(&http.Cookie{Name: cookieName, Value: token})
		res, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var body json.RawMessage
		err = json.NewDecoder(res.Body).Decode(&body)
		res.Body.Close()
		if err != nil || res.StatusCode != 200 {
			t.Fatalf("%s: %d %s %v", path, res.StatusCode, body, err)
		}
		var chats []chatView
		switch path {
		case "/api/chats":
			err = json.Unmarshal(body, &chats)
		case "/api/notifications":
			var feed struct {
				Chats []chatView `json:"chats"`
			}
			err = json.Unmarshal(body, &feed)
			chats = feed.Chats
		default:
			var detail struct {
				Chat chatView `json:"chat"`
			}
			err = json.Unmarshal(body, &detail)
			chats = []chatView{detail.Chat}
		}
		if err != nil || len(chats) != 1 || chats[0].ReportedModel == nil || chats[0].ReportedModel.Latest == nil || *chats[0].ReportedModel.Latest != (storage.ReportedModel{Provider: "reported-provider", Model: "reported-model"}) {
			t.Fatalf("%s did not expose the saved identity: %s (%v)", path, body, err)
		}
	}
}
