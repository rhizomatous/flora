package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
)

type Subagent struct {
	Number     int    `json:"number"`
	ID         string `json:"id"`
	ParentID   string `json:"parentID"`
	Title      string `json:"title"`
	Status     string `json:"status"`
	Collection string `json:"collection"`
	Created    int64  `json:"created"`
	UpdatedAt  string `json:"updatedAt"`
}

// SaveSubagent saves redacted history from a verified child of this chat. Child
// prompts remain separate from accepted user input and never affect turn delivery.
// Callers serialize tree reconciliation; an unavailable read must not erase history.
func (s *Store) SaveSubagent(ctx context.Context, chatID string, agent Subagent, history []json.RawMessage) error {
	if agent.ID == "" || agent.ParentID == "" || agent.ID == agent.ParentID {
		return ErrInvalid
	}
	return s.write(ctx, func(tx *sql.Tx) error {
		var valid bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM chats WHERE id=? AND session_id=?) OR EXISTS(SELECT 1 FROM subagents WHERE chat_id=? AND session_id=?)`, chatID, agent.ParentID, chatID, agent.ParentID).Scan(&valid); err != nil {
			return err
		}
		if !valid {
			return ErrInvalid
		}
		var oldParent string
		err := tx.QueryRowContext(ctx, `SELECT parent_id FROM subagents WHERE chat_id=? AND session_id=?`, chatID, agent.ID).Scan(&oldParent)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		if err == nil && oldParent != agent.ParentID {
			return ErrConflict
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO subagents VALUES(?,?,?,(SELECT coalesce(max(number),0)+1 FROM subagents WHERE chat_id=?),?,?,?,?,?) ON CONFLICT(chat_id,session_id) DO UPDATE SET title=excluded.title,status=excluded.status,collection=excluded.collection,updated_at=excluded.updated_at`, chatID, agent.ID, agent.ParentID, chatID, agent.Title, agent.Status, agent.Collection, agent.Created, now())
		if err != nil {
			return err
		}
		for _, raw := range history {
			var m struct {
				Info struct {
					ID        string
					SessionID string
					Role      string
					Time      struct{ Created int64 }
				}
			}
			if json.Unmarshal(raw, &m) != nil || m.Info.ID == "" || (m.Info.SessionID != "" && m.Info.SessionID != agent.ID) {
				return ErrInvalid
			}
			if m.Info.Role != "user" && m.Info.Role != "assistant" {
				continue
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO subagent_messages VALUES(?,?,?,?,?) ON CONFLICT(chat_id,session_id,message_id) DO UPDATE SET payload=excluded.payload`, chatID, agent.ID, m.Info.ID, m.Info.Time.Created, string(raw)); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Store) Subagents(ctx context.Context, chatID string) ([]Subagent, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT session_id,parent_id,number,title,status,collection,created_ms,updated_at FROM subagents WHERE chat_id=? ORDER BY created_ms,session_id`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	agents := []Subagent{}
	for rows.Next() {
		var a Subagent
		if err := rows.Scan(&a.ID, &a.ParentID, &a.Number, &a.Title, &a.Status, &a.Collection, &a.Created, &a.UpdatedAt); err != nil {
			return nil, err
		}
		agents = append(agents, a)
	}
	return agents, rows.Err()
}

// SubagentMessages reads only saved data belonging to this chat; it never starts a runtime.
func (s *Store) SubagentMessages(ctx context.Context, chatID, sessionID string) ([]Message, error) {
	var exists bool
	if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM subagents WHERE chat_id=? AND session_id=?)`, chatID, sessionID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}
	rows, err := s.db.QueryContext(ctx, `SELECT message_id,payload FROM subagent_messages WHERE chat_id=? AND session_id=? ORDER BY created_ms,message_id`, chatID, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := []Message{}
	for rows.Next() {
		var m Message
		var raw string
		if err := rows.Scan(&m.ID, &raw); err != nil {
			return nil, err
		}
		m.ChatID = chatID
		m.Payload = json.RawMessage(raw)
		var body struct {
			Info struct {
				Role     string
				Provider string `json:"providerID"`
				Model    string `json:"modelID"`
			}
			Parts []struct {
				Type string
				Text string
			}
		}
		if err := json.Unmarshal(m.Payload, &body); err != nil {
			return nil, err
		}
		m.Role = body.Info.Role
		m.Provider = body.Info.Provider
		m.Model = body.Info.Model
		var text []string
		for _, p := range body.Parts {
			if p.Type == "text" {
				text = append(text, p.Text)
			}
		}
		m.Text = strings.Join(text, "\n\n")
		messages = append(messages, m)
	}
	return messages, rows.Err()
}

// MarkSubagentsUnavailable keeps saved conversations readable when the runtime disappears.
func (s *Store) MarkSubagentsUnavailable(ctx context.Context, chatID, reason string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE subagents SET collection=?,status=CASE WHEN status IN ('working','waiting') THEN 'unknown' ELSE status END WHERE chat_id=?`, reason, chatID)
	return err
}

// CaptureSubagentEvent accepts only previously verified descendants. Child events
// are recorded under the parent chat but never transition its active turn.
func (s *Store) CaptureSubagentEvent(ctx context.Context, chatID, sessionID, kind string, payload json.RawMessage) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		var known bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM subagents WHERE chat_id=? AND session_id=?)`, chatID, sessionID).Scan(&known); err != nil {
			return err
		}
		if !known {
			return nil
		}
		var event struct {
			Properties struct{ Status struct{ Type string } }
		}
		if err := json.Unmarshal(payload, &event); err != nil {
			return err
		}
		status := ""
		switch kind {
		case "session.error":
			status = "failed"
		case "question.asked":
			status = "waiting"
		case "session.status":
			switch event.Properties.Status.Type {
			case "busy", "retry":
				status = "working"
			case "idle":
				status = "idle"
			}
		}
		if status != "" {
			if _, err := tx.ExecContext(ctx, `UPDATE subagents SET status=?,updated_at=? WHERE chat_id=? AND session_id=?`, status, now(), chatID, sessionID); err != nil {
				return err
			}
		}
		return addActivity(ctx, tx, chatID, id(), "subagent."+kind, payload)
	})
}
