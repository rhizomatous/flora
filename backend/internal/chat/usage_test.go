package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestUsageCollectsDescendantsOnceWithoutMixingTranscripts(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t)
	s, _, project := testService(t, f)
	c, accepted := savedRecoveryTurn(t, s, project)
	if err := s.Store.LinkRuntimeMessage(ctx, c.ID, accepted.ID, "user-root"); err != nil {
		t.Fatal(err)
	}
	var unavailable, foreign bool
	childCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Errorf("usage collection mutated runtime: %s", r.Method)
			w.WriteHeader(405)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/provider":
			fmt.Fprint(w, `{"all":[{"id":"provider","models":{"model":{"cost":{"input":1,"output":2}}}}]}`)
		case "/session/ses_one/children":
			if foreign {
				fmt.Fprint(w, `[{"id":"unrelated","parentID":"another-root"}]`)
			} else {
				fmt.Fprint(w, `[{"id":"child","parentID":"ses_one"}]`)
			}
		case "/session/child/message":
			childCalls++
			if unavailable {
				w.WriteHeader(503)
				return
			}
			fmt.Fprintf(w, `[{"info":{"id":"user-child","role":"user","time":{"created":120}}},%s]`, usageMessage("child", "user-child", 0.02, `{"type":"tool","state":{"time":{"start":130,"end":150},"metadata":{"sessionId":"grandchild"}}}`))
		case "/session/child/children":
			fmt.Fprint(w, `[{"id":"grandchild","parentID":"child"}]`)
		case "/session/grandchild/message":
			fmt.Fprintf(w, `[{"info":{"id":"user-grandchild","role":"user","time":{"created":140}}},%s]`, usageMessage("grandchild", "user-grandchild", 0.03, ""))
		case "/session/grandchild/children":
			fmt.Fprint(w, `[]`)
		default:
			t.Errorf("unexpected session access %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	rt := newRuntime(provisioning.Endpoint{URL: server.URL})
	history := []json.RawMessage{usageMessage("ses_one", "user-root", 0.01, `{"type":"tool","state":{"time":{"start":100,"end":200},"metadata":{"sessionId":"child"}}}`)}
	for range 3 {
		s.captureUsage(ctx, rt, c, history, nil)
	}
	check := func(partial bool) {
		t.Helper()
		u, err := s.Store.ChatUsage(ctx, c.ID)
		if err != nil || u.Steps != 3 || u.CostUSD == nil || *u.CostUSD != 0.06 || (u.Collection != "complete") != partial {
			t.Fatalf("incorrect tree total: %+v err=%v", u, err)
		}
	}
	check(false)
	messages, err := s.Store.Messages(ctx, c.ID)
	if err != nil || len(messages) != 1 {
		t.Fatal("usage collection inserted child messages into the main transcript")
	}
	unavailable = true
	s.captureUsage(ctx, rt, c, history, nil)
	check(true)
	unavailable = false
	// A fresh runtime client models lost in-memory collection state after recovery.
	rt = newRuntime(provisioning.Endpoint{URL: server.URL})
	s.captureUsage(ctx, rt, c, history, nil)
	check(false)
	foreign = true
	before := childCalls
	s.captureUsage(ctx, rt, c, history, nil)
	check(true)
	if childCalls != before {
		t.Fatal("traversed a child belonging to another parent")
	}
}

func usageMessage(session, parent string, cost float64, extra string) json.RawMessage {
	if extra != "" {
		extra = "," + extra
	}
	return json.RawMessage(fmt.Sprintf(`{"info":{"id":"same-id","sessionID":%q,"parentID":%q,"role":"assistant","providerID":"provider","modelID":"model","time":{"created":150,"completed":200}},"parts":[{"id":"same-step","type":"step-finish","cost":%v,"tokens":{"input":10,"output":20,"reasoning":0,"cache":{"read":0,"write":0}}}%s]}`, session, parent, cost, extra))
}

func TestUsageFailureDoesNotFailCompletedTurn(t *testing.T) {
	f := newFixture(t)
	s, _, project := testService(t, f)
	c, accepted := savedRecoveryTurn(t, s, project)
	f.mu.Lock()
	f.history = []json.RawMessage{json.RawMessage(`{"info":{"id":"user","role":"user"},"parts":[{"type":"text","text":"original input"}]}`), usageMessage("ses_one", "user", 0.01, "")}
	f.mu.Unlock()
	// Proxy ordinary history but reject optional accounting discovery.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/message") {
			f.mu.Lock()
			defer f.mu.Unlock()
			_ = json.NewEncoder(w).Encode(f.history)
			return
		}
		w.WriteHeader(503)
	}))
	defer server.Close()
	rt := newRuntime(provisioning.Endpoint{URL: server.URL})
	// A completed stop is execution evidence independently of accounting availability.
	raw := strings.Replace(string(f.history[1]), `"role":"assistant"`, `"role":"assistant","finish":"stop"`, 1)
	f.mu.Lock()
	f.history[1] = json.RawMessage(raw)
	f.mu.Unlock()
	id := ""
	complete := false
	failed, err := s.captureHistory(context.Background(), rt, c, nil, accepted.ID, &id, &complete, map[string]bool{}, map[string][32]byte{})
	if err != nil || failed || !complete {
		t.Fatalf("usage failure changed execution outcome: failed=%v complete=%v err=%v", failed, complete, err)
	}
	s.captureUsage(context.Background(), rt, c, f.history, nil)
	u, err := s.Store.ChatUsage(context.Background(), c.ID)
	if err != nil || u.Collection != "history_unavailable" || u.CostUSD == nil || *u.CostUSD != 0.01 {
		t.Fatalf("lost partial usage: %+v %v", u, err)
	}
}

func TestResumedSubagentKeepsUsageWithItsOriginalTurn(t *testing.T) {
	calls := []usageInvocation{{100, 200, "first-turn"}, {300, 0, "follow-up"}}
	for _, test := range []struct {
		created int64
		want    string
	}{{120, "first-turn"}, {320, "follow-up"}, {0, ""}, {250, ""}} {
		if got := invocationTurn(test.created, calls); got != test.want {
			t.Fatalf("child message created at %d: turn=%q, want %q", test.created, got, test.want)
		}
	}
	if got := invocationTurn(150, append(calls, usageInvocation{140, 180, "another-turn"})); got != "" {
		t.Fatal("ambiguous invocation was assigned to a turn")
	}
}

func TestFinishedChatUsageReconcilesAndRetriesWithoutSubmitting(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t)
	s, p, project := testService(t, f)
	s.usageRetryInterval = 0
	c, accepted := savedRecoveryTurn(t, s, project)
	if err := s.Store.Transition(ctx, c.ID, accepted.ID, storage.Idle, "Finished"); err != nil {
		t.Fatal(err)
	}
	var fail atomic.Bool
	fail.Store(true)
	var reads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads.Add(1)
		if r.Method != "GET" {
			t.Error("accounting sent a mutation")
			w.WriteHeader(405)
			return
		}
		switch r.URL.Path {
		case "/provider":
			fmt.Fprint(w, `{"all":[]}`)
		case "/session/ses_one/message":
			fmt.Fprintf(w, "[%s]", usageMessage("ses_one", "user", 0.01, ""))
		case "/session/ses_one/children":
			fmt.Fprint(w, `[{"id":"child","parentID":"ses_one"}]`)
		case "/session/child/message":
			if fail.Load() {
				w.WriteHeader(503)
				return
			}
			fmt.Fprintf(w, "[%s]", usageMessage("child", "child-user", 0.02, ""))
		case "/session/child/children":
			fmt.Fprint(w, `[]`)
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	p.url = server.URL
	if err := s.ReconcileUsage(ctx); err != nil {
		t.Fatal(err)
	}
	u, err := s.Store.ChatUsage(ctx, c.ID)
	if err != nil || u.Collection != "history_unavailable" || u.CostUSD == nil || *u.CostUSD != 0.01 {
		t.Fatalf("missing capture failure: %+v %v", u, err)
	}
	fail.Store(false)
	if err := s.ReconcileUsage(ctx); err != nil {
		t.Fatal(err)
	}
	u, err = s.Store.ChatUsage(ctx, c.ID)
	if err != nil || u.Collection != "complete" || u.Steps != 2 || *u.CostUSD != 0.03 {
		t.Fatalf("idle history was not reconciled: %+v %v", u, err)
	}
	before := reads.Load()
	if err := s.ReconcileUsage(ctx); err != nil {
		t.Fatal(err)
	}
	if reads.Load() != before {
		t.Fatal("unchanged settled chat was fetched again")
	}
	saved, err := s.Store.Chat(ctx, c.ID)
	if err != nil || saved.Status != storage.Idle || saved.ActiveMessageID != "" || p.starts.Load() != 0 || f.prompts.Load() != 0 {
		t.Fatal("usage reconciliation changed execution state")
	}
}

func TestUsageTraversalHasNoSharedTwoSecondDeadlineOrSessionLimit(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	f := newFixture(t)
	s, _, project := testService(t, f)
	c, _ := savedRecoveryTurn(t, s, project)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/provider" {
			fmt.Fprint(w, `{"all":[]}`)
			return
		}
		if r.URL.Path == "/session/ses_one/children" {
			children := []map[string]string{}
			for i := range 130 {
				children = append(children, map[string]string{"id": fmt.Sprintf("child-%d", i), "parentID": "ses_one"})
			}
			_ = json.NewEncoder(w).Encode(children)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/children") {
			fmt.Fprint(w, `[]`)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/message") {
			session := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/session/"), "/message")
			if session == "child-0" || session == "child-1" {
				select {
				case <-time.After(1100 * time.Millisecond):
				case <-r.Context().Done():
					return
				}
			}
			fmt.Fprintf(w, "[%s]", usageMessage(session, "user", 0.01, ""))
			return
		}
		t.Errorf("unexpected request %s", r.URL.Path)
	}))
	defer server.Close()
	rt := newRuntime(provisioning.Endpoint{URL: server.URL})
	s.captureUsage(ctx, rt, c, []json.RawMessage{usageMessage("ses_one", "user", 0.01, "")}, nil)
	u, err := s.Store.ChatUsage(ctx, c.ID)
	if err != nil || u.Collection != "complete" || u.Steps != 131 || u.CostUSD == nil || *u.CostUSD != 1.31 {
		t.Fatalf("large healthy tree was truncated: %+v %v", u, err)
	}
}

func TestUsageReconciliationDoesNotStartStoppedRuntime(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t)
	s, base, project := testService(t, f)
	c, accepted := savedRecoveryTurn(t, s, project)
	if err := s.Store.Transition(ctx, c.ID, accepted.ID, storage.Idle, "Finished"); err != nil {
		t.Fatal(err)
	}
	s.provisioner = &recoveryProvisioner{testProvisioner: base, err: &provisioning.ExecutionEndedError{Reason: "container stopped"}}
	if err := s.ReconcileUsage(ctx); err != nil {
		t.Fatal(err)
	}
	u, err := s.Store.ChatUsage(ctx, c.ID)
	if err != nil || u.Collection != "runtime_stopped" || base.starts.Load() != 0 || f.prompts.Load() != 0 {
		t.Fatalf("stopped runtime was not left alone: %+v %v", u, err)
	}
}
