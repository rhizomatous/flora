package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
)

// Execution is the requested model configuration, separate from reported usage.
// An empty variant uses the runtime's default reasoning behavior.
type Execution struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Variant  string `json:"variant"`
}

var executionID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$`)

func (e Execution) Valid() bool {
	return executionID.MatchString(e.Provider) && executionID.MatchString(e.Model) && (e.Variant == "" || executionID.MatchString(e.Variant))
}
func selectionJSON(e *Execution) string { b, _ := json.Marshal(e); return string(b) }

// SetChatExecution saves the chat's current choice without changing accepted
// messages, runtime state, activity order, or unread status. A stale caller can
// retry an already-saved value but cannot overwrite a different newer choice.
func (s *Store) SetChatExecution(ctx context.Context, chatID string, selected Execution, revision int64) (Chat, error) {
	if revision < 0 || !selected.Valid() {
		return Chat{}, ErrInvalid
	}
	err := s.write(ctx, func(tx *sql.Tx) error {
		var raw string
		var currentRevision int64
		if err := tx.QueryRowContext(ctx, `SELECT execution,coalesce((SELECT max(sequence) FROM activity WHERE chat_id=chats.id AND kind IN ('model.choice','message.accepted')),0) FROM chats WHERE id=?`, chatID).Scan(&raw, &currentRevision); err != nil {
			return found(err)
		}
		var current Execution
		if err := json.Unmarshal([]byte(raw), &current); err != nil {
			return err
		}
		if current == selected {
			return nil
		}
		if currentRevision != revision {
			return ErrStale
		}
		if _, err := resolveExecution(ctx, tx, chatID, &selected); err != nil {
			return err
		}
		return saveChatExecution(ctx, tx, chatID, selected)
	})
	if err != nil {
		return Chat{}, err
	}
	return s.Chat(ctx, chatID)
}

func saveChatExecution(ctx context.Context, tx *sql.Tx, chatID string, selected Execution) error {
	raw := selectionJSON(&selected)
	result, err := tx.ExecContext(ctx, `UPDATE chats SET execution=? WHERE id=? AND execution<>?`, raw, chatID, raw)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil || changed == 0 {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO activity(chat_id,event_id,kind,payload,created_at) VALUES(?,?,?,?,?)`, chatID, id(), "model.choice", raw, now())
	return err
}

// Resolve inside the acceptance transaction so the chat preference and immutable
// turn snapshot cannot diverge. Legacy chats inherit the installed model.
func resolveExecution(ctx context.Context, tx *sql.Tx, chat string, selected *Execution) (Execution, error) {
	if selected != nil {
		if !selected.Valid() {
			return Execution{}, ErrInvalid
		}
		var provider string
		err := tx.QueryRowContext(ctx, "SELECT provider FROM installation_credentials WHERE id=1 AND provider=? UNION SELECT provider FROM model_providers WHERE provider=?", selected.Provider, selected.Provider).Scan(&provider)
		if err != nil {
			return Execution{}, err
		}
		if provider != selected.Provider {
			return Execution{}, ErrInvalid
		}
		return *selected, nil
	}
	var e Execution
	if chat != "" {
		var raw string
		if err := tx.QueryRowContext(ctx, "SELECT execution FROM chats WHERE id=?", chat).Scan(&raw); err != nil {
			return e, found(err)
		}
		if err := json.Unmarshal([]byte(raw), &e); err != nil {
			return e, err
		}
	}
	if e.Model == "" {
		err := tx.QueryRowContext(ctx, "SELECT provider,model FROM installation_credentials WHERE id=1").Scan(&e.Provider, &e.Model)
		if err != nil && err != sql.ErrNoRows {
			return e, err
		}
	}
	return e, nil
}

// MessageExecution reads an accepted user turn's immutable configuration.
// Legacy messages return an empty value and retain the installation default.
func MessageExecution(m Message) Execution {
	var payload struct {
		Execution Execution `json:"execution"`
	}
	_ = json.Unmarshal(m.Payload, &payload)
	return payload.Execution
}
