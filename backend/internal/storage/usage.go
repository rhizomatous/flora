package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"math"
)

// UsageSummary contains reported tokens and runtime-estimated USD, not provider bills.
// Reasoning is kept separate because provider output totals may already include it.
type UsageSummary struct {
	ReconciledRevision string   `json:"-"`
	CostUSD            *float64 `json:"costUSD"`
	Steps              int64    `json:"steps"`
	UnpricedSteps      int64    `json:"unpricedSteps"`
	Input              int64    `json:"input"`
	Output             int64    `json:"output"`
	Reasoning          int64    `json:"reasoning"`
	CacheRead          int64    `json:"cacheRead"`
	CacheWrite         int64    `json:"cacheWrite"`
	Partial            bool     `json:"partial"`
	CheckedAt          string   `json:"checkedAt"`
	Collection         string   `json:"collection"`
	TokensMissing      bool     `json:"tokensMissing"`
	CostMissing        bool     `json:"costMissing"`
}

type usagePayload struct {
	Info struct {
		ID       string `json:"id"`
		Role     string `json:"role"`
		ParentID string `json:"parentID"`
		Provider string `json:"providerID"`
		Model    string `json:"modelID"`
		Time     struct {
			Created   int64 `json:"created"`
			Completed int64 `json:"completed"`
		} `json:"time"`
	} `json:"info"`
	Parts []struct {
		ID     string   `json:"id"`
		Type   string   `json:"type"`
		Cost   *float64 `json:"cost"`
		Tokens struct {
			Input     *float64 `json:"input"`
			Output    *float64 `json:"output"`
			Reasoning *float64 `json:"reasoning"`
			Cache     struct {
				Read  *float64 `json:"read"`
				Write *float64 `json:"write"`
			} `json:"cache"`
		} `json:"tokens"`
	} `json:"parts"`
}

func tokenCount(n *float64) *int64 {
	if n == nil || math.IsNaN(*n) || math.IsInf(*n, 0) || *n < 0 || *n > 1e12 || math.Trunc(*n) != *n {
		return nil
	}
	value := int64(*n)
	return &value
}

func estimatedCost(value *float64, pricingKnown bool) *int64 {
	if value == nil || math.IsNaN(*value) || math.IsInf(*value, 0) || *value < 0 || *value > 1e6 || (*value == 0 && !pricingKnown) {
		return nil
	}
	nanos := int64(math.Round(*value * 1e9))
	return &nanos
}

// SaveUsageMessage upserts a snapshot scoped to its owning chat and runtime session.
// Callers serialize snapshots, verify session ancestry, and redact payloads first.
// revision is the chat timestamp observed before fetching runtime history. When
// it changed, prefer the main transcript snapshot saved during that fetch.
// A zero cost is only priced when the model's pricing metadata was available.
func (s *Store) SaveUsageMessage(ctx context.Context, chatID, sessionID, turnID, revision string, raw json.RawMessage, pricingKnown bool) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		// Main transcript capture can advance while the background worker reads
		// runtime history. Read its latest committed snapshot in this transaction.
		var identity usagePayload
		_ = json.Unmarshal(raw, &identity)
		var latest string
		err := tx.QueryRowContext(ctx, `SELECT m.payload FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.chat_id=? AND c.session_id=? AND m.runtime_message_id=? AND m.role='assistant' AND c.updated_at<>?`, chatID, sessionID, identity.Info.ID, revision).Scan(&latest)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		if err == nil {
			raw = json.RawMessage(latest)
		}
		return saveUsageMessage(ctx, tx, chatID, sessionID, turnID, raw, pricingKnown)
	})
}

func saveUsageMessage(ctx context.Context, tx *sql.Tx, chatID, sessionID, turnID string, raw json.RawMessage, pricingKnown bool) error {
	var m usagePayload
	// An incompatible optional accounting payload must not block transcript capture.
	if err := json.Unmarshal(raw, &m); err != nil {
		// Preserve a missing-usage marker if optional counters are malformed.
		var identity struct {
			Info json.RawMessage `json:"info"`
		}
		if json.Unmarshal(raw, &identity) != nil || json.Unmarshal(identity.Info, &m.Info) != nil {
			return nil
		}
		m.Parts = nil
	}
	if m.Info.Role != "assistant" || m.Info.ID == "" || sessionID == "" {
		return nil
	}
	if turnID == "" {
		if err := tx.QueryRowContext(ctx, `SELECT id FROM messages WHERE chat_id=? AND runtime_message_id=? AND role='user' AND EXISTS(SELECT 1 FROM chats WHERE id=? AND session_id=?)`, chatID, m.Info.ParentID, chatID, sessionID).Scan(&turnID); err != nil && err != sql.ErrNoRows {
			return err
		}
	}
	var previousRaw string
	var previousTurn sql.NullString
	var previousPricing bool
	err := tx.QueryRowContext(ctx, `SELECT payload,turn_id,pricing_known FROM usage_messages WHERE chat_id=? AND session_id=? AND message_id=?`, chatID, sessionID, m.Info.ID).Scan(&previousRaw, &previousTurn, &previousPricing)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if err == nil && previousRaw == string(raw) && (turnID == "" || previousTurn.String == turnID) && (!pricingKnown || previousPricing) {
		return nil
	}
	pricingKnown = pricingKnown || previousPricing
	incomplete := false
	count := 0
	for _, p := range m.Parts {
		if p.Type == "step-finish" {
			count++
			if p.ID == "" || estimatedCost(p.Cost, pricingKnown) == nil {
				incomplete = true
			}
		}
	}
	if count == 0 && m.Info.Time.Completed > 0 {
		incomplete = true
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO usage_messages VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(chat_id,session_id,message_id) DO UPDATE SET turn_id=coalesce(excluded.turn_id,usage_messages.turn_id),provider=excluded.provider,model=excluded.model,created_ms=excluded.created_ms,payload=excluded.payload,incomplete=excluded.incomplete,pricing_known=excluded.pricing_known`, chatID, sessionID, m.Info.ID, nullString(turnID), m.Info.Provider, m.Info.Model, m.Info.Time.Created, string(raw), incomplete, pricingKnown)
	if err != nil {
		return err
	}
	for _, p := range m.Parts {
		if p.Type != "step-finish" || p.ID == "" {
			continue
		}
		cost := estimatedCost(p.Cost, pricingKnown)
		_, err = tx.ExecContext(ctx, `INSERT INTO usage_steps VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(chat_id,session_id,message_id,step_id) DO UPDATE SET cost_nanos=coalesce(excluded.cost_nanos,usage_steps.cost_nanos),input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,reasoning_tokens=excluded.reasoning_tokens,cache_read_tokens=excluded.cache_read_tokens,cache_write_tokens=excluded.cache_write_tokens`, chatID, sessionID, m.Info.ID, p.ID, cost, tokenCount(p.Tokens.Input), tokenCount(p.Tokens.Output), tokenCount(p.Tokens.Reasoning), tokenCount(p.Tokens.Cache.Read), tokenCount(p.Tokens.Cache.Write))
		if err != nil {
			return err
		}
	}
	return nil
}

func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

type UsageCapture struct {
	Complete bool
	Reason   string
	Revision string
}

// SetUsageCapture records collection progress without changing the chat revision
// or its sidebar order. Previously reported spending remains saved on failure.
func (s *Store) SetUsageCapture(ctx context.Context, chatID string, result UsageCapture) error {
	if result.Complete {
		result.Reason = ""
	} else if result.Reason == "" {
		result.Reason = "history_unavailable"
	}

	return s.write(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO usage_capture(chat_id,complete,checked_at,reason,chat_revision) VALUES(?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET complete=excluded.complete,checked_at=excluded.checked_at,reason=excluded.reason,chat_revision=excluded.chat_revision`, chatID, result.Complete, now(), result.Reason, result.Revision)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO activity (chat_id,event_id,kind,payload,created_at) VALUES (?,?,?,?,?)", chatID, id(), "usage.updated", "{}", now())
		return err
	})
}

func (s *Store) ChatUsage(ctx context.Context, chatID string) (UsageSummary, error) {
	var u UsageSummary
	var nanos sql.NullInt64
	var missing int64
	var incomplete, complete bool
	err := s.db.QueryRowContext(ctx, `SELECT count(*),sum(cost_nanos),count(*)-count(cost_nanos),
        coalesce(sum(input_tokens),0),coalesce(sum(output_tokens),0),coalesce(sum(reasoning_tokens),0),
        coalesce(sum(cache_read_tokens),0),coalesce(sum(cache_write_tokens),0),
        coalesce(sum(input_tokens IS NULL OR output_tokens IS NULL OR reasoning_tokens IS NULL OR cache_read_tokens IS NULL OR cache_write_tokens IS NULL),0),
        EXISTS(SELECT 1 FROM usage_messages WHERE chat_id=? AND incomplete=1),
        coalesce((SELECT complete FROM usage_capture WHERE chat_id=?),0),
        coalesce((SELECT checked_at FROM usage_capture WHERE chat_id=?),''),
        coalesce((SELECT reason FROM usage_capture WHERE chat_id=?),''),
        coalesce((SELECT chat_revision FROM usage_capture WHERE chat_id=?),'')
        FROM usage_steps WHERE chat_id=?`, chatID, chatID, chatID, chatID, chatID, chatID).Scan(&u.Steps, &nanos, &u.UnpricedSteps, &u.Input, &u.Output, &u.Reasoning, &u.CacheRead, &u.CacheWrite, &missing, &incomplete, &complete, &u.CheckedAt, &u.Collection, &u.ReconciledRevision)
	if err != nil {
		return u, err
	}
	if nanos.Valid {
		cost := float64(nanos.Int64) / 1e9
		u.CostUSD = &cost
	}
	if complete {
		u.Collection = "complete"
	} else if u.Collection == "" {
		u.Collection = "pending"
	}
	u.CostMissing = incomplete
	u.TokensMissing = missing > 0
	u.Partial = u.Collection == "history_unavailable" || u.Collection == "runtime_stopped" || incomplete || u.UnpricedSteps > 0
	return u, nil
}

// backfillUsage uses retained snapshots once during schema migration. Historic child
// sessions and unreported usage remain unknown until runtime reconciliation succeeds.
func backfillUsage(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, `SELECT m.chat_id,coalesce(c.session_id,''),m.id FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.role='assistant'`)
	if err != nil {
		return err
	}
	type saved struct{ chat, session, message string }
	var all []saved
	for rows.Next() {
		var m saved
		if err := rows.Scan(&m.chat, &m.session, &m.message); err != nil {
			rows.Close()
			return err
		}
		all = append(all, m)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, m := range all {
		var raw string
		if err := tx.QueryRowContext(ctx, "SELECT payload FROM messages WHERE id=?", m.message).Scan(&raw); err != nil {
			return err
		}
		if err := saveUsageMessage(ctx, tx, m.chat, m.session, "", json.RawMessage(raw), false); err != nil {
			return err
		}
	}
	return nil
}

// Recompute cost-gap markers after separating unfinished responses from missing
// reported costs. Keep all step records and the original capture timestamps.
func rebuildUsageMarkers(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `UPDATE usage_messages SET incomplete =
        CASE WHEN coalesce(json_extract(payload,'$.info.time.completed'),0)>0
            AND NOT EXISTS(SELECT 1 FROM json_each(payload,'$.parts') WHERE json_extract(value,'$.type')='step-finish') THEN 1
        ELSE EXISTS(SELECT 1 FROM json_each(payload,'$.parts') WHERE json_extract(value,'$.type')='step-finish' AND (
            json_extract(value,'$.id') IS NULL OR json_extract(value,'$.id')='' OR
            json_type(value,'$.cost') NOT IN ('integer','real') OR json_extract(value,'$.cost') IS NULL OR
            json_extract(value,'$.cost')<0 OR json_extract(value,'$.cost')>1000000 OR
            (json_extract(value,'$.cost')=0 AND pricing_known=0))) END`)
	return err
}
