package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

type Command struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
	MessageID string `json:"messageID"`
}

func MessageCommand(m Message) *Command {
	var payload struct {
		Command *Command `json:"command"`
	}
	_ = json.Unmarshal(m.Payload, &payload)
	return payload.Command
}

// OpenCode compares its time-ordered message IDs lexically. Keep commands after
// saved history even if the host clock moved back. An ID never authorizes resend.
func commandMessageID(ctx context.Context, tx *sql.Tx, chatID string) (string, error) {
	var previous string
	if err := tx.QueryRowContext(ctx, "SELECT coalesce(max(runtime_message_id),'') FROM messages WHERE chat_id=?", chatID).Scan(&previous); err != nil {
		return "", err
	}
	stamp := (uint64(time.Now().UnixMilli()) << 12) & ((1 << 48) - 1)
	if len(previous) >= 16 {
		if last, err := strconv.ParseUint(previous[4:16], 16, 64); err == nil && last >= stamp {
			stamp = last + 1
		}
	}
	return fmt.Sprintf("msg_%012x%s", stamp, rand.Text()[:14]), nil
}
