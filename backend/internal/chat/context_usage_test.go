package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/provisioning"
)

func TestContextLimitRetriesAndCachesRuntimeModel(t *testing.T) {
	f := newFixture(t)
	s, _, project := testService(t, f)
	c, _ := savedRecoveryTurn(t, s, project)
	raw := json.RawMessage(`{"info":{"id":"context","role":"assistant","providerID":"provider","modelID":"model","time":{"created":1,"completed":2},"tokens":{"total":1200}}}`)
	if err := s.Store.SaveUsageMessage(context.Background(), c.ID, c.SessionID, "", "", raw); err != nil {
		t.Fatal(err)
	}
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != "GET" || r.URL.Path != "/provider" {
			t.Errorf("unexpected runtime request %s %s", r.Method, r.URL.Path)
		}
		if requests == 1 {
			w.WriteHeader(503)
			return
		}
		fmt.Fprint(w, `{"all":[{"id":"wrong","models":{"model":{"limit":{"context":999}}}},{"id":"provider","models":{"model":{"limit":{"context":200000}}}}]}`)
	}))
	defer server.Close()
	rt := newRuntime(provisioning.Endpoint{URL: server.URL})
	for range 3 {
		s.captureContextLimit(context.Background(), rt, c)
	}
	u, err := s.Store.ChatContext(context.Background(), c.ID)
	if err != nil || u.Limit == nil || *u.Limit != 200000 || requests != 2 {
		t.Fatalf("runtime limit was not matched, retried and cached: %+v, requests=%d err=%v", u, requests, err)
	}
}
