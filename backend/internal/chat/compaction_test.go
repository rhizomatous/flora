package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/provisioning"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestCompactionBounds(t *testing.T) {
	for _, test := range []struct {
		name      string
		model     ModelOption
		want      int64
		supported bool
	}{
		{"input limit", ModelOption{ContextLimit: 100000, InputLimit: 90000, OutputLimit: 8000}, 82000, true},
		{"output cap", ModelOption{ContextLimit: 400000, InputLimit: 272000, OutputLimit: 128000}, 252000, true},
		{"context only", ModelOption{ContextLimit: 200000, OutputLimit: 64000}, 168000, false},
		{"unknown", ModelOption{}, 0, false},
		{"invalid input", ModelOption{ContextLimit: 1000, InputLimit: 2000, OutputLimit: 200}, 1800, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			result := compactionBounds(test.model)
			if (result.Maximum != nil) != test.supported {
				t.Fatalf("support: %+v", result)
			}
			if test.want > 0 && (result.Default == nil || *result.Default != test.want) {
				t.Fatalf("default: %+v", result)
			}
			if !test.supported && result.Reason == "" {
				t.Fatal("missing explanation")
			}
		})
	}
}

func TestApplyCompactionValidatesRuntimeAndResetsOnModelChange(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	// Use the same installed identity and project setup as service fixtures.
	if err = store.SaveCredentials(ctx, storage.Credentials{Provider: "anthropic", Model: "fixture", ProviderKey: "offline-fixture", GitHubToken: "offline-fixture"}); err != nil {
		t.Fatal(err)
	}
	project, err := store.CreateProject(ctx, "fixture", storage.Configuration{Repositories: []storage.Repository{{Name: "octo/demo", URL: "https://github.com/octo/demo.git", BaseBranch: "main", Role: "core"}}})
	if err != nil {
		t.Fatal(err)
	}
	c, err := store.CreateChat(ctx, project.ID, "fixture", "flora@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1.2.27")
	if err != nil {
		t.Fatal(err)
	}
	e := storage.Execution{Provider: "anthropic", Model: "fixture"}
	threshold := int64(25000)
	if err = store.SetCompactionThreshold(ctx, c.ID, e, &threshold); err != nil {
		t.Fatal(err)
	}
	var reserved *int64
	input := int64(90000)
	patches, disposals := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/config":
			json.NewEncoder(w).Encode(map[string]any{"compaction": map[string]any{"reserved": reserved}})
		case "/provider":
			json.NewEncoder(w).Encode(map[string]any{"all": []any{map[string]any{"id": "anthropic", "models": map[string]any{"fixture": map[string]any{"limit": map[string]int64{"context": 100000, "input": input, "output": 8000}}, "other": map[string]any{"limit": map[string]int64{"context": 200000, "output": 32000}}}}}})
		case "/global/config":
			if r.Method != "PATCH" {
				t.Error("wrong method")
			}
			var body struct {
				Compaction struct {
					Reserved int64 `json:"reserved"`
				} `json:"compaction"`
			}
			json.NewDecoder(r.Body).Decode(&body)
			reserved = &body.Compaction.Reserved
			patches++
			w.Write([]byte(`{}`))
		case "/instance/dispose":
			disposals++
			w.Write([]byte(`true`))
		default:
			t.Errorf("unexpected runtime request: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	rt := newRuntime(provisioning.Endpoint{URL: server.URL})
	defer rt.client.CloseIdleConnections()
	service := &Service{Store: store}
	if err = service.applyCompaction(ctx, rt, c, e, &threshold); err != nil {
		t.Fatal(err)
	}
	if reserved == nil || *reserved != 65000 || patches != 1 || disposals != 1 {
		t.Fatal("setting not applied")
	}
	if err = service.applyCompaction(ctx, rt, c, e, &threshold); err != nil || patches != 1 {
		t.Fatal("unchanged setting rewrote config", err)
	}
	input = 0
	if err = service.applyCompaction(ctx, rt, c, e, &threshold); err == nil {
		t.Fatal("saved setting accepted after input support disappeared")
	}
	other := e
	other.Model = "other"
	if err = service.applyCompaction(ctx, rt, c, other, nil); err != nil {
		t.Fatal(err)
	}
	if *reserved != 20000 {
		t.Fatal("previous model reserve leaked")
	}
}

func TestAcceptedTurnKeepsCompactionChoice(t *testing.T) {
	f := newFixture(t)
	service, _, project := testService(t, f)
	c, err := service.Store.CreateChat(service.ctx, project.ID, "fixture", testImage, "1.2.27")
	if err != nil {
		t.Fatal(err)
	}
	e := storage.Execution{Provider: "anthropic", Model: "model"}
	threshold := int64(25000)
	if err = service.Store.SetCompactionThreshold(service.ctx, c.ID, e, &threshold); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Submit(service.ctx, c.ID, "first", "Remember the garden"); err != nil {
		t.Fatal(err)
	}
	threshold = 30000
	if err = service.Store.SetCompactionThreshold(service.ctx, c.ID, e, &threshold); err != nil {
		t.Fatal(err)
	}
	service.turnMu.Lock()
	job := service.jobs[c.ID]
	service.turnMu.Unlock()
	if job == nil || job.compactionThreshold == nil || *job.compactionThreshold != 25000 {
		t.Fatal("later preference changed accepted turn")
	}
}
