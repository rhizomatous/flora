package storage

import (
	"context"
	"database/sql"
	"strings"
)

// reserveProjectChatPrefix assigns a unique prefix inside the caller's write
// transaction. Existing assignments survive renames. Equal names first use more
// letters, then alphabetic suffixes, without changing any earlier assignment.
func reserveProjectChatPrefix(ctx context.Context, tx *sql.Tx, projectID, name string) error {
	var existing string
	if err := tx.QueryRowContext(ctx, "SELECT prefix FROM project_chat_ids WHERE project_id=?", projectID).Scan(&existing); err == nil {
		return nil
	} else if err != sql.ErrNoRows {
		return err
	}
	var letters strings.Builder
	for _, c := range name {
		if c >= 'a' && c <= 'z' {
			c -= 'a' - 'A'
		}
		if c >= 'A' && c <= 'Z' {
			letters.WriteRune(c)
		}
	}
	normalized := letters.String()
	if normalized == "" {
		normalized = "CHAT"
	}
	base := normalized[:min(4, len(normalized))]
	extra := min(8, len(normalized)) - len(base)
	for attempt := 0; ; attempt++ {
		candidate := base
		if attempt <= extra {
			candidate = normalized[:len(base)+attempt]
		} else {
			candidate = base + prefixSuffix(attempt-extra)
		}
		result, err := tx.ExecContext(ctx, "INSERT INTO project_chat_ids(project_id,prefix) VALUES(?,?) ON CONFLICT(prefix) DO NOTHING", projectID, candidate)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if count == 1 {
			return nil
		}
	}
}

func prefixSuffix(number int) string {
	suffix := ""
	for number > 0 {
		number--
		suffix = string(rune('A'+number%26)) + suffix
		number /= 26
	}
	return suffix
}

// backfillChatIdentities adds public references without changing existing chat
// rows or their related records. All assignments share the migration transaction.
func backfillChatIdentities(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, "SELECT id,name FROM projects ORDER BY julianday(created_at),id")
	if err != nil {
		return err
	}
	type project struct{ id, name string }
	var projects []project
	for rows.Next() {
		var p project
		if err := rows.Scan(&p.id, &p.name); err != nil {
			rows.Close()
			return err
		}
		projects = append(projects, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, p := range projects {
		if err := reserveProjectChatPrefix(ctx, tx, p.id, p.name); err != nil {
			return err
		}
	}
	rows, err = tx.QueryContext(ctx, "SELECT id,project_id FROM chats WHERE id NOT IN (SELECT chat_id FROM chat_public_ids) ORDER BY julianday(created_at),id")
	if err != nil {
		return err
	}
	type chat struct{ id, project string }
	var chats []chat
	for rows.Next() {
		var c chat
		if err := rows.Scan(&c.id, &c.project); err != nil {
			rows.Close()
			return err
		}
		chats = append(chats, c)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, c := range chats {
		if _, err := tx.ExecContext(ctx, "UPDATE project_chat_ids SET last_number=last_number+1 WHERE project_id=?", c.project); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO chat_public_ids(prefix,number,chat_id) SELECT prefix,last_number,? FROM project_chat_ids WHERE project_id=?", c.id, c.project); err != nil {
			return err
		}
	}
	return nil
}
