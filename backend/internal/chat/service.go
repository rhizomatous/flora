package chat

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/rhizomatous/flora/backend/internal/agentfiles"
	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/redaction"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

type Provisioner interface {
	Identity() (string, string)
	Start(context.Context, string) (provisioning.Endpoint, error)
	Endpoint(context.Context, string) (provisioning.Endpoint, error)
	BeginActivity(string)
	EndActivity(string)
}

type Service struct {
	Store       *storage.Store
	provisioner Provisioner
	ctx         context.Context
}

func New(ctx context.Context, store *storage.Store, p Provisioner) *Service {
	return &Service{Store: store, provisioner: p, ctx: ctx}
}

func (s *Service) Create(ctx context.Context, project, title, requestID, text string) (storage.Chat, error) {
	if s.provisioner == nil {
		return storage.Chat{}, errors.New("chat runtime is not configured")
	}
	if strings.TrimSpace(title) == "" || len(title) > 200 {
		return storage.Chat{}, storage.ErrInvalid
	}
	image, harness := s.provisioner.Identity()
	c, err := s.Store.CreateChatRequest(ctx, project, title, image, harness, requestID, text)
	if err != nil {
		return c, err
	}
	_, err = s.Submit(ctx, c.ID, requestID, text)
	if err != nil {
		return c, err
	}
	return s.Store.Chat(ctx, c.ID)
}

func (s *Service) Submit(ctx context.Context, chatID, requestID, text string) (storage.Acceptance, error) {
	if s.provisioner == nil {
		return storage.Acceptance{}, errors.New("chat runtime is not configured")
	}
	a, err := s.Store.AcceptMessage(ctx, chatID, requestID, text)
	if err != nil || a.Duplicate {
		return a, err
	}
	// Only the process that first accepts the message starts delivery. A crash
	// between acceptance and launch leaves saved uncertainty, never an auto-retry.
	go s.run(chatID, a.Message)
	return a, nil
}

func (s *Service) transition(chatID, messageID string, status storage.Status, reason string) error {
	return s.Store.Transition(s.ctx, chatID, messageID, status, reason)
}

func (s *Service) run(chatID string, message storage.Message) {
	ctx := s.ctx
	fail := func(reason string) { _ = s.transition(chatID, message.ID, storage.Failed, reason) }
	c, err := s.Store.Chat(ctx, chatID)
	if err != nil {
		return
	}
	credentials, err := s.Store.Credentials(ctx)
	if err != nil {
		fail("Configure GitHub and model-provider credentials in installation settings.")
		return
	}
	var endpoint provisioning.Endpoint
	if c.ContainerID == "" {
		_ = s.transition(chatID, message.ID, storage.Working, "Preparing checkout and setup")
		monitorCtx, stopMonitor := context.WithCancel(ctx)
		monitorDone := make(chan struct{})
		go func() { defer close(monitorDone); s.captureSetup(monitorCtx, chatID, credentials.ProviderKey) }()
		endpoint, err = s.provisioner.Start(ctx, chatID)
		stopMonitor()
		<-monitorDone
	} else {
		// Never rotate access while existing git/gh commands may be running.
		endpoint, err = s.provisioner.Endpoint(ctx, chatID)
	}
	if err != nil {
		var capacity *provisioning.CapacityError
		var setup *provisioning.SetupError
		switch {
		case errors.As(err, &capacity):
			fail(capacity.Error() + ". No message was delivered.")
		case errors.As(err, &setup):
			fail(setup.Error() + ". No message was delivered.")
		default:
			fail("Environment unavailable. Check Docker, capacity, checkout and setup activity. No message was delivered.")
		}
		return
	}
	s.provisioner.BeginActivity(endpoint.ContainerID)
	defer s.provisioner.EndActivity(endpoint.ContainerID)
	rt := newRuntime(endpoint)
	defer rt.client.CloseIdleConnections()
	setupCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	// Installation settings enter the container before boot. Runtime config
	// mutation writes project config, which this pinned image deliberately ignores.
	var configuration struct {
		Model string `json:"model"`
	}
	err = rt.call(setupCtx, "GET", "/config", nil, &configuration)
	if err == nil && configuration.Model != credentials.Provider+"/"+credentials.Model {
		err = errors.New("runtime model differs from installation settings")
	}
	if err == nil && c.SessionID == "" {
		var session struct {
			ID string `json:"id"`
		}
		err = rt.call(setupCtx, "POST", "/session", map[string]string{"title": c.Title}, &session)
		if err == nil && session.ID == "" {
			err = errors.New("missing session identity")
		}
		if err == nil {
			err = s.Store.BindRuntime(ctx, chatID, endpoint.ContainerID, session.ID)
			c.SessionID = session.ID
		}
	}
	cancel()
	if err != nil {
		fail("OpenCode configuration or session failed. No message was delivered.")
		return
	}
	// OpenCode generates time-ordered message IDs and compares them internally.
	// Do not substitute Flora's random request IDs. Link the newly observed user
	// record during capture; a missing link never authorizes automatic redelivery.
	knownUsers := map[string]bool{}
	savedMessages, err := s.Store.Messages(ctx, chatID)
	if err != nil {
		fail("Could not read saved message links. No message was delivered.")
		return
	}
	for _, saved := range savedMessages {
		if saved.Role == "user" {
			knownUsers[saved.RuntimeMessageID] = true
		}
	}
	var runtimeID string
	turnCtx, stopCapture := context.WithCancel(ctx)
	defer stopCapture()
	ready := make(chan error, 1)
	captureErrors := make(chan error, 1)
	var runtimeFailure atomic.Bool
	secrets := redaction.Values(ctx, s.Store, chatID, endpoint.Password, endpoint.ProviderKey)
	go func() {
		captureErrors <- rt.stream(turnCtx, c.SessionID, ready, func(kind string, payload json.RawMessage) error {
			// Persist complete part snapshots rather than text fragments. Separate
			// deltas could expose a credential split across multiple observations.
			if kind == "message.part.delta" {
				return nil
			}
			clean := redaction.JSON(payload, secrets...)
			if err := s.Store.AppendActivity(turnCtx, chatID, rand.Text(), "runtime."+kind, clean); err != nil {
				return err
			}
			if kind == "question.asked" {
				return s.transition(chatID, message.ID, storage.Waiting, "Flora needs your answer")
			}
			if kind == "session.error" {
				runtimeFailure.Store(true)
			}
			if kind == "session.status" {
				var event struct {
					Properties struct {
						Status struct {
							Type string `json:"type"`
						} `json:"status"`
					} `json:"properties"`
				}
				_ = json.Unmarshal(payload, &event)
				if event.Properties.Status.Type == "retry" {
					return s.transition(chatID, message.ID, storage.Waiting, "Waiting for the model provider to retry")
				}
				if event.Properties.Status.Type == "busy" {
					return s.transition(chatID, message.ID, storage.Working, "Flora is working")
				}
			}
			if kind == "question.replied" || kind == "question.rejected" {
				return s.transition(chatID, message.ID, storage.Working, "Continuing after question")
			}
			return nil
		})
	}()
	if err := <-ready; err != nil {
		fail("Could not connect activity capture. No message was delivered.")
		return
	}
	_ = s.transition(chatID, message.ID, storage.Working, "Delivering message to OpenCode")
	result := make(chan error, 1)
	go func() {
		var response runtimeMessage
		err := rt.call(turnCtx, "POST", sessionPath(c.SessionID)+"/message", map[string]any{
			"model":  map[string]string{"providerID": credentials.Provider, "modelID": credentials.Model},
			"system": SystemPrompt, "parts": []map[string]string{{"type": "text", "text": message.Text}},
		}, &response)
		if err == nil && (response.Info.ID == "" || response.Info.Role != "assistant") {
			err = errors.New("runtime completion response was incomplete")
		}
		result <- err
	}()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	seen := map[string][32]byte{}
	capture := func() (bool, error) {
		snapshotCtx, cancel := context.WithTimeout(turnCtx, 10*time.Second)
		defer cancel()
		return s.captureHistory(snapshotCtx, rt, c, secrets, message.ID, &runtimeID, knownUsers, seen)
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-captureErrors:
			if turnCtx.Err() != nil {
				return
			}
			_ = s.Store.AppendActivity(ctx, chatID, rand.Text(), "capture.gap", json.RawMessage(`{"reason":"OpenCode activity stream disconnected. Transient events may be missing; saved message snapshots remain available."}`))
			// History cannot reconstruct transient events. Only a successful prompt
			// response together with a saved final snapshot can confirm completion.
			captureErrors = nil
		case err := <-result:
			providerFailure, captureErr := capture()
			var rejected *responseError
			if errors.As(err, &rejected) && rejected.status >= 400 && rejected.status < 500 && rejected.status != 409 {
				fail(rejected.Error() + ". Check the installation model and runtime configuration.")
			} else if err != nil || captureErr != nil || runtimeID == "" {
				_ = s.transition(chatID, message.ID, storage.Waiting, "Runtime delivery or completion is uncertain. The accepted message will not be resent. Saved activity may be incomplete.")
			} else if providerFailure || runtimeFailure.Load() {
				fail("The model provider or runtime reported an error. Inspect the saved response and installation settings.")
			} else {
				_ = s.transition(chatID, message.ID, storage.Idle, "Turn completed; ready for a follow-up")
			}
			return
		case <-ticker.C:
			_, _ = capture()
		}
	}
}

func (s *Service) captureHistory(ctx context.Context, rt *runtime, c storage.Chat, secrets []string, messageID string, runtimeID *string, knownUsers map[string]bool, seen map[string][32]byte) (bool, error) {
	var history []json.RawMessage
	if err := rt.call(ctx, "GET", sessionPath(c.SessionID)+"/message", nil, &history); err != nil {
		return false, err
	}
	providerFailure := false
	for _, raw := range history {
		raw = redaction.JSON(raw, secrets...)
		var m runtimeMessage
		if err := json.Unmarshal(raw, &m); err != nil {
			return false, err
		}
		if m.Info.Role == "user" && !knownUsers[m.Info.ID] {
			if *runtimeID != "" && *runtimeID != m.Info.ID {
				return false, errors.New("unexpected concurrent runtime user message")
			}
			if err := s.Store.LinkRuntimeMessage(ctx, c.ID, messageID, m.Info.ID); err != nil {
				return false, err
			}
			*runtimeID = m.Info.ID
			knownUsers[m.Info.ID] = true
		}
		if m.Info.Role != "assistant" {
			continue
		}
		if m.Info.ParentID == *runtimeID && len(m.Info.Error) > 0 && string(m.Info.Error) != "null" {
			providerFailure = true
		}
		hash := sha256.Sum256(raw)
		if seen[m.Info.ID] == hash {
			continue
		}
		var text strings.Builder
		for _, p := range m.Parts {
			if p.Type == "text" {
				text.WriteString(p.Text)
			}
		}
		if err := s.Store.SaveRuntimeMessage(ctx, rand.Text(), storage.Message{ChatID: c.ID, RuntimeMessageID: m.Info.ID, Role: "assistant", Text: text.String(), Provider: m.Info.Provider, Model: m.Info.Model, Payload: raw}); err != nil {
			return false, err
		}
		seen[m.Info.ID] = hash
	}
	return providerFailure, nil
}

// captureSetup saves complete changed setup snapshots, including the final exit
// code, while provisioning runs. Browser disconnection does not affect capture.
func (s *Service) captureSetup(ctx context.Context, chatID, providerKey string) {
	paths, err := s.Store.Paths(ctx, chatID)
	if err != nil {
		return
	}
	root, err := os.OpenRoot(paths.RuntimeState)
	if err != nil {
		return
	}
	defer root.Close()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	var last [32]byte
	save := func() {
		values := redaction.Values(context.WithoutCancel(ctx), s.Store, chatID, providerKey)
		output, outputErr := agentfiles.Read(root, filepath.Join("setup", "output.log"), 0)
		exit, exitErr := agentfiles.Read(root, filepath.Join("setup", "exit-status"), 4096)
		if outputErr == nil || exitErr == nil {
			payload, _ := json.Marshal(map[string]string{"output": redaction.Text(string(output), values...), "exit_status": redaction.Text(strings.TrimSpace(string(exit)), values...)})
			hash := sha256.Sum256(payload)
			if hash != last {
				if s.Store.AppendActivity(context.WithoutCancel(ctx), chatID, rand.Text(), "setup.output", payload) == nil {
					last = hash
				}
			}
		}
	}
	defer save()
	for {
		save()
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

type Question struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionID"`
	Questions []struct {
		Question string `json:"question"`
		Header   string `json:"header"`
		Multiple bool   `json:"multiple"`
		Custom   *bool  `json:"custom,omitempty"`
		Options  []struct {
			Label       string `json:"label"`
			Description string `json:"description"`
		} `json:"options"`
	} `json:"questions"`
}

func (s *Service) Questions(ctx context.Context, chatID string) ([]Question, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	c, err := s.Store.Chat(ctx, chatID)
	if err != nil {
		return nil, err
	}
	if c.SessionID == "" || (c.Status != storage.Working && c.Status != storage.Waiting) {
		return []Question{}, nil
	}
	e, err := s.provisioner.Endpoint(ctx, chatID)
	if err != nil {
		return nil, errors.New("runtime questions unavailable; saved questions may be stale")
	}
	rt := newRuntime(e)
	defer rt.client.CloseIdleConnections()
	var questions []Question
	if err := rt.call(ctx, "GET", "/question", nil, &questions); err != nil {
		return nil, err
	}
	result := []Question{}
	secrets := redaction.Values(ctx, s.Store, chatID, e.Password, e.ProviderKey)
	for _, q := range questions {
		if q.SessionID == c.SessionID {
			b, _ := json.Marshal(q)
			_ = json.Unmarshal(redaction.JSON(b, secrets...), &q)
			result = append(result, q)
		}
	}
	return result, nil
}

// Reply confirms the process-local request still belongs to this chat. A lost
// reply response is uncertain and must not be retried as a fresh question answer.
func (s *Service) Reply(ctx context.Context, chatID, questionID string, answers [][]string) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	c, err := s.Store.Chat(ctx, chatID)
	if err != nil {
		return err
	}
	if c.ActiveMessageID == "" {
		return storage.ErrStale
	}
	questions, err := s.Questions(ctx, chatID)
	if err != nil {
		return err
	}
	var question *Question
	for _, q := range questions {
		if q.ID == questionID {
			question = &q
			break
		}
	}
	if question == nil {
		return storage.ErrStale
	}
	if len(answers) != len(question.Questions) {
		return storage.ErrInvalid
	}
	total := 0
	for i, group := range answers {
		if len(group) == 0 {
			return storage.ErrInvalid
		}
		if !question.Questions[i].Multiple && len(group) != 1 {
			return storage.ErrInvalid
		}
		for _, a := range group {
			total += len(a)
			if total > storage.MaxMessageBytes || strings.TrimSpace(a) == "" {
				return storage.ErrInvalid
			}
			if question.Questions[i].Custom != nil && !*question.Questions[i].Custom {
				allowed := false
				for _, option := range question.Questions[i].Options {
					if a == option.Label {
						allowed = true
					}
				}
				if !allowed {
					return storage.ErrInvalid
				}
			}
		}
	}
	e, err := s.provisioner.Endpoint(ctx, chatID)
	if err != nil {
		return err
	}
	rt := newRuntime(e)
	defer rt.client.CloseIdleConnections()
	payload, _ := json.Marshal(map[string]any{"question_id": questionID, "answers": answers})
	if err := s.Store.AppendActivity(ctx, chatID, rand.Text(), "question.answer", redaction.JSON(payload, redaction.Values(ctx, s.Store, chatID, e.Password, e.ProviderKey)...)); err != nil {
		return err
	}
	if err := rt.call(ctx, "POST", "/question/"+url.PathEscape(questionID)+"/reply", map[string]any{"answers": answers}, nil); err != nil {
		_ = s.transition(chatID, c.ActiveMessageID, storage.Waiting, "Question reply delivery is uncertain. Refresh the live questions before continuing.")
		return errors.New("question reply uncertain; refresh before continuing")
	}
	err = s.transition(chatID, c.ActiveMessageID, storage.Working, "Question answered; continuing work")
	if errors.Is(err, storage.ErrStale) {
		return nil
	}
	return err
}
