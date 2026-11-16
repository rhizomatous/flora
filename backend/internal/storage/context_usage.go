package storage

import (
	"context"
	"database/sql"
	"encoding/json"
)

type ContextUsage struct {
	Tokens   *int64 `json:"tokens"`
	Limit    *int64 `json:"limit"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
}

// ChatContext reads the latest reported main-session call, never sums steps or
// child sessions. A zeroed in-flight message leaves the previous report visible.
// OpenCode's total takes precedence; the fallback matches its compaction counter.
// Model limits are scoped to the runtime chat so overrides cannot leak across chats.
func (s *Store) ChatContext(ctx context.Context, chatID string) (ContextUsage, error) {
	var result ContextUsage
	rows, err := s.db.QueryContext(ctx, `SELECT m.payload,l.token_limit FROM usage_messages m
 JOIN chats c ON c.id=m.chat_id AND c.session_id=m.session_id
 LEFT JOIN context_limits l ON l.chat_id=m.chat_id AND l.provider=m.provider AND l.model=m.model
 WHERE m.chat_id=? ORDER BY m.created_ms DESC,m.message_id DESC`, chatID)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		var limit sql.NullInt64
		if err := rows.Scan(&raw, &limit); err != nil {
			return result, err
		}
		var payload struct {
			Info struct {
				Provider string `json:"providerID"`
				Model    string `json:"modelID"`
				Time     struct {
					Completed int64 `json:"completed"`
				} `json:"time"`
				Tokens struct {
					Total  *float64 `json:"total"`
					Input  *float64 `json:"input"`
					Output *float64 `json:"output"`
					Cache  struct {
						Read  *float64 `json:"read"`
						Write *float64 `json:"write"`
					} `json:"cache"`
				} `json:"tokens"`
			} `json:"info"`
			Parts []struct {
				Type string `json:"type"`
			} `json:"parts"`
		}
		if json.Unmarshal(raw, &payload) != nil {
			continue
		}
		t := payload.Info.Tokens
		total := tokenCount(t.Total)
		if total == nil || *total == 0 {
			var sum int64
			valid := true
			for _, n := range []*float64{t.Input, t.Output, t.Cache.Read, t.Cache.Write} {
				v := tokenCount(n)
				if v == nil {
					valid = false
					break
				}
				sum += *v
			}
			if !valid {
				continue
			}
			total = &sum
		}
		if *total == 0 && payload.Info.Time.Completed == 0 {
			reported := false
			for _, part := range payload.Parts {
				if part.Type == "step-finish" {
					reported = true
				}
			}
			if !reported {
				continue
			}
		}
		result.Tokens = total
		result.Provider = payload.Info.Provider
		result.Model = payload.Info.Model
		if limit.Valid {
			result.Limit = &limit.Int64
		}
		return result, nil
	}
	return result, rows.Err()
}

// SaveContextLimit caches only a concrete limit returned for this runtime's model.
// Notify connected clients without changing the chat's activity ordering.
func (s *Store) SaveContextLimit(ctx context.Context, chatID, provider, model string, limit int64) error {
	if provider == "" || model == "" || limit <= 0 || limit > 1e12 {
		return ErrInvalid
	}
	return s.write(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO context_limits VALUES(?,?,?,?) ON CONFLICT(chat_id,provider,model) DO UPDATE SET token_limit=excluded.token_limit`, chatID, provider, model, limit)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO activity(chat_id,event_id,kind,payload,created_at) VALUES(?,?,?,?,?)`, chatID, id(), "context.updated", "{}", now())
		return err
	})
}
