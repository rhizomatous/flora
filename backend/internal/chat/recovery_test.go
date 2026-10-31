package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func savedRecoveryTurn(t *testing.T, s *Service, project storage.Project) (storage.Chat, storage.Message) {
	t.Helper()
	ctx := context.Background()
	c, err := s.Store.CreateChat(ctx, project.ID, "Recovery", testImage, "1.2.27")
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.Store.AcceptMessage(ctx, c.ID, "accepted", "original input")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Store.BindRuntime(ctx, c.ID, "container", "ses_one"); err != nil {
		t.Fatal(err)
	}
	c, _ = s.Store.Chat(ctx, c.ID)
	return c, a.Message
}

func TestRecoveryReconnectsWithoutSubmitting(t *testing.T) {
	for _, linked := range []bool{false, true} {
		t.Run(fmt.Sprint("linked=", linked), func(t *testing.T) {
			f := newFixture(t)
			original, p, project := testService(t, f)
			c, message := savedRecoveryTurn(t, original, project)
			if linked {
				if err := original.Store.LinkRuntimeMessage(context.Background(), c.ID, message.ID, "msg_original"); err != nil {
					t.Fatal(err)
				}
			}
			f.mu.Lock()
			f.busy = true
			f.history = []json.RawMessage{json.RawMessage(`{"info":{"id":"msg_original","role":"user"},"parts":[{"type":"text","text":"original input"}]}`)}
			f.mu.Unlock()
			ctx, cancel := context.WithCancel(context.Background())
			recovered := New(ctx, original.Store, p)
			defer func() { cancel(); _ = recovered.quiesce(context.Background(), c.ID) }()
			var wg sync.WaitGroup
			for range 10 {
				wg.Go(func() {
					if err := recovered.Reconcile(ctx); err != nil {
						t.Error(err)
					}
				})
			}
			wg.Wait()
			deadline := time.Now().Add(3 * time.Second)
			for !recovered.monitoredTurn(c.ID, message.ID) && time.Now().Before(deadline) {
				time.Sleep(time.Millisecond)
			}
			f.mu.Lock()
			f.history = append(f.history, json.RawMessage(`{"info":{"id":"assistant_original","role":"assistant","parentID":"msg_original","finish":"stop","time":{"completed":1}},"parts":[{"type":"text","text":"recovered provider_SECRET"}]}`))
			f.busy = false
			f.mu.Unlock()
			waitStatus(t, recovered, c.ID, storage.Idle)
			if f.prompts.Load() != 0 || f.sessions.Load() != 0 || p.starts.Load() != 0 {
				t.Fatal("reconciliation mutated runtime execution")
			}
			messages, _ := original.Store.Messages(ctx, c.ID)
			if len(messages) != 2 || messages[0].RuntimeMessageID != "msg_original" || strings.Contains(messages[1].Text, "provider_SECRET") {
				t.Fatalf("incorrect recovered messages: %+v", messages)
			}
			rows, _ := original.Store.Activities(ctx, c.ID, 0, 1000)
			gaps := 0
			for _, row := range rows {
				if row.Kind == "capture.gap" {
					gaps++
				}
			}
			if gaps != 1 {
				t.Fatalf("got %d capture gaps", gaps)
			}
			duplicate, err := recovered.Submit(ctx, c.ID, "accepted", "original input")
			if err != nil || !duplicate.Duplicate || f.prompts.Load() != 0 {
				t.Fatal("duplicate request was redelivered")
			}
		})
	}
}

type recoveryProvisioner struct {
	*testProvisioner
	mu  sync.Mutex
	err error
}

func (p *recoveryProvisioner) Endpoint(ctx context.Context, id string) (provisioning.Endpoint, error) {
	p.mu.Lock()
	err := p.err
	p.mu.Unlock()
	if err != nil {
		return provisioning.Endpoint{}, err
	}
	return p.testProvisioner.Endpoint(ctx, id)
}

func TestRecoveryDeadOrUnavailableExecution(t *testing.T) {
	for _, reason := range []string{"connection unavailable", "container crash exit 1", "Docker reports out of memory", "host reboot: container exited", "container missing"} {
		t.Run(reason, func(t *testing.T) {
			f := newFixture(t)
			original, base, project := testService(t, f)
			c, _ := savedRecoveryTurn(t, original, project)
			var endpointErr error = &provisioning.ExecutionEndedError{Reason: reason}
			target := storage.Failed
			if reason == "connection unavailable" {
				endpointErr = errors.New(reason)
				target = storage.Waiting
			}
			p := &recoveryProvisioner{testProvisioner: base, err: endpointErr}
			ctx, cancel := context.WithCancel(context.Background())
			recovered := New(ctx, original.Store, p)
			defer func() { cancel(); _ = recovered.quiesce(context.Background(), c.ID) }()
			if err := recovered.Reconcile(ctx); err != nil {
				t.Fatal(err)
			}
			current := waitStatus(t, recovered, c.ID, target)
			if !strings.Contains(strings.ToLower(current.StatusReason), "external effects") {
				t.Fatal("missing external effects uncertainty")
			}
			if target == storage.Waiting && current.ActiveMessageID == "" {
				t.Fatal("unconfirmed execution released admission")
			}
			if target == storage.Failed && current.ActiveMessageID != "" {
				t.Fatal("confirmed exit did not allow explicit continuation")
			}
			messages, _ := original.Store.Messages(ctx, c.ID)
			if len(messages) != 1 || messages[0].Text != "original input" {
				t.Fatal("saved history lost")
			}
			if f.prompts.Load() != 0 || base.starts.Load() != 0 {
				t.Fatal("dead execution replayed")
			}
		})
	}
}

func TestRecoveryDoesNotInferCompletionFromIdleOrAmbiguousHistory(t *testing.T) {
	for _, history := range []string{
		`[]`,
		`[{"info":{"id":"other","role":"user"},"parts":[{"type":"text","text":"different input"}]}]`,
		`[{"info":{"id":"one","role":"user"}},{"info":{"id":"two","role":"user"}}]`,
		`[{"info":{"id":"user","role":"user"},"parts":[{"type":"text","text":"original input"}]},{"info":{"id":"answer","role":"assistant","parentID":"user","finish":"stop","time":{"completed":1}},"parts":[{"type":"tool","state":{"status":"running"}}]}]`,
		`[{"info":{"id":"user","role":"user"},"parts":[{"type":"text","text":"original input"}]},{"info":{"id":"answer","role":"assistant","parentID":"user","error":{"name":"MessageAbortedError"},"time":{"completed":1}},"parts":[]}]`,
	} {
		t.Run(history, func(t *testing.T) {
			f := newFixture(t)
			original, p, project := testService(t, f)
			c, _ := savedRecoveryTurn(t, original, project)
			f.mu.Lock()
			_ = json.Unmarshal([]byte(history), &f.history)
			f.mu.Unlock()
			ctx, cancel := context.WithCancel(context.Background())
			recovered := New(ctx, original.Store, p)
			defer func() { cancel(); _ = recovered.quiesce(context.Background(), c.ID) }()
			if err := recovered.Reconcile(ctx); err != nil {
				t.Fatal(err)
			}
			current := waitStatus(t, recovered, c.ID, storage.Waiting)
			if current.ActiveMessageID == "" || f.prompts.Load() != 0 {
				t.Fatal("idle or ambiguous history authorized new execution")
			}
		})
	}
}

func TestRecoveryRestoresLiveQuestionWithoutAnswerReplay(t *testing.T) {
	f := newFixture(t)
	original, p, project := testService(t, f)
	c, _ := savedRecoveryTurn(t, original, project)
	f.mu.Lock()
	f.question = true
	f.busy = true
	f.history = []json.RawMessage{json.RawMessage(`{"info":{"id":"user","role":"user"},"parts":[{"type":"text","text":"original input"}]}`)}
	f.mu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	recovered := New(ctx, original.Store, p)
	defer func() { cancel(); _ = recovered.quiesce(context.Background(), c.ID) }()
	if err := recovered.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	current := waitStatus(t, recovered, c.ID, storage.Waiting)
	if current.StatusReason != "Flora needs your answer" {
		t.Fatal(current.StatusReason)
	}
	questions, err := recovered.Questions(ctx, c.ID)
	if err != nil || len(questions) != 1 || f.questionReplies.Load() != 0 {
		t.Fatal("question was lost or automatically answered")
	}
	if err := recovered.Reply(ctx, c.ID, questions[0].ID, [][]string{{"Yes"}}); err != nil {
		t.Fatal(err)
	}
	if f.questionReplies.Load() != 1 || f.prompts.Load() != 0 {
		t.Fatal("recovery duplicated an answer or prompt")
	}
	f.mu.Lock()
	f.busy = false
	f.history = append(f.history, json.RawMessage(`{"info":{"id":"answer","role":"assistant","parentID":"user","finish":"stop","time":{"completed":1}},"parts":[]}`))
	f.mu.Unlock()
	waitStatus(t, recovered, c.ID, storage.Idle)
}

func TestRecoveryConnectionReturnsAndHistoryFinishes(t *testing.T) {
	f := newFixture(t)
	original, base, project := testService(t, f)
	c, _ := savedRecoveryTurn(t, original, project)
	p := &recoveryProvisioner{testProvisioner: base, err: errors.New("offline")}
	ctx, cancel := context.WithCancel(context.Background())
	recovered := New(ctx, original.Store, p)
	defer func() { cancel(); _ = recovered.quiesce(context.Background(), c.ID) }()
	if err := recovered.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, recovered, c.ID, storage.Waiting)
	f.mu.Lock()
	f.history = []json.RawMessage{json.RawMessage(`{"info":{"id":"msg_original","role":"user"},"parts":[{"type":"text","text":"original input"}]}`), json.RawMessage(`{"info":{"id":"answer","role":"assistant","parentID":"msg_original","finish":"stop","time":{"completed":1}},"parts":[]}`)}
	f.mu.Unlock()
	p.mu.Lock()
	p.err = nil
	p.mu.Unlock()
	waitStatus(t, recovered, c.ID, storage.Idle)
	if base.starts.Load() != 0 || f.prompts.Load() != 0 {
		t.Fatal("reconnection submitted work")
	}
}

func TestRecoveryDoesNotReplaceUnconfirmedControlWithTerminalResponse(t *testing.T) {
	f := newFixture(t)
	original, p, project := testService(t, f)
	c, message := savedRecoveryTurn(t, original, project)
	if err := original.Store.Transition(context.Background(), c.ID, message.ID, storage.Working, "Stopping container"); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.history = []json.RawMessage{json.RawMessage(`{"info":{"id":"user","role":"user"},"parts":[{"type":"text","text":"original input"}]}`), json.RawMessage(`{"info":{"id":"answer","role":"assistant","parentID":"user","finish":"stop","time":{"completed":1}},"parts":[]}`)}
	f.mu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	recovered := New(ctx, original.Store, p)
	defer func() { cancel(); _ = recovered.quiesce(context.Background(), c.ID) }()
	if err := recovered.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	current := waitStatus(t, recovered, c.ID, storage.Waiting)
	if current.ActiveMessageID == "" || current.StatusReason != pendingRecoveryControl || recovered.monitoredTurn(c.ID, message.ID) {
		t.Fatal("unconfirmed control allowed new work or replies")
	}
	if err := recovered.Stop(ctx, c.ID); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, recovered, c.ID, storage.Stopped)
}

func TestRecoveryAfterLostPromptConnectionWithoutBackendRestart(t *testing.T) {
	f := newFixture(t)
	f.transportLoss = true
	s, p, project := testService(t, f)
	c, err := s.Create(context.Background(), project.ID, "Lost connection", "original", "original input")
	if err != nil {
		t.Fatal(err)
	}
	runtimeID := <-f.started
	f.release <- false
	uncertain := waitStatus(t, s, c.ID, storage.Waiting)
	if uncertain.ActiveMessageID == "" {
		t.Fatal("connection loss inferred completion")
	}
	if err := s.quiesce(context.Background(), c.ID); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.history = append(f.history, json.RawMessage(fmt.Sprintf(`{"info":{"id":"recovered","role":"assistant","parentID":%q,"finish":"stop","time":{"completed":1}},"parts":[{"type":"text","text":"Recovered final output"}]}`, runtimeID)))
	f.mu.Unlock()
	if err := s.Reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, s, c.ID, storage.Idle)
	if f.prompts.Load() != 1 || p.starts.Load() != 1 {
		t.Fatal("connection reconciliation submitted or started work again")
	}
}
