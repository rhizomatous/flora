package chat

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
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
			var endpointErr error = &provisioning.ExecutionEndedError{Reason: reason, Missing: reason == "container missing"}
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
			if reason == "container missing" {
				if current.StatusReason != missingContainerRecovery || recovered.ContinuationBlock(ctx, current) == "" {
					t.Fatal("missing container advertised continuation")
				}
				if _, err := recovered.Submit(ctx, c.ID, "futile-new-input", "continue"); err == nil {
					t.Fatal("missing container accepted new input")
				}
				duplicate, err := recovered.Submit(ctx, c.ID, "accepted", "original input")
				if err != nil || !duplicate.Duplicate {
					t.Fatal("saved acceptance lookup was blocked")
				}
			} else if target == storage.Failed && !strings.Contains(current.StatusReason, "Send explicit new input") {
				t.Fatal("preserved container lost explicit continuation")
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

func TestIdleRecoveryConnectionErrorDoesNotDescribeAnActiveTurn(t *testing.T) {
	f := newFixture(t)
	original, base, project := testService(t, f)
	c, message := savedRecoveryTurn(t, original, project)
	if err := original.Store.Transition(context.Background(), c.ID, message.ID, storage.Idle, "Finished"); err != nil {
		t.Fatal(err)
	}
	p := &recoveryProvisioner{testProvisioner: base, err: errors.New("Docker unavailable")}
	recovered := New(original.ctx, original.Store, p)
	if err := recovered.Reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	current := waitStatus(t, recovered, c.ID, storage.Waiting)
	if current.StatusReason != idleConnectionUnavailable || strings.Contains(current.StatusReason, "accepted message") {
		t.Fatal(current.StatusReason)
	}
	updated := current.UpdatedAt
	if err := recovered.Reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	current, _ = original.Store.Chat(context.Background(), c.ID)
	if current.UpdatedAt != updated {
		t.Fatal("repeated inspection failure changed last activity")
	}
}

func TestRecoveryGapIsRecordedOncePerDisconnection(t *testing.T) {
	f := newFixture(t)
	original, p, project := testService(t, f)
	c, _ := savedRecoveryTurn(t, original, project)
	f.streamUnavailable.Store(true)
	f.mu.Lock()
	f.historyUnavailable = true
	f.mu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	recovered := New(ctx, original.Store, p)
	defer func() { cancel(); _ = recovered.quiesce(context.Background(), c.ID) }()
	if err := recovered.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	current := waitStatus(t, recovered, c.ID, storage.Waiting)
	countGaps := func() int {
		rows, err := original.Store.Activities(ctx, c.ID, 0, 1000)
		if err != nil {
			t.Fatal(err)
		}
		n := 0
		for _, row := range rows {
			if row.Kind == "capture.gap" {
				n++
			}
		}
		return n
	}
	time.Sleep(2200 * time.Millisecond)
	later, _ := original.Store.Chat(ctx, c.ID)
	if countGaps() != 1 || current.UpdatedAt != later.UpdatedAt {
		t.Fatal("unreachable runtime produced repeated gap activity")
	}
	f.mu.Lock()
	f.historyUnavailable = false
	f.busy = true
	f.history = []json.RawMessage{json.RawMessage(`{"info":{"id":"user","role":"user"},"parts":[{"type":"text","text":"original input"}]}`)}
	f.mu.Unlock()
	f.streamUnavailable.Store(false)
	waitStatus(t, recovered, c.ID, storage.Working)
	deadline := time.Now().Add(3 * time.Second)
	for f.connectedStreams.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if f.connectedStreams.Load() == 0 {
		t.Fatal("stream never reconnected between outages")
	}
	f.streamUnavailable.Store(true)
	f.mu.Lock()
	f.historyUnavailable = true
	f.mu.Unlock()
	close(f.streamStop)
	waitStatus(t, recovered, c.ID, storage.Waiting)
	time.Sleep(2200 * time.Millisecond)
	current, _ = original.Store.Chat(ctx, c.ID)
	updated := current.UpdatedAt
	if countGaps() != 2 {
		t.Fatalf("expected one gap for each of two outages, got %d", countGaps())
	}
	time.Sleep(1200 * time.Millisecond)
	current, _ = original.Store.Chat(ctx, c.ID)
	if current.UpdatedAt != updated || countGaps() != 2 {
		t.Fatal("continued outage produced activity churn")
	}
}

func TestRecoveryKeepsObserverThroughTransientStorageReadFailure(t *testing.T) {
	f := newFixture(t)
	original, p, project := testService(t, f)
	c, message := savedRecoveryTurn(t, original, project)
	f.mu.Lock()
	f.busy = true
	f.mu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	recovered := New(ctx, original.Store, p)
	defer func() { cancel(); _ = recovered.quiesce(context.Background(), c.ID) }()
	if err := recovered.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for !recovered.monitoredTurn(c.ID, message.ID) && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	paths, err := original.Store.Paths(ctx, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(filepath.Dir(filepath.Dir(paths.Workspace)), "flora.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if _, err := db.ExecContext(ctx, "PRAGMA busy_timeout=5000"); err != nil {
		t.Fatal(err)
	}
	recovered.turnMu.Lock()
	job := recovered.jobs[c.ID]
	recovered.turnMu.Unlock()
	// Temporarily hide this test database's table so reads return an error rather
	// than an empty result. Restoring it leaves the saved rows unchanged.
	if _, err := db.ExecContext(ctx, "ALTER TABLE chats RENAME TO unavailable_chats"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1200 * time.Millisecond)
	recovered.turnMu.Lock()
	finished := job.finished
	recovered.turnMu.Unlock()
	if _, err := db.ExecContext(ctx, "ALTER TABLE unavailable_chats RENAME TO chats"); err != nil {
		t.Fatal(err)
	}
	if finished {
		t.Fatal("transient storage read killed the observer")
	}
	if err := recovered.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	recovered.turnMu.Lock()
	same := recovered.jobs[c.ID] == job
	recovered.turnMu.Unlock()
	if !same {
		t.Fatal("transient storage error replaced the observer")
	}
	f.mu.Lock()
	f.busy = false
	f.history = []json.RawMessage{json.RawMessage(`{"info":{"id":"user","role":"user"},"parts":[{"type":"text","text":"original input"}]}`), json.RawMessage(`{"info":{"id":"answer","role":"assistant","parentID":"user","finish":"stop","time":{"completed":1}},"parts":[]}`)}
	f.mu.Unlock()
	waitStatus(t, recovered, c.ID, storage.Idle)
	if f.prompts.Load() != 0 || p.starts.Load() != 0 {
		t.Fatal("storage recovery restarted execution")
	}
}

func TestRecoveryRetainsPartialCoreCheckoutWithoutRestart(t *testing.T) {
	for _, status := range []storage.Status{storage.Working, storage.Failed} {
		t.Run(string(status), func(t *testing.T) {
			f := newFixture(t)
			original, p, _ := testService(t, f)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			project, err := original.Store.CreateProject(ctx, "Partial checkout", storage.Configuration{Repositories: []storage.Repository{
				{Name: "first", URL: "https://github.com/example/first", BaseBranch: "main", Role: "core"},
				{Name: "second", URL: "https://github.com/example/second", BaseBranch: "main", Role: "core"},
				{Name: "extra", URL: "https://github.com/example/extra", BaseBranch: "main", Role: "extra"},
			}})
			if err != nil {
				t.Fatal(err)
			}
			c, err := original.Store.CreateChat(ctx, project.ID, "Partial", testImage, "1.2.27")
			if err != nil {
				t.Fatal(err)
			}
			accepted, err := original.Store.AcceptMessage(ctx, c.ID, "partial", "original input")
			if err != nil {
				t.Fatal(err)
			}
			if err := original.Store.RecordStartingCommit(ctx, c.ID, "first", strings.Repeat("a", 40)); err != nil {
				t.Fatal(err)
			}
			if err := original.Store.BindRuntime(ctx, c.ID, "container", ""); err != nil {
				t.Fatal(err)
			}
			if status == storage.Failed {
				if err := original.Store.Transition(ctx, c.ID, accepted.Message.ID, status, "Checkout failed before runtime startup; no message was delivered."); err != nil {
					t.Fatal(err)
				}
			}
			recovered := New(ctx, original.Store, p)
			defer func() { cancel(); _ = recovered.quiesce(context.Background(), c.ID) }()
			if err := recovered.Reconcile(ctx); err != nil {
				t.Fatal(err)
			}
			target := status
			if status == storage.Working {
				target = storage.Waiting
			}
			current := waitStatus(t, recovered, c.ID, target)
			if len(current.StartingCommits) != 1 || current.StartingCommits["first"] != strings.Repeat("a", 40) || current.SessionID != "" {
				t.Fatal("partial checkout was discarded or treated as complete")
			}
			if f.prompts.Load() != 0 || f.sessions.Load() != 0 || p.starts.Load() != 0 {
				t.Fatal("partial checkout automatically started runtime work")
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
