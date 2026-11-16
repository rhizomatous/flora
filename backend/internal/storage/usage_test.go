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
		must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", usageFixture("same", "user", "0.01", 100), true))
		must(t, s.SaveUsageMessage(ctx, c.ID, "child", accepted.Message.ID, "", usageFixture("same", "child-user", "0.02", 200), true))
		must(t, s.SaveUsageMessage(ctx, other.ID, "root", "", "", usageFixture("same", "user", "9", 900), true))
	}
	must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", usageFixture("same", "user", "0.015", 150), true))
	must(t, s.SetUsageCapture(ctx, c.ID, UsageCapture{Complete: true, Revision: c.UpdatedAt}))
	must(t, s.Close())
	s = openTest(t, root)
	u, err := s.ChatUsage(ctx, c.ID)
	must(t, err)
	if u.Steps != 2 || u.CostUSD == nil || *u.CostUSD != 0.035 || u.Input != 350 || u.Output != 40 || u.Reasoning != 10 || u.CacheRead != 60 || u.CacheWrite != 80 || u.Partial {
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
	if !u.Partial || *u.CostUSD != 0.035 {
		t.Fatal("capture failure erased known spending")
	}
}

func TestUsageUnknownPricingAndMissingTokens(t *testing.T) {
	s := openTest(t, t.TempDir())
	_, c := fixture(t, s)
	for _, test := range []struct {
		cost   string
		priced bool
		known  bool
	}{{"null", false, false}, {"0", false, false}, {"0", true, true}, {"0.002", false, true}} {
		id := fmt.Sprint(test.cost, test.priced)
		must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", usageFixture(id, "user", test.cost, 10), test.priced))
		var cost any
		must(t, s.db.QueryRow(`SELECT cost_nanos FROM usage_steps WHERE chat_id=? AND message_id=?`, c.ID, id).Scan(&cost))
		if (cost != nil) != test.known {
			t.Fatalf("cost=%s priced=%v saved=%v", test.cost, test.priced, cost)
		}
	}
	must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", json.RawMessage(`{"info":{"id":"missing","role":"assistant","time":{"completed":1}},"parts":[{"type":"step-finish","id":"step","cost":0.1,"tokens":{"input":-1,"output":2.5}}]}`), true))
	must(t, s.SetUsageCapture(ctx, c.ID, UsageCapture{Complete: true, Revision: c.UpdatedAt}))
	u, err := s.ChatUsage(ctx, c.ID)
	must(t, err)
	if !u.Partial || u.UnpricedSteps != 2 || u.Input != 40 || u.Output != 80 {
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
	_, err := s.db.Exec(`DROP TABLE usage_steps; DROP TABLE usage_messages; DROP TABLE usage_capture; PRAGMA user_version=5`)
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

func TestUsageRetainsReportedCostButMarksAnIncompleteRevision(t *testing.T) {
	s := openTest(t, t.TempDir())
	_, c := fixture(t, s)
	must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", usageFixture("message", "user", "0.01", 100), false))
	must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", usageFixture("message", "user", "null", 200), false))
	must(t, s.SetUsageCapture(ctx, c.ID, UsageCapture{Complete: true, Revision: c.UpdatedAt}))
	u, err := s.ChatUsage(ctx, c.ID)
	must(t, err)
	if u.CostUSD == nil || *u.CostUSD != 0.01 || !u.Partial || u.Input != 200 {
		t.Fatalf("missing latest cost was hidden: %+v", u)
	}
}

func TestUsageBackgroundSnapshotCannotOverwriteNewerTranscript(t *testing.T) {
	s := openTest(t, t.TempDir())
	_, c := fixture(t, s)
	must(t, s.BindRuntime(ctx, c.ID, "container", "root"))
	latest := usageFixture("message", "user", "0.02", 200)
	must(t, s.SaveRuntimeMessage(ctx, "latest", Message{ChatID: c.ID, RuntimeMessageID: "message", Role: "assistant", Payload: latest}))
	must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", usageFixture("message", "user", "0.01", 100), true))
	u, err := s.ChatUsage(ctx, c.ID)
	must(t, err)
	if u.CostUSD == nil || *u.CostUSD != 0.02 || u.Input != 200 {
		t.Fatalf("stale background read overwrote latest usage: %+v", u)
	}
	current, err := s.Chat(ctx, c.ID)
	must(t, err)
	must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", current.UpdatedAt, usageFixture("message", "user", "0.03", 300), true))
	u, err = s.ChatUsage(ctx, c.ID)
	must(t, err)
	if u.CostUSD == nil || *u.CostUSD != 0.03 || u.Input != 300 {
		t.Fatalf("fresh history could not repair a saved snapshot: %+v", u)
	}
}

func TestRunningResponsesAndMissingTokenCountsDoNotMarkCostPartial(t *testing.T) {
	s := openTest(t, t.TempDir())
	_, c := fixture(t, s)
	must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", json.RawMessage(`{"info":{"id":"running","role":"assistant"},"parts":[]}`), false))
	must(t, s.SetUsageCapture(ctx, c.ID, UsageCapture{Complete: true}))
	u, err := s.ChatUsage(ctx, c.ID)
	must(t, err)
	if u.Partial || u.CostMissing {
		t.Fatal("unfinished response treated as a missing cost")
	}
	must(t, s.SaveUsageMessage(ctx, c.ID, "root", "", "", json.RawMessage(`{"info":{"id":"reported","role":"assistant","time":{"completed":1}},"parts":[{"type":"step-finish","id":"step","cost":0.01,"tokens":{"input":1}}]}`), true))
	u, err = s.ChatUsage(ctx, c.ID)
	must(t, err)
	if u.Partial || !u.TokensMissing || u.CostUSD == nil || *u.CostUSD != 0.01 {
		t.Fatalf("missing token fields changed cost completeness: %+v", u)
	}
}
