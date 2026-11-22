package storage

import "context"

// Shell binds a user terminal to one chat and one concrete runtime. Runtime IDs
// are never accepted from browser input or reassigned after container restart.
type Shell struct {
	ID          string `json:"id"`
	ChatID      string `json:"-"`
	ContainerID string `json:"-"`
	RuntimeID   string `json:"-"`
	Title       string `json:"title"`
	State       string `json:"state"`
}

func (s *Store) Shells(ctx context.Context, chatID string) ([]Shell, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, chat_id, container_id, runtime_id, title, state FROM shells WHERE chat_id = ? ORDER BY rowid", chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Shell{}
	for rows.Next() {
		var shell Shell
		if err := rows.Scan(&shell.ID, &shell.ChatID, &shell.ContainerID, &shell.RuntimeID, &shell.Title, &shell.State); err != nil {
			return nil, err
		}
		result = append(result, shell)
	}
	return result, rows.Err()
}
func (s *Store) SaveShell(ctx context.Context, shell Shell) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO shells(id,chat_id,container_id,runtime_id,title,state) VALUES(?,?,?,?,?,?)", shell.ID, shell.ChatID, shell.ContainerID, shell.RuntimeID, shell.Title, shell.State)
	return err
}
func (s *Store) EndShell(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE shells SET state = 'ended' WHERE id = ?", id)
	return err
}
func (s *Store) DeleteShell(ctx context.Context, chatID, id string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM shells WHERE chat_id = ? AND id = ?", chatID, id)
	return err
}

func (s *Store) UpdateShellTitle(ctx context.Context, id, title string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE shells SET title = ? WHERE id = ? AND state = 'running'", title, id)
	return err
}
