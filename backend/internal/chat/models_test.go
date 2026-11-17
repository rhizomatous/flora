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

const testModelCatalog = `{"anthropic":{"models":{"model":{"tool_call":true},"claude-sonnet-4-6":{"name":"Sonnet","tool_call":true,"reasoning":true},"claude-haiku-4-5":{"name":"Haiku","tool_call":true},"no-tools":{"tool_call":false}}},"openai":{"models":{"gpt-5":{"tool_call":true,"reasoning":true}}}}`

func TestModelSpecificVariants(t *testing.T) {
	for _, tc := range []struct {
		provider, id, release string
		reasoning             bool
		want                  []string
	}{
		{"anthropic", "claude-sonnet-4-6", "", true, []string{"low", "medium", "high", "max"}},
		{"anthropic", "claude-sonnet-4-5", "", true, []string{"high", "max"}},
		{"anthropic", "claude-haiku-4-5", "", false, []string{}},
		{"openai", "gpt-5-pro", "2025-10-01", true, []string{}},
		{"openai", "gpt-5.2-codex", "2026-01-01", true, []string{"low", "medium", "high", "xhigh"}},
		{"openai", "gpt-5", "2025-08-07", true, []string{"minimal", "low", "medium", "high"}},
		{"openai", "gpt-5.2", "2025-12-11", true, []string{"none", "low", "medium", "high", "xhigh"}},
		{"google", "gemini-2.5-pro", "", true, []string{"high", "max"}},
		{"google", "gemini-3.1-pro", "", true, []string{"low", "medium", "high"}},
	} {
		t.Run(tc.id, func(t *testing.T) {
			if got := modelVariants(tc.provider, tc.id, tc.reasoning, tc.release); !reflect.DeepEqual(got, tc.want) {
				t.Fatal(got)
			}
		})
	}
}

func TestModelAdmissionDiscoveryAndDelivery(t *testing.T) {
	f := newFixture(t)
	s, _, project := testService(t, f)
	ctx := context.Background()
	catalog := &attachmentCatalogTransport{status: 503}
	s.ModelCatalogClient = &http.Client{Transport: catalog}
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
			io.WriteString(w, `{"all":[{"id":"anthropic","models":{"claude-sonnet-4-6":{"variants":{"low":{},"high":{}}}}}]}`)
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
	s.ModelCatalogClient = &http.Client{Transport: &attachmentCatalogTransport{status: 200, body: testModelCatalog}}
	original := f.server.Config.Handler
	f.server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/provider" {
			io.WriteString(w, `{"all":[{"id":"anthropic","models":{"claude-sonnet-4-6":{"variants":{"high":{}}}}}]}`)
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
