package storage

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"unicode/utf8"
)

var ErrFolderName = errors.New("a folder with that name already exists")

type ChatFolder struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Revision int64  `json:"revision"`
}

// Folders span projects. Names are unique after trimming and Unicode lowercasing,
// and appear alphabetically by that same key, with IDs as a stable tie breaker.
func (s *Store) Folders(ctx context.Context) ([]ChatFolder, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id,name,revision FROM chat_folders ORDER BY name_key,id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []ChatFolder{}
	for rows.Next() {
		var f ChatFolder
		if err := rows.Scan(&f.ID, &f.Name, &f.Revision); err != nil {
			return nil, err
		}
		result = append(result, f)
	}
	return result, rows.Err()
}

// SaveFolder rejects stale renames instead of overwriting another editor's name.
// An empty ID creates a folder; creation and membership changes are independent.
func (s *Store) SaveFolder(ctx context.Context, f ChatFolder) (ChatFolder, error) {
	f.Name = strings.TrimSpace(f.Name)
	if !utf8.ValidString(f.Name) || f.Name == "" || len(f.Name) > 200 || strings.ContainsAny(f.Name, "\r\n\t") || f.Revision < 0 {
		return ChatFolder{}, ErrInvalid
	}
	err := s.write(ctx, func(tx *sql.Tx) error {
		if f.ID != "" {
			var rev int64
			if err := tx.QueryRowContext(ctx, "SELECT revision FROM chat_folders WHERE id=?", f.ID).Scan(&rev); err != nil {
				return found(err)
			}
			if rev != f.Revision {
				return ErrStale
			}
		}
		key := strings.ToLower(f.Name)
		var duplicate string
		err := tx.QueryRowContext(ctx, "SELECT id FROM chat_folders WHERE name_key=? AND id<>?", key, f.ID).Scan(&duplicate)
		if err == nil {
			return ErrFolderName
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if f.ID == "" {
			f.ID = id()
			f.Revision = 0
			_, err = tx.ExecContext(ctx, "INSERT INTO chat_folders(id,name,name_key) VALUES(?,?,?)", f.ID, f.Name, key)
		} else {
			f.Revision++
			_, err = tx.ExecContext(ctx, "UPDATE chat_folders SET name=?,name_key=?,revision=? WHERE id=?", f.Name, key, f.Revision, f.ID)
		}
		return err
	})
	return f, err
}

// RemoveFolder clears membership and advances chat revisions in one transaction.
// Messages, execution, pins, read positions, and archive state are preserved.
func (s *Store) RemoveFolder(ctx context.Context, folderID string, revision int64) ([]Chat, error) {
	ids := []string{}
	err := s.write(ctx, func(tx *sql.Tx) error {
		var saved int64
		if err := tx.QueryRowContext(ctx, "SELECT revision FROM chat_folders WHERE id=?", folderID).Scan(&saved); err != nil {
			return found(err)
		}
		if saved != revision {
			return ErrStale
		}
		rows, err := tx.QueryContext(ctx, "SELECT id FROM chats WHERE folder_id=?", folderID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var chatID string
			if err := rows.Scan(&chatID); err != nil {
				rows.Close()
				return err
			}
			ids = append(ids, chatID)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, "UPDATE chats SET folder_id=NULL,organization_revision=organization_revision+1 WHERE folder_id=?", folderID); err != nil {
			return err
		}
		for _, chatID := range ids {
			if err = addActivity(ctx, tx, chatID, id(), "organization", []byte(`{}`)); err != nil {
				return err
			}
		}
		_, err = tx.ExecContext(ctx, "DELETE FROM chat_folders WHERE id=?", folderID)
		return err
	})
	if err != nil {
		return nil, err
	}
	result := []Chat{}
	for _, chatID := range ids {
		c, err := s.Chat(ctx, chatID)
		if err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, nil
}
