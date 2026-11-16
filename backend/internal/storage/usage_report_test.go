package storage

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestUsageReportDateBoundariesAndBreakdowns(t *testing.T) {
	s := openTest(t, t.TempDir())
	p, c := fixture(t, s)
	second, err := s.CreateProject(ctx, "Garden", p.Configuration)
	must(t, err)
	other, err := s.CreateChat(ctx, second.ID, "Another chat", image, "1")
	must(t, err)
	start := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	save := func(chat, session, id, model string, stamp time.Time, cost string) {
		raw := strings.ReplaceAll(string(usageFixture(id, "user", cost, 100)), `"created":100`, `"created":`+strconv.FormatInt(stamp.UnixMilli(), 10))
		raw = strings.ReplaceAll(raw, `"modelID":"model"`, `"modelID":"`+model+`"`)
		must(t, s.SaveUsageMessage(ctx, chat, session, "", "", json.RawMessage(raw)))
	}
	for range 2 {
		save(c.ID, "root", "same", "a", start, "0.01")
		save(c.ID, "child", "same", "b", start.Add(time.Hour), "0.02")
	}
	save(other.ID, "root", "other", "a", end.Add(-time.Millisecond), "0.04")
	save(c.ID, "root", "before", "a", start.Add(-time.Millisecond), "9")
	save(c.ID, "root", "after", "a", end, "9")
	r, err := s.UsageReport(ctx, start, end)
	must(t, err)
	if r.Total.CostUSD == nil || *r.Total.CostUSD != 0.07 || r.Total.Steps != 3 || r.Total.Tokens != 570 || r.Total.Reasoning != 15 {
		t.Fatalf("incorrect totals: %+v", r.Total)
	}
	if len(r.Chats) != 2 || len(r.Models) != 2 || len(r.Projects) != 2 || len(r.Series) != 24 {
		t.Fatalf("incorrect groups: %+v", r)
	}
	for _, project := range r.Projects {
		want := 0.03
		if project.ID == second.ID {
			want = 0.04
		}
		if project.CostUSD == nil || *project.CostUSD != want {
			t.Fatalf("usage assigned to wrong project: %+v", project)
		}
	}
	for _, groups := range [][]UsageGroup{r.Chats, r.Models, r.Projects, r.Series} {
		var sum int64
		for _, g := range groups {
			sum += g.Tokens
		}
		if sum != r.Total.Tokens {
			t.Fatal("breakdown does not match total")
		}
	}
	if r.Series[0].Steps != 1 || r.Series[1].Steps != 1 || r.Series[23].Steps != 1 {
		t.Fatal("runtime dates were not bucketed correctly")
	}
	empty, err := s.UsageReport(ctx, end.Add(time.Hour), end.Add(2*time.Hour))
	must(t, err)
	if empty.Total.CostUSD != nil || empty.Total.Steps != 0 || len(empty.Chats) != 0 {
		t.Fatal("empty period became reported zero")
	}
	save(c.ID, "root", "free", "a", end.Add(time.Hour), "0")
	free, err := s.UsageReport(ctx, end.Add(time.Hour), end.Add(2*time.Hour))
	must(t, err)
	if free.Total.CostUSD == nil || *free.Total.CostUSD != 0 {
		t.Fatal("reported zero lost")
	}
	if _, err := s.UsageReport(ctx, end, start); err != ErrInvalid {
		t.Fatal("reversed range accepted")
	}
}
