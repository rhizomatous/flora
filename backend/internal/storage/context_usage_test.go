package storage

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestContextUsesLatestMainCallAndMatchingLimit(t *testing.T) {
	root := t.TempDir()
	s := openTest(t, root)
	_, c := fixture(t, s)
	must(t, s.BindRuntime(ctx, c.ID, "container", "main"))
	save := func(session, id, model string, created int, total string, input, output int, completed bool) {
		end := 0
		if completed {
			end = created + 1
		}
		cacheRead, cacheWrite := 50, 25
		if !completed {
			cacheRead, cacheWrite = 0, 0
		}
		raw := json.RawMessage(fmt.Sprintf(`{"info":{"id":%q,"role":"assistant","providerID":"provider","modelID":%q,"time":{"created":%d,"completed":%d},"tokens":{"total":%s,"input":%d,"output":%d,"reasoning":99,"cache":{"read":%d,"write":%d}}},"parts":[]}`, id, model, created, end, total, input, output, cacheRead, cacheWrite))
		must(t, s.SaveUsageMessage(ctx, c.ID, session, "", "", raw))
	}
	save("main", "old", "a", 1, "null", 800, 200, true)
	must(t, s.SaveContextLimit(ctx, c.ID, "provider", "a", 2000))
	save("child", "child", "a", 99, "90000", 90000, 0, true)
	save("main", "pending", "a", 3, "0", 0, 0, false)
	u, err := s.ChatContext(ctx, c.ID)
	must(t, err)
	if u.Tokens == nil || *u.Tokens != 1075 || u.Limit == nil || *u.Limit != 2000 {
		t.Fatalf("wrong main-session snapshot: %+v", u)
	}
	// A new call can be smaller after compaction. The runtime total wins over component sums.
	save("main", "new", "a", 4, "300", 100, 50, true)
	u, err = s.ChatContext(ctx, c.ID)
	must(t, err)
	if u.Tokens == nil || *u.Tokens != 300 {
		t.Fatalf("context accumulated instead of replacing: %+v", u)
	}
	must(t, s.Close())
	s = openTest(t, root)
	u, err = s.ChatContext(ctx, c.ID)
	must(t, err)
	if u.Limit == nil || *u.Limit != 2000 || u.Tokens == nil || *u.Tokens != 300 {
		t.Fatal("context did not survive reopening")
	}
	save("main", "different-model", "b", 5, "400", 100, 50, true)
	u, err = s.ChatContext(ctx, c.ID)
	must(t, err)
	if u.Limit != nil || u.Model != "b" || *u.Tokens != 400 {
		t.Fatal("previous model's limit leaked into the new model")
	}
}
