package storage

import (
	"context"
	"encoding/json"
)

type ReportedModel struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
}

type ModelSummary struct {
	Latest *ReportedModel `json:"latest"`
	Models int            `json:"models"`
}

// ChatModel reads completed main-session calls in creation order, with message ID
// breaking ties. A newer call with missing identity stays unknown. Child sessions
// and in-flight assistant placeholders never replace the main-session identity.
func (s *Store) ChatModel(ctx context.Context, chatID string) (ModelSummary, error) {
	var summary ModelSummary
	rows, err := s.db.QueryContext(ctx, `SELECT m.provider,m.model,m.payload FROM usage_messages m
 JOIN chats c ON c.id=m.chat_id AND c.session_id=m.session_id
 WHERE m.chat_id=? ORDER BY m.created_ms DESC,m.message_id DESC`, chatID)
	if err != nil {
		return summary, err
	}
	defer rows.Close()
	models := map[ReportedModel]bool{}
	for rows.Next() {
		var model ReportedModel
		var raw []byte
		if err := rows.Scan(&model.Provider, &model.Model, &raw); err != nil {
			return summary, err
		}
		var payload struct {
			Info struct {
				Time struct {
					Completed int64 `json:"completed"`
				} `json:"time"`
			} `json:"info"`
			Parts []struct {
				Type string `json:"type"`
			} `json:"parts"`
		}
		if json.Unmarshal(raw, &payload) != nil {
			continue
		}
		reported := payload.Info.Time.Completed > 0
		for _, part := range payload.Parts {
			reported = reported || part.Type == "step-finish"
		}
		if !reported {
			continue
		}
		if summary.Latest == nil {
			latest := model
			summary.Latest = &latest
		}
		if model.Model != "" {
			models[model] = true
		}
	}
	summary.Models = len(models)
	return summary, rows.Err()
}
