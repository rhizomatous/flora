package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"
)

type Message struct {
	ID, ChatID, RequestID, RuntimeMessageID string
	Role, Text, Provider, Model, CreatedAt  string
	Payload                                 json.RawMessage
}
type Acceptance struct {
	Message   Message
	Duplicate bool
}
type Activity struct {
	Sequence                         int64
	ChatID, EventID, Kind, CreatedAt string
	Payload                          json.RawMessage
}

// AcceptMessage atomically saves a user message, marks it active, sets the chat to
// Working, and records message and status activity. Retrying the same request ID
// and text returns the saved message with Duplicate=true, even after completion;
// different text returns ErrConflict. New requests return ErrActive while the
// chat has active work. Callers must submit only new acceptances to the runtime
// and reconcile uncertain delivery without automatically resending the message.
func (s *Store) AcceptMessage(ctx context.Context, chatID, requestID, text string) (Acceptance, error) {
	if requestID == "" || len(requestID) > 200 || strings.TrimSpace(text) == "" || !utf8.ValidString(text) || len(text) > MaxMessageBytes {
		return Acceptance{}, ErrInvalid
	}
	var a Acceptance
	err := s.write(ctx, func(tx *sql.Tx) error {
		m, err := scanMessage(tx.QueryRowContext(ctx, messageSelect+" WHERE chat_id=? AND request_id=?", chatID, requestID))
		if err == nil {
			if m.Text != text {
				return ErrConflict
			}
			a = Acceptance{Message: m, Duplicate: true}
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		var status Status
		var active string
		if err := tx.QueryRowContext(ctx, "SELECT status,coalesce(active_message_id,'') FROM chats WHERE id=?", chatID).Scan(&status, &active); err != nil {
			return found(err)
		}
		if active != "" || status == Working || status == Waiting {
			return ErrActive
		}
		m = Message{ID: id(), ChatID: chatID, RequestID: requestID, Role: "user", Text: text, CreatedAt: now(), Payload: json.RawMessage(`{}`)}
		if err := insertMessage(ctx, tx, m); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE chats SET status='working',status_reason='Message accepted',active_message_id=?,updated_at=? WHERE id=?", m.ID, m.CreatedAt, chatID); err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]string{"message_id": m.ID, "request_id": requestID})
		if err := addActivity(ctx, tx, chatID, id(), "message.accepted", payload); err != nil {
			return err
		}
		payload, _ = json.Marshal(map[string]string{"status": "working", "reason": "Message accepted", "message_id": m.ID})
		if err := addActivity(ctx, tx, chatID, id(), "status", payload); err != nil {
			return err
		}
		a.Message = m
		return nil
	})
	if err != nil {
		return Acceptance{}, err
	}
	return a, nil
}

const messageSelect = `SELECT id,chat_id,coalesce(request_id,''),coalesce(runtime_message_id,''),role,text,provider,model,payload,created_at FROM messages`

type scanner interface{ Scan(...any) error }

func scanMessage(row scanner) (Message, error) {
	var m Message
	var payload string
	err := row.Scan(&m.ID, &m.ChatID, &m.RequestID, &m.RuntimeMessageID, &m.Role, &m.Text, &m.Provider, &m.Model, &payload, &m.CreatedAt)
	m.Payload = json.RawMessage(payload)
	return m, err
}
func insertMessage(ctx context.Context, tx *sql.Tx, m Message) error {
	_, err := tx.ExecContext(ctx, "INSERT INTO messages (id,chat_id,request_id,runtime_message_id,role,text,provider,model,payload,created_at) VALUES (?,?,nullif(?,''),nullif(?,''),?,?,?,?,?,?)", m.ID, m.ChatID, m.RequestID, m.RuntimeMessageID, m.Role, m.Text, m.Provider, m.Model, string(m.Payload), m.CreatedAt)
	return err
}

func (s *Store) Messages(ctx context.Context, chatID string) ([]Message, error) {
	rows, err := s.db.QueryContext(ctx, messageSelect+" WHERE chat_id=? ORDER BY sequence", chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Message{}
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, rows.Err()
}

// SaveRuntimeMessage inserts or updates an assistant or system message received
// from OpenCode and atomically records the corresponding activity.
// It does not start work or change the chat's status or active turn.
// Runtime messages can grow as parts arrive. eventID identifies this
// observed update, while RuntimeMessageID identifies the message across updates.
// Callers capture updates serially per chat; an old event retry cannot overwrite
// newer text. Payload preserves full parts, tool output, and model metadata.
func (s *Store) SaveRuntimeMessage(ctx context.Context, eventID string, m Message) error {
	if eventID == "" || m.RuntimeMessageID == "" || (m.Role != "assistant" && m.Role != "system") || !json.Valid(m.Payload) || !utf8.ValidString(m.Text) {
		return ErrInvalid
	}
	// Local record identities and timestamps are assigned here, not by runtime
	// observations. Normalize them before comparing stable event retries.
	m.ID, m.RequestID, m.CreatedAt = "", "", ""
	return s.write(ctx, func(tx *sql.Tx) error {
		payload, _ := json.Marshal(m)
		duplicate, err := activityExists(ctx, tx, m.ChatID, eventID, "message.runtime", payload)
		if err != nil || duplicate {
			return err
		}
		existing, err := scanMessage(tx.QueryRowContext(ctx, messageSelect+" WHERE chat_id=? AND runtime_message_id=?", m.ChatID, m.RuntimeMessageID))
		if err == nil {
			if existing.Role != m.Role {
				return ErrConflict
			}
			_, err = tx.ExecContext(ctx, "UPDATE messages SET text=?,provider=?,model=?,payload=? WHERE id=?", m.Text, m.Provider, m.Model, string(m.Payload), existing.ID)
		} else if errors.Is(err, sql.ErrNoRows) {
			m.ID = id()
			m.CreatedAt = now()
			m.RequestID = ""
			err = insertMessage(ctx, tx, m)
		}
		if err != nil {
			return err
		}
		return addActivity(ctx, tx, m.ChatID, eventID, "message.runtime", payload)
	})
}

// Transition atomically updates the chat's status and reason and records status
// activity. It returns ErrStale if expectedMessageID no longer matches the active
// message. Working and Waiting keep that message active; Idle, Failed, and Stopped
// clear it. Callers must confirm completion, failure, or stop before clearing it.
func (s *Store) Transition(ctx context.Context, chatID, expectedMessageID string, status Status, reason string) error {
	switch status {
	case Working, Waiting, Failed, Idle, Stopped:
	default:
		return ErrInvalid
	}
	if reason == "" {
		return ErrInvalid
	}
	return s.write(ctx, func(tx *sql.Tx) error {
		var active string
		if err := tx.QueryRowContext(ctx, "SELECT coalesce(active_message_id,'') FROM chats WHERE id=?", chatID).Scan(&active); err != nil {
			return found(err)
		}
		if active != expectedMessageID {
			return ErrStale
		}
		next := active
		if status != Working && status != Waiting {
			next = ""
		}
		if _, err := tx.ExecContext(ctx, "UPDATE chats SET status=?,status_reason=?,active_message_id=nullif(?,''),updated_at=? WHERE id=?", status, reason, next, now(), chatID); err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]string{"status": string(status), "reason": reason, "message_id": active})
		return addActivity(ctx, tx, chatID, id(), "status", payload)
	})
}

func activityExists(ctx context.Context, tx *sql.Tx, chatID, eventID, kind string, payload json.RawMessage) (bool, error) {
	var savedKind, savedPayload string
	err := tx.QueryRowContext(ctx, "SELECT kind,payload FROM activity WHERE chat_id=? AND event_id=?", chatID, eventID).Scan(&savedKind, &savedPayload)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if savedKind != kind || savedPayload != string(payload) {
		return false, ErrConflict
	}
	return true, nil
}

func addActivity(ctx context.Context, tx *sql.Tx, chatID, eventID, kind string, payload json.RawMessage) error {
	stamp := now()
	if _, err := tx.ExecContext(ctx, "INSERT INTO activity (chat_id,event_id,kind,payload,created_at) VALUES (?,?,?,?,?)", chatID, eventID, kind, string(payload), stamp); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, "UPDATE chats SET updated_at=? WHERE id=?", stamp, chatID)
	return err
}

// AppendActivity records opaque JSON including full command output, questions,
// diagnostics, or explicit capture gaps. A saved question is historical evidence,
// not proof a process-local runtime question still exists.
func (s *Store) AppendActivity(ctx context.Context, chatID, eventID, kind string, payload json.RawMessage) error {
	if eventID == "" || kind == "" || !json.Valid(payload) {
		return ErrInvalid
	}
	return s.write(ctx, func(tx *sql.Tx) error {
		duplicate, err := activityExists(ctx, tx, chatID, eventID, kind, payload)
		if err != nil || duplicate {
			return err
		}
		return addActivity(ctx, tx, chatID, eventID, kind, payload)
	})
}

// Activities returns up to limit saved events for chatID with sequence numbers
// greater than after, in ascending sequence order. Sequence numbers are global
// and stable, so gaps within a chat are normal. The limit must be 1 through 1000.
func (s *Store) Activities(ctx context.Context, chatID string, after int64, limit int) ([]Activity, error) {
	if after < 0 || limit < 1 || limit > 1000 {
		return nil, ErrInvalid
	}
	rows, err := s.db.QueryContext(ctx, "SELECT sequence,chat_id,event_id,kind,payload,created_at FROM activity WHERE chat_id=? AND sequence>? ORDER BY sequence LIMIT ?", chatID, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Activity{}
	for rows.Next() {
		var a Activity
		var payload string
		if err := rows.Scan(&a.Sequence, &a.ChatID, &a.EventID, &a.Kind, &payload, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.Payload = json.RawMessage(payload)
		result = append(result, a)
	}
	return result, rows.Err()
}
