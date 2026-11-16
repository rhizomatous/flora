package storage

import (
	"context"
	"database/sql"
	"sort"
	"time"
)

type UsageTotals struct {
	CostUSD    *float64 `json:"costUSD"`
	Tokens     int64    `json:"tokens"`
	Input      int64    `json:"input"`
	Output     int64    `json:"output"`
	Reasoning  int64    `json:"reasoning"`
	CacheRead  int64    `json:"cacheRead"`
	CacheWrite int64    `json:"cacheWrite"`
	Steps      int64    `json:"steps"`
	nanos      int64
	priced     bool
}

type UsageGroup struct {
	ID           string `json:"id"`
	Label        string `json:"label"`
	Project      string `json:"project"`
	LastActivity string `json:"lastActivity"`
	UsageTotals
}

type UsageReport struct {
	From     string       `json:"from"`
	To       string       `json:"to"`
	Bucket   string       `json:"bucket"`
	Total    UsageTotals  `json:"total"`
	Series   []UsageGroup `json:"series"`
	Projects []UsageGroup `json:"projects"`
	Models   []UsageGroup `json:"models"`
	Chats    []UsageGroup `json:"chats"`
}

func (u *UsageTotals) add(v UsageTotals) {
	u.nanos += v.nanos
	u.priced = u.priced || v.priced
	if u.priced {
		cost := float64(u.nanos) / 1e9
		u.CostUSD = &cost
	}
	u.Input += v.Input
	u.Output += v.Output
	u.Reasoning += v.Reasoning
	u.CacheRead += v.CacheRead
	u.CacheWrite += v.CacheWrite
	u.Steps += v.Steps
	// Reasoning may already be included in output. Cache tokens are separate from input.
	u.Tokens = u.Input + u.Output + u.CacheRead + u.CacheWrite
}

func usageGroups(groups map[string]*UsageGroup) []UsageGroup {
	result := make([]UsageGroup, 0, len(groups))
	for _, g := range groups {
		result = append(result, *g)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}

// UsageReport selects runtime message timestamps in [from,to), independently of
// chat creation and collection time. Each persisted step joins its message once,
// so child sessions contribute to their owning chat without duplicating totals.
// Buckets use UTC and the same interval as every breakdown in this snapshot.
func (s *Store) UsageReport(ctx context.Context, from, to time.Time) (UsageReport, error) {
	report := UsageReport{From: from.UTC().Format(time.RFC3339), To: to.UTC().Format(time.RFC3339), Bucket: "day"}
	if !from.Before(to) || to.Sub(from) > 366*24*time.Hour {
		return report, ErrInvalid
	}
	bucket := int64((24 * time.Hour) / time.Millisecond)
	if to.Sub(from) <= 48*time.Hour {
		report.Bucket = "hour"
		bucket = int64(time.Hour / time.Millisecond)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT (m.created_ms/?)*?,c.id,c.title,p.id,p.name,m.provider,m.model,max(m.created_ms),
 sum(s.cost_nanos),count(*),coalesce(sum(s.input_tokens),0),coalesce(sum(s.output_tokens),0),coalesce(sum(s.reasoning_tokens),0),coalesce(sum(s.cache_read_tokens),0),coalesce(sum(s.cache_write_tokens),0)
 FROM usage_messages m JOIN usage_steps s ON s.chat_id=m.chat_id AND s.session_id=m.session_id AND s.message_id=m.message_id
 JOIN chats c ON c.id=m.chat_id JOIN projects p ON p.id=c.project_id
 WHERE m.created_ms>=? AND m.created_ms<?
 GROUP BY 1,c.id,p.id,m.provider,m.model`, bucket, bucket, from.UnixMilli(), to.UnixMilli())
	if err != nil {
		return report, err
	}
	defer rows.Close()
	series, projects, models, chats := map[string]*UsageGroup{}, map[string]*UsageGroup{}, map[string]*UsageGroup{}, map[string]*UsageGroup{}
	for ms := from.UnixMilli() / bucket * bucket; ms < to.UnixMilli(); ms += bucket {
		id := time.UnixMilli(ms).UTC().Format(time.RFC3339)
		series[id] = &UsageGroup{ID: id, Label: id}
	}
	for rows.Next() {
		var ms, last int64
		var chat, title, project, name, provider, model string
		var cost sql.NullInt64
		var totals UsageTotals
		if err = rows.Scan(&ms, &chat, &title, &project, &name, &provider, &model, &last, &cost, &totals.Steps, &totals.Input, &totals.Output, &totals.Reasoning, &totals.CacheRead, &totals.CacheWrite); err != nil {
			return report, err
		}
		totals.nanos = cost.Int64
		totals.priced = cost.Valid
		report.Total.add(totals)
		stamp := time.UnixMilli(ms).UTC().Format(time.RFC3339)
		lastActivity := time.UnixMilli(last).UTC().Format("2006-01-02T15:04:05.000Z")
		modelID := provider + "/" + model
		for _, target := range []struct {
			groups             map[string]*UsageGroup
			id, label, project string
		}{{series, stamp, stamp, ""}, {projects, project, name, ""}, {models, modelID, modelID, ""}, {chats, chat, title, name}} {
			g := target.groups[target.id]
			if g == nil {
				g = &UsageGroup{ID: target.id, Label: target.label, Project: target.project}
				target.groups[target.id] = g
			}
			g.add(totals)
			if lastActivity > g.LastActivity {
				g.LastActivity = lastActivity
			}
		}
	}
	if err = rows.Err(); err != nil {
		return report, err
	}
	report.Series = usageGroups(series)
	report.Projects = usageGroups(projects)
	report.Models = usageGroups(models)
	report.Chats = usageGroups(chats)
	return report, nil
}
