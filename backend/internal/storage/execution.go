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

// Resolve inside the acceptance transaction so the chat preference and immutable
// turn snapshot cannot diverge. Legacy chats inherit the installed model.
func resolveExecution(ctx context.Context, tx *sql.Tx, chat string, selected *Execution) (Execution, error) {
	if selected != nil {
		if !selected.Valid() {
			return Execution{}, ErrInvalid
		}
		var provider string
		err := tx.QueryRowContext(ctx, "SELECT provider FROM installation_credentials WHERE id=1").Scan(&provider)
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
