package storage

import (
	"encoding/json"
	"fmt"
	"testing"
)

func usageFixture(id, parent string, cost string, input int) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{"info":{"id":%q,"role":"assistant","parentID":%q,"providerID":"provider","modelID":"model","cost":999,"time":{"created":100,"completed":200}},"parts":[{"id":"step","type":"step-finish","cost":%s,"tokens":{"input":%d,"output":20,"reasoning":5,"cache":{"read":30,"write":40}}}]}`, id, parent, cost, input))
}

func TestUsageReconciliationIsolationAndReopen(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	p, c := fixture(t, s)
	must(t, s.BindRuntime(ctx, c.ID, "container", "root"))
	accepted, err := s.AcceptMessage(ctx, c.ID, "request", "work")
	must(t, err)
	must(t, s.LinkRuntimeMessage(ctx, c.ID, accepted.Message.ID, "user"))
	other, err := s.CreateChat(ctx, p.ID, "Other", image, "1")
	must(t, err)
	for range 3 {
		must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", usageFixture("same", "user", "0.01", 100)))
		must(t, s.SaveUsageMessage(ctx, c.ID, "child", accepted.Message.ID, "", usageFixture("same", "child-user", "0.02", 200)))
		must(t, s.SaveUsageMessage(ctx, other.ID, "root", "", "", usageFixture("same", "user", "9", 900)))
	}
	must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", usageFixture("same", "user", "0.015", 150)))
	must(t, s.SetUsageCapture(ctx, c.ID, UsageCapture{Complete: true, Revision: c.UpdatedAt}))
	must(t, s.Close())
	s = openTest(t, root)
	u, err := s.ChatUsage(ctx, c.ID)
	must(t, err)
	if u.Steps != 2 || u.CostUSD == nil || *u.CostUSD != 0.035 || u.Input != 350 || u.Output != 40 || u.Reasoning != 10 || u.CacheRead != 60 || u.CacheWrite != 80 {
		t.Fatalf("wrong reconciled usage: %+v", u)
	}
	var turns int
	must(t, s.db.QueryRow(`SELECT count(*) FROM usage_messages WHERE chat_id=? AND turn_id=?`, c.ID, accepted.Message.ID).Scan(&turns))
	if turns != 2 {
		t.Fatal("lost turn attribution")
	}
	must(t, s.SetUsageCapture(ctx, c.ID, UsageCapture{Revision: c.UpdatedAt}))
	u, err = s.ChatUsage(ctx, c.ID)
	must(t, err)
	if u.Collection != "history_unavailable" || *u.CostUSD != 0.035 {
		t.Fatal("capture failure erased known spending")
	}
}

func TestUsageReportedZeroAndInvalidCounters(t *testing.T) {
	s := openTest(t, t.TempDir())
	_, c := fixture(t, s)
	for _, test := range []struct {
		cost  string
		known bool
	}{{"null", false}, {"0", true}, {"0.002", true}} {
		id := test.cost
		must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", usageFixture(id, "user", test.cost, 10)))
		var cost any
		must(t, s.db.QueryRow(`SELECT cost_nanos FROM usage_steps WHERE chat_id=? AND message_id=?`, c.ID, id).Scan(&cost))
		if (cost != nil) != test.known {
			t.Fatalf("cost=%s saved=%v", test.cost, cost)
		}
	}
	must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", json.RawMessage(`{"info":{"id":"missing","role":"assistant","time":{"completed":1}},"parts":[{"type":"step-finish","id":"step","cost":0.1,"tokens":{"input":-1,"output":2.5}}]}`)))
	must(t, s.SetUsageCapture(ctx, c.ID, UsageCapture{Complete: true, Revision: c.UpdatedAt}))
	u, err := s.ChatUsage(ctx, c.ID)
	must(t, err)
	if u.Input != 30 || u.Output != 60 {
		t.Fatalf("missing data was reported as known: %+v", u)
	}
}

func TestUsageBackfillAndAtomicTranscriptSave(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	_, c := fixture(t, s)
	must(t, s.BindRuntime(ctx, c.ID, "container", "root"))
	m := Message{ChatID: c.ID, RuntimeMessageID: "assistant", Role: "assistant", Payload: usageFixture("assistant", "user", "0.01", 100)}
	must(t, s.SaveRuntimeMessage(ctx, "first", m))
	_, err := s.db.Exec(`DROP INDEX chats_folder; ALTER TABLE chats DROP COLUMN folder_id; DROP TABLE chat_folders; DROP TABLE chat_read_state; ALTER TABLE chat_requests DROP COLUMN branches; ALTER TABLE chats DROP COLUMN execution; ALTER TABLE chat_requests DROP COLUMN selection; DROP TABLE attachments; ALTER TABLE chat_requests DROP COLUMN attachments; ALTER TABLE chats DROP COLUMN pinned_at; ALTER TABLE chats DROP COLUMN archived; ALTER TABLE chats DROP COLUMN organization_revision; DROP TABLE subagent_messages; DROP TABLE subagents; DROP TABLE automation_runs; DROP TABLE automations; DROP TABLE context_limits; DROP TABLE usage_steps; DROP TABLE usage_messages; DROP TABLE usage_capture; PRAGMA user_version=5`)
	must(t, err)
	must(t, s.Close())
	s = openTest(t, root)
	u, err := s.ChatUsage(ctx, c.ID)
	must(t, err)
	if u.Steps != 1 || u.CostUSD == nil || *u.CostUSD != 0.01 || u.Collection != "pending" {
		t.Fatalf("incorrect historical backfill: %+v", u)
	}
	_, err = s.db.Exec(`CREATE TRIGGER fail_usage_activity BEFORE INSERT ON activity WHEN NEW.kind='message.runtime' BEGIN SELECT RAISE(ABORT,'injected'); END`)
	must(t, err)
	m.Payload = usageFixture("assistant", "user", "0.02", 200)
	if err := s.SaveRuntimeMessage(ctx, "second", m); err == nil {
		t.Fatal("expected write failure")
	}
	u, err = s.ChatUsage(ctx, c.ID)
	must(t, err)
	if *u.CostUSD != 0.01 || u.Input != 100 {
		t.Fatal("usage escaped failed transcript transaction")
	}
	must(t, s.Close())
	s = openTest(t, root)
	u, err = s.ChatUsage(ctx, c.ID)
	must(t, err)
	if u.Steps != 1 || *u.CostUSD != 0.01 {
		t.Fatal("reopening duplicated backfill")
	}
}

func TestUsageRetainsReportedCostWhenLaterSnapshotOmitsIt(t *testing.T) {
	s := openTest(t, t.TempDir())
	_, c := fixture(t, s)
	must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", usageFixture("message", "user", "0.01", 100)))
	must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", usageFixture("message", "user", "null", 200)))
	must(t, s.SetUsageCapture(ctx, c.ID, UsageCapture{Complete: true, Revision: c.UpdatedAt}))
	u, err := s.ChatUsage(ctx, c.ID)
	must(t, err)
	if u.CostUSD == nil || *u.CostUSD != 0.01 || u.Input != 200 {
		t.Fatalf("missing latest cost was hidden: %+v", u)
	}
}

func TestUsageBackgroundSnapshotCannotOverwriteNewerTranscript(t *testing.T) {
	s := openTest(t, t.TempDir())
	_, c := fixture(t, s)
	must(t, s.BindRuntime(ctx, c.ID, "container", "root"))
	latest := usageFixture("message", "user", "0.02", 200)
	must(t, s.SaveRuntimeMessage(ctx, "latest", Message{ChatID: c.ID, RuntimeMessageID: "message", Role: "assistant", Payload: latest}))
	must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", usageFixture("message", "user", "0.01", 100)))
	u, err := s.ChatUsage(ctx, c.ID)
	must(t, err)
	if u.CostUSD == nil || *u.CostUSD != 0.02 || u.Input != 200 {
		t.Fatalf("stale background read overwrote latest usage: %+v", u)
	}
	current, err := s.Chat(ctx, c.ID)
	must(t, err)
	must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", current.UpdatedAt, usageFixture("message", "user", "0.03", 300)))
	u, err = s.ChatUsage(ctx, c.ID)
	must(t, err)
	if u.CostUSD == nil || *u.CostUSD != 0.03 || u.Input != 300 {
		t.Fatalf("fresh history could not repair a saved snapshot: %+v", u)
	}
}

func TestUnreportedUsageStaysUnknownAndMissingTokensDoNotEraseCost(t *testing.T) {
	s := openTest(t, t.TempDir())
	_, c := fixture(t, s)
	must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", json.RawMessage(`{"info":{"id":"running","role":"assistant"},"parts":[]}`)))
	must(t, s.SetUsageCapture(ctx, c.ID, UsageCapture{Complete: true}))
	u, err := s.ChatUsage(ctx, c.ID)
	must(t, err)
	if u.CostUSD != nil {
		t.Fatal("unfinished response treated as a missing cost")
	}
	must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", json.RawMessage(`{"info":{"id":"reported","role":"assistant","time":{"completed":1}},"parts":[{"type":"step-finish","id":"step","cost":0.01,"tokens":{"input":1}}]}`)))
	u, err = s.ChatUsage(ctx, c.ID)
	must(t, err)
	if u.CostUSD == nil || *u.CostUSD != 0.01 {
		t.Fatalf("missing token fields changed cost completeness: %+v", u)
	}
}

func TestUsageMigrationRestoresReportedZero(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	_, c := fixture(t, s)
	must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", usageFixture("zero", "user", "0", 100)))
	_, err := s.db.Exec(`DROP INDEX chats_folder; ALTER TABLE chats DROP COLUMN folder_id; DROP TABLE chat_folders; ALTER TABLE usage_messages ADD COLUMN incomplete INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE usage_messages ADD COLUMN pricing_known INTEGER NOT NULL DEFAULT 0;
 UPDATE usage_steps SET cost_nanos=NULL;
 DROP INDEX usage_messages_created;
 DROP TABLE chat_read_state; ALTER TABLE chat_requests DROP COLUMN branches; ALTER TABLE chats DROP COLUMN execution; ALTER TABLE chat_requests DROP COLUMN selection; DROP TABLE attachments; ALTER TABLE chat_requests DROP COLUMN attachments; ALTER TABLE chats DROP COLUMN pinned_at; ALTER TABLE chats DROP COLUMN archived; ALTER TABLE chats DROP COLUMN organization_revision; DROP TABLE subagent_messages; DROP TABLE subagents; DROP TABLE automation_runs; DROP TABLE automations; DROP TABLE context_limits;
 PRAGMA user_version=7;`)
	must(t, err)
	must(t, s.Close())
	s = openTest(t, root)
	u, err := s.ChatUsage(ctx, c.ID)
	must(t, err)
	if u.CostUSD == nil || *u.CostUSD != 0 || u.Input != 100 || u.Steps != 1 {
		t.Fatalf("reported zero lost during migration: %+v", u)
	}
}
