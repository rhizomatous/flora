package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/provisioning"
)

func TestCapturePreservesUsageAcrossUpdatesAndTerminalOutcomes(t *testing.T) {
	for _, outcome := range []struct {
		name, errorJSON string
	}{
		{"completed", "null"},
		{"failed", `{"name":"APIError","data":{"message":"request failed"}}`},
		{"interrupted", `{"name":"MessageAbortedError","data":{"message":"aborted"}}`},
	} {
		t.Run(outcome.name, func(t *testing.T) {
			f := newFixture(t)
			s, _, project := testService(t, f)
			c, accepted := savedRecoveryTurn(t, s, project)
			rt := newRuntime(provisioning.Endpoint{URL: f.server.URL, Username: "opencode", Password: "runtime_SECRET"})
			ctx := context.Background()
			user := json.RawMessage(`{"info":{"id":"user-1","role":"user"},"parts":[{"type":"text","text":"original input"}]}`)
			step := `{"id":"step-1","type":"step-finish","cost":0.0123,"tokens":{"input":123,"output":45,"reasoning":6,"cache":{"read":78,"write":9}}}`
			snapshots := []json.RawMessage{
				json.RawMessage(`{"info":{"id":"assistant-1","role":"assistant","parentID":"user-1","providerID":"fixture","modelID":"model","cost":0.0123},"parts":[` + step + `]}`),
				json.RawMessage(fmt.Sprintf(`{"info":{"id":"assistant-1","role":"assistant","parentID":"user-1","providerID":"fixture","modelID":"model","cost":0.0456,"finish":"stop","time":{"completed":1},"error":%s},"parts":[%s,{"id":"step-2","type":"step-finish","cost":0.0333,"tokens":{"input":456,"output":78,"reasoning":9,"cache":{"read":12,"write":34}}}]}`, outcome.errorJSON, step)),
			}
			known, seen := map[string]bool{}, map[string][32]byte{}
			runtimeID, savedID := "", ""
			completed := false
			for _, snapshot := range snapshots {
				f.mu.Lock()
				f.history = []json.RawMessage{user, snapshot}
				f.mu.Unlock()
				for range 2 {
					if _, err := s.captureHistory(ctx, rt, c, nil, accepted.ID, &runtimeID, &completed, known, seen); err != nil {
						t.Fatal(err)
					}
					messages, err := s.Store.Messages(ctx, c.ID)
					if err != nil || len(messages) != 2 {
						t.Fatalf("capture must update one assistant record: messages=%d err=%v", len(messages), err)
					}
					assistant := messages[1]
					if savedID != "" && assistant.ID != savedID {
						t.Fatal("updating usage changed the saved message identity")
					}
					savedID = assistant.ID
					var want, got any
					if err := json.Unmarshal(snapshot, &want); err != nil {
						t.Fatal(err)
					}
					if err := json.Unmarshal(assistant.Payload, &got); err != nil {
						t.Fatal(err)
					}
					if !reflect.DeepEqual(got, want) {
						t.Fatalf("capture lost or changed runtime metadata: got %s, want %s", assistant.Payload, snapshot)
					}
				}
			}
			rows, err := s.Store.Activities(ctx, c.ID, 0, 1000)
			if err != nil {
				t.Fatal(err)
			}
			snapshotsSaved := 0
			for _, row := range rows {
				if row.Kind == "message.runtime" {
					snapshotsSaved++
				}
			}
			if snapshotsSaved != len(snapshots) {
				t.Fatalf("unchanged history produced duplicate snapshots: got %d, want %d", snapshotsSaved, len(snapshots))
			}
		})
	}
}
