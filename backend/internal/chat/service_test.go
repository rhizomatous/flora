package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

const testImage = "flora@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

type testProvisioner struct {
	store      *storage.Store
	url        string
	starts     atomic.Int32
	endpoints  atomic.Int32
	startError bool
}

func (p *testProvisioner) Identity() (string, string) { return testImage, "1.2.27" }
func (p *testProvisioner) Start(ctx context.Context, id string) (provisioning.Endpoint, error) {
	p.starts.Add(1)
	if p.startError {
		return provisioning.Endpoint{}, errors.New("secret setup diagnostics")
	}
	if err := p.store.BindRuntime(ctx, id, "container", ""); err != nil {
		return provisioning.Endpoint{}, err
	}
	return provisioning.Endpoint{URL: p.url, Username: "opencode", Password: "runtime_SECRET", ContainerID: "container"}, nil
}
func (p *testProvisioner) Endpoint(context.Context, string) (provisioning.Endpoint, error) {
	p.endpoints.Add(1)
	return provisioning.Endpoint{URL: p.url, Username: "opencode", Password: "runtime_SECRET", ContainerID: "container"}, nil
}
func (*testProvisioner) BeginActivity(string)                           {}
func (*testProvisioner) EndActivity(string)                             {}
func (*testProvisioner) Stop(context.Context, string) error             { return nil }
func (*testProvisioner) ConfirmInterrupt(context.Context, string) error { return nil }

// The HTTP fixture exercises the same authenticated streaming and synchronous
// prompt contract as OpenCode. Turn delivery remains blocked until released.
type runtimeFixture struct {
	server              *httptest.Server
	mu                  sync.Mutex
	history             []json.RawMessage
	events              chan string
	started             chan string
	release             chan bool
	prompts             atomic.Int32
	sessions            atomic.Int32
	question            bool
	transportLoss       bool
	promptStatus        int
	streamStop          chan struct{}
	noPromptHeaders     bool
	noRuntimeAcceptance bool
	hangAfterCompletion bool
	historyUnavailable  bool
	questionFailure     string
	questionPolls       atomic.Int32
	questionCompletions atomic.Int32
	questionInFlight    atomic.Int32
	questionMaxInFlight atomic.Int32
	busy                bool
	streams             atomic.Int32
	streamUnavailable   atomic.Bool
	connectedStreams    atomic.Int32
	questionReplies     atomic.Int32
	replyStarted        chan struct{}
	replyRelease        chan struct{}
}

func newFixture(t *testing.T) *runtimeFixture {
	f := &runtimeFixture{events: make(chan string, 50), started: make(chan string, 10), release: make(chan bool, 10), streamStop: make(chan struct{})}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, password, _ := r.BasicAuth()
		if user != "opencode" || password != "runtime_SECRET" {
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/config":
			fmt.Fprint(w, `{"model":"anthropic/model","permission":"allow"}`)
		case r.URL.Path == "/session":
			f.sessions.Add(1)
			fmt.Fprint(w, `{"id":"ses_one"}`)
		case r.URL.Path == "/session/status":
			f.mu.Lock()
			busy := f.busy
			f.mu.Unlock()
			if busy {
				fmt.Fprint(w, `{"ses_one":{"type":"busy"}}`)
			} else {
				fmt.Fprint(w, `{}`)
			}
		case r.URL.Path == "/instance/dispose":
			fmt.Fprint(w, `true`)
		case r.URL.Path == "/session/ses_one/abort":
			f.mu.Lock()
			f.question = false
			f.mu.Unlock()
			fmt.Fprint(w, `true`)
		case r.URL.Path == "/event":
			f.streams.Add(1)
			if f.streamUnavailable.Load() {
				w.WriteHeader(503)
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, ": connected\n\n")
			w.(http.Flusher).Flush()
			f.connectedStreams.Add(1)
			for {
				select {
				case <-r.Context().Done():
					return
				case <-f.streamStop:
					return
				case event := <-f.events:
					fmt.Fprintf(w, "data: %s\n\n", event)
					w.(http.Flusher).Flush()
				}
			}
		case r.URL.Path == "/question":
			f.mu.Lock()
			question, failure := f.question, f.questionFailure
			f.mu.Unlock()
			f.questionPolls.Add(1)
			active := f.questionInFlight.Add(1)
			for {
				previous := f.questionMaxInFlight.Load()
				if previous >= active || f.questionMaxInFlight.CompareAndSwap(previous, active) {
					break
				}
			}
			defer func() { f.questionInFlight.Add(-1); f.questionCompletions.Add(1) }()
			switch failure {
			case "status":
				w.WriteHeader(503)
				return
			case "invalid":
				fmt.Fprint(w, `[{"id":"que_one"}]`)
				return
			case "null":
				fmt.Fprint(w, `null`)
				return
			case "oversized":
				fmt.Fprint(w, `[]`+strings.Repeat(" ", maxQuestionSnapshotBytes))
				return
			case "hang":
				fmt.Fprint(w, `[`)
				w.(http.Flusher).Flush()
				<-r.Context().Done()
				return
			}
			if question {
				fmt.Fprint(w, `[{"id":"que_one","sessionID":"ses_one","questions":[{"question":"Continue?","header":"Choice","options":[{"label":"Yes","description":"Proceed"}]}]}]`)
			} else {
				fmt.Fprint(w, `[]`)
			}
		case r.URL.Path == "/question/que_one/reply":
			f.questionReplies.Add(1)
			if f.replyStarted != nil {
				close(f.replyStarted)
				select {
				case <-f.replyRelease:
				case <-r.Context().Done():
					return
				}
			}
			f.mu.Lock()
			f.question = false
			f.mu.Unlock()
			f.events <- `{"type":"question.replied","properties":{"sessionID":"ses_one","requestID":"que_one"}}`
			fmt.Fprint(w, `true`)
		case r.Method == "GET" && r.URL.Path == "/session/ses_one/message":
			f.mu.Lock()
			defer f.mu.Unlock()
			if f.historyUnavailable {
				w.WriteHeader(503)
				return
			}
			json.NewEncoder(w).Encode(f.history)
		case r.Method == "POST" && r.URL.Path == "/session/ses_one/message":
			if f.promptStatus != 0 {
				w.WriteHeader(f.promptStatus)
				fmt.Fprint(w, `{"error":"provider_SECRET unavailable model"}`)
				return
			}
			var in struct {
				MessageID string `json:"messageID"`
				System    string `json:"system"`
				Parts     []struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"parts"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Error(err)
			}
			if !strings.Contains(in.System, "commit") && !strings.Contains(in.System, "Commit") {
				t.Error("missing local commit guidance")
			}
			n := f.prompts.Add(1)
			in.MessageID = fmt.Sprintf("msg_runtime_%d", n)
			user, _ := json.Marshal(map[string]any{"info": map[string]string{"id": in.MessageID, "role": "user"}, "parts": in.Parts})
			f.mu.Lock()
			if !f.noRuntimeAcceptance {
				f.history = append(f.history, user)
			}
			f.mu.Unlock()
			f.started <- in.MessageID
			if !f.noPromptHeaders {
				w.WriteHeader(200)
				w.(http.Flusher).Flush()
			}
			var fail bool
			select {
			case <-r.Context().Done():
				return
			case fail = <-f.release:
			}
			if f.transportLoss {
				conn, _, _ := w.(http.Hijacker).Hijack()
				conn.Close()
				return
			}
			errorField := ""
			if fail {
				errorField = `,"error":{"name":"APIError","data":{"message":"provider_SECRET failed"}}`
			}
			m := json.RawMessage(fmt.Sprintf(`{"info":{"id":%q,"parentID":%q,"role":"assistant","providerID":"anthropic","modelID":"model","finish":"stop","time":{"completed":1}%s},"parts":[{"type":"text","text":"Done provider_SECRET runtime_SECRET github_pat_SECRET"},{"type":"tool","tool":"bash","state":{"status":"completed","input":{"command":"pwd"},"output":"/workspace\n"}}]}`, "assistant_"+in.MessageID, in.MessageID, errorField))
			f.mu.Lock()
			f.history = append(f.history, m)
			f.mu.Unlock()
			if f.hangAfterCompletion {
				<-r.Context().Done()
				return
			}
			w.Write(m)
		default:
			t.Errorf("unexpected runtime route %s %s", r.Method, r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(f.server.Close)
	return f
}

func testService(t *testing.T, f *runtimeFixture) (*Service, *testProvisioner, storage.Project) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cancel(); store.Close() })
	if err := store.SaveCredentials(ctx, storage.Credentials{Provider: "anthropic", Model: "model", ProviderKey: "provider_SECRET", GitHubToken: "github_pat_SECRET"}); err != nil {
		t.Fatal(err)
	}
	p, err := store.CreateProject(ctx, "Project", storage.Configuration{Repositories: []storage.Repository{{Name: "core", URL: "https://github.com/example/core", BaseBranch: "main", Role: "core"}}})
	if err != nil {
		t.Fatal(err)
	}
	provisioner := &testProvisioner{store: store, url: f.server.URL}
	return New(ctx, store, provisioner), provisioner, p
}

func waitStatus(t *testing.T, s *Service, id string, status storage.Status) storage.Chat {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	var c storage.Chat
	for time.Now().Before(deadline) {
		var err error
		c, err = s.Store.Chat(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		if c.Status == status {
			return c
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("status %s, wanted %s: %s", c.Status, status, c.StatusReason)
	return c
}

func TestPersistentTurnsQuestionsAndDeduplication(t *testing.T) {
	f := newFixture(t)
	s, p, project := testService(t, f)
	ctx := context.Background()
	c, err := s.Create(ctx, project.ID, "A chat", "create-one", "First message ✿")
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-f.started:
	case <-time.After(5 * time.Second):
		t.Fatal("prompt did not start")
	}
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			retry, err := s.Create(ctx, project.ID, "A chat", "create-one", "First message ✿")
			if err != nil || retry.ID != c.ID {
				t.Errorf("creation retry: %v", err)
			}
			if _, err := s.Submit(ctx, c.ID, "new", "not queued"); !errors.Is(err, storage.ErrActive) {
				t.Errorf("active submit: %v", err)
			}
		})
	}
	wg.Wait()
	if _, err := s.Create(ctx, project.ID, "Changed", "create-one", "different"); !errors.Is(err, storage.ErrConflict) {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.question = true
	f.mu.Unlock()
	largeOutput := strings.Repeat("output line\n", 12000)
	largeEvent, _ := json.Marshal(map[string]any{"type": "command.output", "properties": map[string]string{"sessionID": "ses_one", "output": largeOutput}})
	f.events <- string(largeEvent)
	f.events <- `{"type":"question.asked","properties":{"sessionID":"ses_one","id":"que_one","secret":"provider_SECRET"}}`
	waitStatus(t, s, c.ID, storage.Waiting)
	questions, err := s.Questions(ctx, c.ID)
	if err != nil || len(questions) != 1 {
		t.Fatalf("questions: %v %v", questions, err)
	}
	if err := s.Reply(ctx, c.ID, "another-chat-question", [][]string{{"Yes"}}); !errors.Is(err, storage.ErrStale) {
		t.Fatal(err)
	}
	if err := s.Reply(ctx, c.ID, "que_one", [][]string{{"Yes"}}); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, s, c.ID, storage.Working)
	f.release <- false
	waitStatus(t, s, c.ID, storage.Idle)
	a, err := s.Submit(ctx, c.ID, "create-one", "First message ✿")
	if err != nil || !a.Duplicate {
		t.Fatal("completed acceptance retry", err)
	}
	if _, err := s.Submit(ctx, c.ID, "followup", "Continue the same workspace"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-f.started:
	case <-time.After(5 * time.Second):
		t.Fatal("follow-up did not start")
	}
	f.release <- false
	waitStatus(t, s, c.ID, storage.Idle)
	if p.starts.Load() != 1 || p.endpoints.Load() < 1 || f.sessions.Load() != 1 || f.prompts.Load() != 2 {
		t.Fatalf("starts=%d endpoints=%d sessions=%d prompts=%d", p.starts.Load(), p.endpoints.Load(), f.sessions.Load(), f.prompts.Load())
	}
	messages, err := s.Store.Messages(ctx, c.ID)
	if err != nil || len(messages) != 4 {
		t.Fatalf("messages %d: %v", len(messages), err)
	}
	if messages[0].RuntimeMessageID == "" || messages[2].RuntimeMessageID == "" {
		t.Fatal("missing durable user links")
	}
	rows, _ := s.Store.Activities(ctx, c.ID, 0, 1000)
	foundLarge := false
	firstSnapshots := 0
	for _, row := range rows {
		if strings.Contains(string(row.Payload), "SECRET") {
			t.Fatalf("secret in %s", row.Kind)
		}
		if row.Kind == "message.runtime" && strings.Contains(string(row.Payload), "assistant_msg_runtime_1") {
			firstSnapshots++
		}
		if row.Kind == "runtime.command.output" {
			var event struct {
				Properties struct {
					Output string `json:"output"`
				} `json:"properties"`
			}
			json.Unmarshal(row.Payload, &event)
			foundLarge = event.Properties.Output == largeOutput
		}
	}
	if !foundLarge {
		t.Fatal("large command output was not retained in full")
	}
	if firstSnapshots != 1 {
		t.Fatalf("follow-up rewrote the unchanged first response %d times", firstSnapshots)
	}
	if messages[1].Model != "model" || messages[1].Provider != "anthropic" || !strings.Contains(string(messages[1].Payload), "/workspace") {
		t.Fatal("lost full activity/model metadata")
	}
}

func TestPromptNonresponseKeepsDeliveryUncertain(t *testing.T) {
	f := newFixture(t)
	f.noPromptHeaders = true
	f.noRuntimeAcceptance = true
	s, _, p := testService(t, f)
	s.promptAdmissionTimeout = 40 * time.Millisecond
	c, err := s.Create(context.Background(), p.ID, "Chat", "first", "Do work")
	if err != nil {
		t.Fatal(err)
	}
	<-f.started
	c = waitStatus(t, s, c.ID, storage.Waiting)
	if !strings.Contains(c.StatusReason, "uncertain") || c.ActiveMessageID == "" {
		t.Fatal("timeout cleared accepted work")
	}
	a, err := s.Submit(context.Background(), c.ID, "first", "Do work")
	if err != nil || !a.Duplicate || f.prompts.Load() != 1 {
		t.Fatal("timeout resent the accepted prompt")
	}
	if _, err := s.Submit(context.Background(), c.ID, "next", "New work"); !errors.Is(err, storage.ErrActive) {
		t.Fatal(err)
	}
}

func TestCompletedHistoryDoesNotLeavePromptTransportHanging(t *testing.T) {
	f := newFixture(t)
	f.noPromptHeaders = true
	f.hangAfterCompletion = true
	s, _, p := testService(t, f)
	s.promptCompletionTimeout = 40 * time.Millisecond
	c, err := s.Create(context.Background(), p.ID, "Chat", "first", "Do work")
	if err != nil {
		t.Fatal(err)
	}
	<-f.started
	f.release <- false
	c = waitStatus(t, s, c.ID, storage.Waiting)
	if c.ActiveMessageID == "" || !strings.Contains(c.StatusReason, "uncertain") || f.prompts.Load() != 1 {
		t.Fatal("hung completion was resent or treated as confirmed idle")
	}
	messages, _ := s.Store.Messages(context.Background(), c.ID)
	if len(messages) != 2 {
		t.Fatal("lost the saved final snapshot on transport timeout")
	}
}

func TestUnavailableCaptureDoesNotLeaveQuestionTransportHanging(t *testing.T) {
	f := newFixture(t)
	f.noPromptHeaders = true
	s, _, p := testService(t, f)
	s.promptAdmissionTimeout = 300 * time.Millisecond
	c, err := s.Create(context.Background(), p.ID, "Chat", "first", "Inspect")
	if err != nil {
		t.Fatal(err)
	}
	<-f.started
	f.mu.Lock()
	f.historyUnavailable = true
	f.mu.Unlock()
	f.events <- `{"type":"question.asked","properties":{"sessionID":"ses_one","id":"que_one","questions":[]}}`
	waitStatus(t, s, c.ID, storage.Waiting)
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		current, _ := s.Store.Chat(context.Background(), c.ID)
		if strings.Contains(current.StatusReason, "uncertain") {
			if current.ActiveMessageID == "" || f.prompts.Load() != 1 {
				t.Fatal("lost accepted identity or resent work")
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("unavailable capture left the question HTTP worker hanging")
}

func TestPinnedSessionErrorAttribution(t *testing.T) {
	for _, identified := range []bool{false, true} {
		t.Run(fmt.Sprint(identified), func(t *testing.T) {
			f := newFixture(t)
			s, _, p := testService(t, f)
			c, err := s.Create(context.Background(), p.ID, "Chat", "first", "Inspect")
			if err != nil {
				t.Fatal(err)
			}
			<-f.started
			properties := map[string]any{"error": map[string]any{"name": "APIError", "data": map[string]any{"message": "provider rejected", "isRetryable": false, "statusCode": 401}}}
			if identified {
				properties["sessionID"] = "ses_one"
			}
			b, _ := json.Marshal(map[string]any{"type": "session.error", "properties": properties})
			f.events <- string(b)
			// A subsequent same-session marker proves the earlier event was consumed.
			f.events <- `{"type":"session.status","properties":{"sessionID":"ses_one","status":{"type":"retry","attempt":1,"message":"retrying","next":123}}}`
			waitStatus(t, s, c.ID, storage.Waiting)
			f.release <- false
			want := storage.Idle
			if identified {
				want = storage.Failed
			}
			waitStatus(t, s, c.ID, want)
		})
	}
}

func TestProviderFailureDoesNotPoisonNextTurn(t *testing.T) {
	f := newFixture(t)
	s, _, project := testService(t, f)
	c, err := s.Create(context.Background(), project.ID, "Chat", "first", "Try")
	if err != nil {
		t.Fatal(err)
	}
	<-f.started
	f.release <- true
	waitStatus(t, s, c.ID, storage.Failed)
	if _, err := s.Submit(context.Background(), c.ID, "second", "Try again"); err != nil {
		t.Fatal(err)
	}
	<-f.started
	f.release <- false
	waitStatus(t, s, c.ID, storage.Idle)
}

func TestUncertainDeliveryNeverResends(t *testing.T) {
	f := newFixture(t)
	f.transportLoss = true
	s, _, project := testService(t, f)
	c, err := s.Create(context.Background(), project.ID, "Chat", "first", "Do work")
	if err != nil {
		t.Fatal(err)
	}
	<-f.started
	f.release <- false
	waitStatus(t, s, c.ID, storage.Waiting)
	a, err := s.Submit(context.Background(), c.ID, "first", "Do work")
	if err != nil || !a.Duplicate || f.prompts.Load() != 1 {
		t.Fatal("uncertain turn resent")
	}
	if _, err := s.Submit(context.Background(), c.ID, "next", "Unsafe new work"); !errors.Is(err, storage.ErrActive) {
		t.Fatal(err)
	}
}

func TestPreparationFailureDoesNotDeliver(t *testing.T) {
	f := newFixture(t)
	s, p, project := testService(t, f)
	p.startError = true
	c, err := s.Create(context.Background(), project.ID, "Chat", "first", "Do work")
	if err != nil {
		t.Fatal(err)
	}
	c = waitStatus(t, s, c.ID, storage.Failed)
	if strings.Contains(c.StatusReason, "secret") || f.prompts.Load() != 0 {
		t.Fatal("unsafe preparation failure")
	}
}

func TestRuntimeRejectionIsVisibleFailure(t *testing.T) {
	f := newFixture(t)
	f.promptStatus = 400
	s, _, p := testService(t, f)
	c, err := s.Create(context.Background(), p.ID, "Chat", "first", "Unavailable model")
	if err != nil {
		t.Fatal(err)
	}
	c = waitStatus(t, s, c.ID, storage.Failed)
	if !strings.Contains(c.StatusReason, "HTTP 400") || strings.Contains(c.StatusReason, "SECRET") {
		t.Fatal("missing safe runtime rejection explanation")
	}
}

func TestRuntimeStreamGapRetainsFinalHistory(t *testing.T) {
	f := newFixture(t)
	s, _, p := testService(t, f)
	c, err := s.Create(context.Background(), p.ID, "Chat", "first", "Work through disconnect")
	if err != nil {
		t.Fatal(err)
	}
	<-f.started
	close(f.streamStop)
	deadline := time.Now().Add(3 * time.Second)
	found := false
	for time.Now().Before(deadline) {
		rows, err := s.Store.Activities(context.Background(), c.ID, 0, 1000)
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range rows {
			if row.Kind == "capture.gap" {
				found = true
			}
		}
		if found {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !found {
		t.Fatal("runtime disconnect was not recorded")
	}
	f.release <- false
	waitStatus(t, s, c.ID, storage.Idle)
	messages, err := s.Store.Messages(context.Background(), c.ID)
	if err != nil || len(messages) != 2 || f.prompts.Load() != 1 {
		t.Fatal("lost history or resent message after gap")
	}
}
