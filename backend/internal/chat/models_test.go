package chat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"reflect"
	"testing"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

const testModelCatalog = `{"connected":["anthropic"],"all":[{"id":"anthropic","key":"provider_SECRET","options":{"apiKey":"provider_SECRET"},"models":{"model":{"capabilities":{"toolcall":true}},"claude-sonnet-4-6":{"name":"Sonnet","variants":{"low":{},"medium":{},"high":{},"careful":{},"disabled":{"disabled":true}},"capabilities":{"toolcall":true}},"claude-haiku-4-5":{"name":"Haiku","capabilities":{"toolcall":true}},"no-tools":{"capabilities":{"toolcall":false}}}},{"id":"openai","models":{"gpt-5":{"capabilities":{"toolcall":true}}}}]}`

func TestRuntimeMetadataPreservesVariantsAndFiltersModels(t *testing.T) {
	f := newFixture(t)
	s, _, _ := testService(t, f)
	s.provisioner.(*testProvisioner).metadata = (&attachmentCatalogTransport{status: 200, body: testModelCatalog}).read
	options := s.Models(context.Background())
	if options.Error != "" || len(options.Models) != 3 {
		t.Fatal(options)
	}
	for _, m := range options.Models {
		if m.ID == "claude-sonnet-4-6" && !reflect.DeepEqual(m.Variants, []string{"low", "medium", "high", "careful"}) {
			t.Fatal(m)
		}
	}
	raw, _ := json.Marshal(options)
	if bytes.Contains(raw, []byte("provider_SECRET")) {
		t.Fatal("metadata exposed credentials")
	}
}

func TestModelAdmissionDiscoveryAndDelivery(t *testing.T) {
	f := newFixture(t)
	s, _, project := testService(t, f)
	ctx := context.Background()
	catalog := &attachmentCatalogTransport{status: 503}
	s.provisioner.(*testProvisioner).metadata = catalog.read
	if options := s.Models(ctx); options.Error == "" || len(options.Models) != 1 {
		t.Fatal(options)
	}
	selected := storage.Execution{Provider: "anthropic", Model: "claude-sonnet-4-6", Variant: "high"}
	if _, err := s.CreateWithExecution(ctx, project.ID, "Selected", "create", "First", &selected); err == nil {
		t.Fatal("discovery outage accepted custom model")
	}
	catalog.status, catalog.body = 200, testModelCatalog
	if options := s.Models(ctx); len(options.Models) != 3 || options.Error != "" {
		t.Fatal(options)
	}
	unsupported := selected
	unsupported.Model = "claude-haiku-4-5"
	if _, err := s.CreateWithExecution(ctx, project.ID, "Invalid", "invalid", "First", &unsupported); err == nil {
		t.Fatal("accepted unsupported reasoning")
	}
	chats, _ := s.Store.Chats(ctx)
	if len(chats) != 0 {
		t.Fatal("invalid selection reserved work")
	}
	// Observe the real prompt envelope while the fixture reports a different model.
	original := f.server.Config.Handler
	prompts := make(chan storage.Execution, 4)
	f.server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/provider" {
			io.WriteString(w, `{"connected":["anthropic"],"all":[{"id":"anthropic","models":{"claude-sonnet-4-6":{"variants":{"low":{},"high":{}},"capabilities":{"toolcall":true}}}}]}`)
			return
		}
		if r.Method == "POST" && r.URL.Path == "/session/ses_one/message" {
			raw, _ := io.ReadAll(r.Body)
			r.Body = io.NopCloser(bytes.NewReader(raw))
			var body struct {
				Model struct {
					Provider string `json:"providerID"`
					ID       string `json:"modelID"`
				} `json:"model"`
				Variant string `json:"variant"`
			}
			_ = json.Unmarshal(raw, &body)
			prompts <- storage.Execution{Provider: body.Model.Provider, Model: body.Model.ID, Variant: body.Variant}
		}
		original.ServeHTTP(w, r)
	})
	c, err := s.CreateWithExecution(ctx, project.ID, "Selected", "create", "First", &selected)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case actual := <-prompts:
		if actual != selected {
			t.Fatal(actual)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no prompt")
	}
	if _, err := s.SubmitWithExecution(ctx, c.ID, "active", "Change", &unsupported); !errors.Is(err, storage.ErrActive) {
		t.Fatal(err)
	}
	f.release <- false
	waitStatus(t, s, c.ID, storage.Idle)
	// A live runtime that lacks a discovered effort rejects it before acceptance.
	unsupported = selected
	unsupported.Variant = "medium"
	if _, err := s.SubmitWithExecution(ctx, c.ID, "unsupported-runtime", "Change", &unsupported); err == nil {
		t.Fatal("runtime-unsupported effort accepted")
	}
	history, _ := s.Store.Messages(ctx, c.ID)
	if len(history) != 2 {
		t.Fatal("rejected effort changed history")
	}

	// Discovery may disappear after admission; duplicate requests still return saved input.
	s.models.expires = time.Time{}
	catalog.status = 503
	duplicate, err := s.CreateWithExecution(ctx, project.ID, "Selected", "create", "First", &selected)
	if err != nil || duplicate.ID != c.ID {
		t.Fatal(duplicate, err)
	}
	messages, _ := s.Store.Messages(ctx, c.ID)
	if len(messages) != 2 || messages[1].Model != "model" || storage.MessageExecution(messages[0]) != selected {
		t.Fatal(messages)
	}
}

func TestAutomationExecutionPolicy(t *testing.T) {
	f := newFixture(t)
	s, _, project := testService(t, f)
	ctx := context.Background()
	s.provisioner.(*testProvisioner).metadata = (&attachmentCatalogTransport{status: 200, body: testModelCatalog}).read
	original := f.server.Config.Handler
	f.server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/provider" {
			io.WriteString(w, `{"connected":["anthropic"],"all":[{"id":"anthropic","models":{"claude-sonnet-4-6":{"variants":{"high":{}},"capabilities":{"toolcall":true}}}}]}`)
			return
		}
		original.ServeHTTP(w, r)
	})
	a, err := s.Store.SaveAutomation(ctx, storage.Automation{ProjectID: project.ID, AutomationConfig: storage.AutomationConfig{Name: "Check", Instructions: "Check", Mode: "same", Frequency: "daily", Time: "09:00", TimeZone: "UTC"}}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.StartAutomation(ctx, a.ID, "first", time.Now(), false)
	if err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	f.release <- false
	waitStatus(t, s, run.ChatID, storage.Idle)
	selected := storage.Execution{Provider: "anthropic", Model: "claude-sonnet-4-6", Variant: "high"}
	if _, err := s.SubmitWithExecution(ctx, run.ChatID, "user", "Use high effort", &selected); err != nil {
		t.Fatal(err)
	}
	awaitPrompt(t, f)
	f.release <- false
	waitStatus(t, s, run.ChatID, storage.Idle)
	next, err := s.StartAutomation(ctx, a.ID, "next", time.Now(), false)
	if err != nil || next.ChatID != run.ChatID {
		t.Fatal(next, err)
	}
	awaitPrompt(t, f)
	f.release <- false
	waitStatus(t, s, run.ChatID, storage.Idle)
	messages, _ := s.Store.Messages(ctx, run.ChatID)
	if storage.MessageExecution(messages[0]).Model != "model" || storage.MessageExecution(messages[4]) != selected {
		t.Fatal(messages)
	}
	// New-chat runs do not inherit the standing chat's later user preference.
	a.Mode = "new"
	a, err = s.Store.SaveAutomation(ctx, a, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	fresh, err := s.StartAutomation(ctx, a.ID, "fresh", time.Now(), false)
	if err != nil || fresh.ChatID == run.ChatID {
		t.Fatal(fresh, err)
	}
	awaitPrompt(t, f)
	f.release <- false
	waitStatus(t, s, fresh.ChatID, storage.Idle)
	freshMessages, _ := s.Store.Messages(ctx, fresh.ChatID)
	if storage.MessageExecution(freshMessages[0]).Model != "model" {
		t.Fatal(freshMessages)
	}
}

func TestDiscoveryCacheTracksCredentialsAndFailures(t *testing.T) {
	f := newFixture(t)
	s, _, _ := testService(t, f)
	ctx := context.Background()
	metadata := &attachmentCatalogTransport{status: 200, body: testModelCatalog}
	s.provisioner.(*testProvisioner).metadata = metadata.read
	if s.Models(ctx).Error != "" || s.Models(ctx).Error != "" || metadata.calls != 1 {
		t.Fatal("successful metadata was not cached")
	}
	credentials, _ := s.Store.Credentials(ctx)
	credentials.ProviderKey = "rotated-provider-key"
	if err := s.Store.SaveCredentials(ctx, credentials); err != nil {
		t.Fatal(err)
	}
	if s.Models(ctx).Error != "" || metadata.calls != 2 {
		t.Fatal("key rotation reused old metadata")
	}
	s.models.expires = time.Time{}
	metadata.status = 503
	if s.Models(ctx).Error == "" {
		t.Fatal("failed discovery appeared successful")
	}
	metadata.status = 200
	metadata.body = `{"connected":[],"all":[]}`
	if s.Models(ctx).Error == "" {
		t.Fatal("disconnected provider exposed model choices")
	}
	metadata.body = testModelCatalog
	if s.Models(ctx).Error != "" || metadata.calls != 5 {
		t.Fatal("failed discovery prevented retry")
	}
}

func TestRunningChatUsesItsOwnModels(t *testing.T) {
	f := newFixture(t)
	s, p, project := testService(t, f)
	ctx := context.Background()
	metadata := &attachmentCatalogTransport{status: 200, body: testModelCatalog}
	p.metadata = metadata.read
	_ = s.Models(ctx)
	original := f.server.Config.Handler
	f.server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/provider" {
			io.WriteString(w, `{"connected":["anthropic"],"all":[{"id":"anthropic","models":{"runtime-only-model":{"name":"Runtime model","variants":{"careful":{}},"capabilities":{"toolcall":true,"input":{"image":true}}}}}]}`)
			return
		}
		original.ServeHTTP(w, r)
	})
	c, err := s.Store.CreateChat(ctx, project.ID, "Existing", testImage, "1.2.27")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Store.BindRuntime(ctx, c.ID, "container", "ses_one"); err != nil {
		t.Fatal(err)
	}
	if err := s.Store.Transition(ctx, c.ID, "", storage.Idle, "Ready"); err != nil {
		t.Fatal(err)
	}
	options := s.Models(ctx, c.ID)
	if options.Error != "" || len(options.Models) != 1 || options.Models[0].ID != "runtime-only-model" || !options.Models[0].Image || !reflect.DeepEqual(options.Models[0].Variants, []string{"careful"}) || metadata.calls != 1 || p.starts.Load() != 0 {
		t.Fatal(options, "running chat did not use its own runtime")
	}
	selected := storage.Execution{Provider: "anthropic", Model: "runtime-only-model", Variant: "careful"}
	if err := s.validateExecution(ctx, selected, nil, c.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.validateExecution(ctx, selected, nil); err == nil {
		t.Fatal("new chats adopted a running chat's private model")
	}
}

func TestRuntimeModelRatesPreserveZeroAndMissing(t *testing.T) {
	var providers runtimeProviders
	raw := `{"connected":["anthropic"],"all":[{"id":"anthropic","models":{"priced":{"cost":{"input":0,"output":0.1},"capabilities":{"toolcall":true}},"unknown":{"capabilities":{"toolcall":true}},"invalid":{"cost":{"input":-1,"output":2},"capabilities":{"toolcall":true}}}}]}`
	if err := json.Unmarshal([]byte(raw), &providers); err != nil {
		t.Fatal(err)
	}
	options := providerOptions(providers, ModelOptions{Default: storage.Execution{Provider: "anthropic", Model: "priced"}, Error: "Unavailable"})
	if options.Error != "" || len(options.Models) != 3 {
		t.Fatal(options)
	}
	for _, m := range options.Models {
		switch m.ID {
		case "priced":
			if m.InputPrice == nil || *m.InputPrice != 0 || m.OutputPrice == nil || *m.OutputPrice != 0.1 {
				t.Fatal("reported rates changed", m)
			}
		case "unknown":
			if m.InputPrice != nil || m.OutputPrice != nil {
				t.Fatal("missing rate became zero", m)
			}
		case "invalid":
			if m.InputPrice != nil {
				t.Fatal("negative rate exposed", m)
			}
		}
	}
}
