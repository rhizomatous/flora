package storage

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestReportedMainSessionModel(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	_, c := fixture(t, s)
	must(t, s.BindRuntime(ctx, c.ID, "container", "main"))
	save := func(session, id, provider, model string, created, completed int, parts string) {
		t.Helper()
		raw := json.RawMessage(fmt.Sprintf(`{"info":{"id":%q,"role":"assistant","providerID":%q,"modelID":%q,"time":{"created":%d,"completed":%d}},"parts":%s}`, id, provider, model, created, completed, parts))
		must(t, s.SaveUsageMessage(ctx, c.ID, session, "", "", raw))
	}
	check := func(provider, model string, count int, hasCall bool) {
		t.Helper()
		u, err := s.ChatModel(ctx, c.ID)
		must(t, err)
		if u.Models != count || (u.Latest != nil) != hasCall || (hasCall && *u.Latest != (ReportedModel{Provider: provider, Model: model})) {
			t.Fatalf("unexpected model summary: %+v latest=%+v", u, u.Latest)
		}
	}
	check("", "", 0, false)
	save("child", "child", "other", "child-model", 99, 100, "[]")
	check("", "", 0, false)
	save("main", "first", "provider", "a", 1, 2, "[]")
	save("main", "pending", "provider", "b", 3, 0, "[]")
	check("provider", "a", 1, true)
	// A step report counts even when optional usage counters are absent or invalid.
	save("main", "second", "provider", "b", 4, 0, `[{"type":"step-finish","tokens":{"input":"unknown"}}]`)
	check("provider", "b", 2, true)
	save("main", "third", "provider", "a", 5, 6, "[]")
	check("provider", "a", 2, true)
	save("main", "z-tie", "other-provider", "a", 5, 6, "[]")
	check("other-provider", "a", 3, true)
	save("main", "missing", "", "", 7, 8, "[]")
	check("", "", 3, true)
	save("main", "partial", "", "reported-model", 9, 10, "[]")
	check("", "reported-model", 4, true)
	must(t, s.Close())
	s = openTest(t, root)
	check("", "reported-model", 4, true)
}
