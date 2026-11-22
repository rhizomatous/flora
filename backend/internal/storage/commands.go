package storage

import "encoding/json"

// MessageInputText reads the immutable delivered text of an accepted user turn.
// Older records retain their literal meaning, even if they begin with a command.
func MessageInputText(m Message) string {
	var payload struct {
		RuntimeText *string `json:"runtimeText"`
	}
	_ = json.Unmarshal(m.Payload, &payload)
	if payload.RuntimeText != nil {
		return *payload.RuntimeText
	}
	return m.Text
}
