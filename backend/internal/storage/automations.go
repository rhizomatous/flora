package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode/utf8"
)

type AutomationConfig struct {
	Execution    *Execution `json:"execution,omitempty"`
	Description  string     `json:"description"`
	Name         string     `json:"name"`
	Instructions string     `json:"instructions"`
	Mode         string     `json:"mode"`
	Frequency    string     `json:"frequency"`
	Days         []int      `json:"days"`
	Time         string     `json:"time"`
	TimeZone     string     `json:"timeZone"`
}
type Automation struct {
	AutomationConfig
	ID           string `json:"id"`
	ProjectID    string `json:"projectID"`
	Enabled      bool   `json:"enabled"`
	NextRun      string `json:"nextRun"`
	ChatID       string `json:"chatID"`
	PublicChatID string `json:"publicChatID,omitempty"`
	Revision     int    `json:"revision"`
}
type AutomationRun struct {
	ID           string `json:"id"`
	AutomationID string `json:"automationID"`
	ScheduledAt  string `json:"scheduledAt"`
	Status       string `json:"status"`
	Reason       string `json:"reason"`
	ChatID       string `json:"chatID"`
	PublicChatID string `json:"publicChatID,omitempty"`
	MessageID    string `json:"messageID"`
	Released     bool   `json:"-"`
}

func (c AutomationConfig) Validate() error {
	if c.Execution != nil && !c.Execution.Valid() {
		return ErrInvalid
	}
	if len(c.Description) > 2000 || !utf8.ValidString(c.Description) {
		return ErrInvalid
	}
	if strings.TrimSpace(c.Name) == "" || len(c.Name) > 200 || !utf8.ValidString(c.Name) || strings.TrimSpace(c.Instructions) == "" || !utf8.ValidString(c.Instructions) || len(c.Instructions) > MaxAllowedMessageBytes {
		return ErrInvalid
	}
	if c.Mode != "new" && c.Mode != "same" {
		return ErrInvalid
	}
	if c.Frequency != "daily" && c.Frequency != "weekdays" && c.Frequency != "weekly" {
		return ErrInvalid
	}
	if c.Frequency == "weekly" && len(c.Days) == 0 || len(c.Days) > 7 {
		return ErrInvalid
	}
	seen := map[int]bool{}
	for _, d := range c.Days {
		if d < 0 || d > 6 || seen[d] {
			return ErrInvalid
		}
		seen[d] = true
	}
	if _, err := time.Parse("15:04", c.Time); err != nil {
		return ErrInvalid
	}
	if c.TimeZone == "" || c.TimeZone == "Local" {
		return ErrInvalid
	}
	if _, err := time.LoadLocation(c.TimeZone); err != nil {
		return ErrInvalid
	}
	return nil
}

// Next returns the first occurrence strictly after after. A repeated local hour
// runs once; a nonexistent local time is skipped on the spring-forward day.
func (c AutomationConfig) Next(after time.Time) (time.Time, error) {
	if err := c.Validate(); err != nil {
		return time.Time{}, err
	}
	loc, _ := time.LoadLocation(c.TimeZone)
	clock, _ := time.Parse("15:04", c.Time)
	local := after.In(loc)
	for day := 0; day < 15; day++ {
		date := time.Date(local.Year(), local.Month(), local.Day()+day, 12, 0, 0, 0, loc)
		allowed := c.Frequency == "daily" || c.Frequency == "weekdays" && date.Weekday() != time.Saturday && date.Weekday() != time.Sunday
		if c.Frequency == "weekly" {
			for _, d := range c.Days {
				if int(date.Weekday()) == d {
					allowed = true
				}
			}
		}
		if !allowed {
			continue
		}
		candidate := time.Date(date.Year(), date.Month(), date.Day(), clock.Hour(), clock.Minute(), 0, 0, loc)
		if candidate.Hour() != clock.Hour() || candidate.Minute() != clock.Minute() || candidate.Day() != date.Day() {
			continue
		}
		if candidate.After(after) {
			return candidate.UTC(), nil
		}
	}
	return time.Time{}, ErrInvalid
}

const automationSelect = `SELECT id,project_id,config,enabled,next_run,chat_id,revision,coalesce((SELECT 'FLORA-' || number FROM chat_public_ids WHERE chat_id=automations.chat_id),'') FROM automations`

func scanAutomation(row scanner) (Automation, error) {
	var a Automation
	var config string
	err := row.Scan(&a.ID, &a.ProjectID, &config, &a.Enabled, &a.NextRun, &a.ChatID, &a.Revision, &a.PublicChatID)
	if err != nil {
		return a, found(err)
	}
	err = json.Unmarshal([]byte(config), &a.AutomationConfig)
	return a, err
}
func (s *Store) Automation(ctx context.Context, id string) (Automation, error) {
	return scanAutomation(s.db.QueryRowContext(ctx, automationSelect+" WHERE id=?", id))
}
func (s *Store) Automations(ctx context.Context) ([]Automation, error) {
	rows, err := s.db.QueryContext(ctx, automationSelect+" ORDER BY rowid DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Automation{}
	for rows.Next() {
		a, err := scanAutomation(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, a)
	}
	return result, rows.Err()
}

// SaveAutomation uses a revision to prevent an old browser form from overwriting
// newer edits. Changing run mode starts a new dedicated chat on the next run.
func (s *Store) SaveAutomation(ctx context.Context, a Automation, at time.Time) (Automation, error) {
	next, err := a.AutomationConfig.Next(at)
	if err != nil {
		return a, err
	}
	err = s.write(ctx, func(tx *sql.Tx) error {
		prefs, err := readPreferences(ctx, tx)
		if err != nil {
			return err
		}
		if len(a.Instructions) > prefs.MessageBytes {
			return ErrInvalid
		}
		var project string
		if err := tx.QueryRowContext(ctx, "SELECT id FROM projects WHERE id=?", a.ProjectID).Scan(&project); err != nil {
			return found(err)
		}
		config, _ := json.Marshal(a.AutomationConfig)
		if a.ID == "" {
			a.ID = id()
			a.Revision = 1
			a.ChatID = ""
			a.NextRun = next.Format(time.RFC3339)
			_, err = tx.ExecContext(ctx, "INSERT INTO automations(id,project_id,config,enabled,next_run) VALUES(?,?,?,?,?)", a.ID, a.ProjectID, string(config), a.Enabled, a.NextRun)
			return err
		}
		old, err := scanAutomation(tx.QueryRowContext(ctx, automationSelect+" WHERE id=?", a.ID))
		if err != nil {
			return err
		}
		if old.Revision != a.Revision {
			return ErrStale
		}
		if old.ProjectID != a.ProjectID {
			return ErrInvalid
		}
		a.ChatID = old.ChatID
		if old.Mode != a.Mode {
			a.ChatID = ""
		}
		a.NextRun = old.NextRun
		if old.Frequency != a.Frequency || old.Time != a.Time || old.TimeZone != a.TimeZone || !equalDays(old.Days, a.Days) || old.Enabled != a.Enabled {
			a.NextRun = next.Format(time.RFC3339)
		}
		a.Revision++
		_, err = tx.ExecContext(ctx, "UPDATE automations SET config=?,enabled=?,next_run=?,chat_id=?,revision=? WHERE id=?", string(config), a.Enabled, a.NextRun, a.ChatID, a.Revision, a.ID)
		return err
	})
	if err != nil {
		return a, err
	}
	return s.Automation(ctx, a.ID)
}
func equalDays(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

const runSelect = `SELECT id,automation_id,scheduled_at,status,reason,chat_id,message_id,released,coalesce((SELECT 'FLORA-' || number FROM chat_public_ids WHERE chat_id=automation_runs.chat_id),'') FROM automation_runs`

func scanRun(row scanner) (AutomationRun, error) {
	var r AutomationRun
	err := row.Scan(&r.ID, &r.AutomationID, &r.ScheduledAt, &r.Status, &r.Reason, &r.ChatID, &r.MessageID, &r.Released, &r.PublicChatID)
	return r, found(err)
}
func (s *Store) AutomationRuns(ctx context.Context, automationID string) ([]AutomationRun, error) {
	query := runSelect + " WHERE automation_id=? ORDER BY julianday(scheduled_at) DESC,rowid DESC LIMIT 100"
	rows, err := s.db.QueryContext(ctx, query, automationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []AutomationRun{}
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// ClaimAutomation advances the schedule and reserves the occurrence in the same
// transaction. The caller must never replay a reserved run after a process crash.
// Manual requests use a client identity so a network retry cannot create two runs.
func (s *Store) ClaimAutomation(ctx context.Context, automationID, requestID string, at time.Time, scheduled bool) (Automation, AutomationRun, bool, error) {
	var a Automation
	var r AutomationRun
	claimed := false
	err := s.write(ctx, func(tx *sql.Tx) error {
		var err error
		a, err = scanAutomation(tx.QueryRowContext(ctx, automationSelect+" WHERE id=?", automationID))
		if err != nil {
			return err
		}
		if !scheduled {
			if requestID == "" || len(requestID) > 100 {
				return ErrInvalid
			}
			old, err := scanRun(tx.QueryRowContext(ctx, runSelect+" WHERE id=?", "manual:"+requestID))
			if err == nil {
				if old.AutomationID != a.ID {
					return ErrConflict
				}
				r = old
				return nil
			}
			if err != ErrNotFound {
				return err
			}
		}
		due, err := time.Parse(time.RFC3339, a.NextRun)
		if err != nil {
			return err
		}
		if scheduled && (!a.Enabled || due.After(at)) {
			return nil
		}
		r = AutomationRun{ID: "automation:" + id(), AutomationID: a.ID, ScheduledAt: at.UTC().Format(time.RFC3339Nano), Status: "starting"}
		if !scheduled {
			r.ID = "manual:" + requestID
		} else {
			r.ScheduledAt = a.NextRun
			if at.Sub(due) > time.Minute {
				r.Status = "skipped"
				r.Reason = "Schedule missed while Flora was unavailable. Resuming at the next occurrence."
			}
			next, err := a.AutomationConfig.Next(at)
			if err != nil {
				return err
			}
			a.NextRun = next.Format(time.RFC3339)
			if _, err = tx.ExecContext(ctx, "UPDATE automations SET next_run=? WHERE id=?", a.NextRun, a.ID); err != nil {
				return err
			}
		}
		var active int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM automation_runs WHERE automation_id=? AND status IN ('starting','working','waiting')", a.ID).Scan(&active); err != nil {
			return err
		}
		if active > 0 {
			r.Status = "skipped"
			r.Reason = "The previous run is still working or waiting for an answer."
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO automation_runs(id,automation_id,scheduled_at,status,reason,mode,revision) VALUES(?,?,?,?,?,?,?)", r.ID, r.AutomationID, r.ScheduledAt, r.Status, r.Reason, a.Mode, a.Revision)
		claimed = r.Status == "starting"
		return err
	})
	return a, r, claimed, err
}

func (s *Store) SetAutomationRun(ctx context.Context, runID, status, reason, chatID string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE automation_runs SET status=?,reason=?,chat_id=CASE WHEN ?='' THEN chat_id ELSE ? END WHERE id=? AND status='starting'", status, reason, chatID, chatID, runID)
	return err
}
func (s *Store) BindAutomationChat(ctx context.Context, a Automation, chatID string) error {
	if a.Mode != "same" {
		return nil
	}
	_, err := s.db.ExecContext(ctx, "UPDATE automations SET chat_id=? WHERE id=? AND chat_id='' AND json_extract(config,'$.mode')='same' AND revision=?", chatID, a.ID, a.Revision)
	return err
}

// RecoverAutomationRuns links any chat reserved before a crash without sending
// another message. Accepted runs already have bindings saved by AcceptMessage.
func (s *Store) RecoverAutomationRuns(ctx context.Context) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE automation_runs SET chat_id=coalesce((SELECT chat_id FROM chat_requests WHERE request_id=automation_runs.id),chat_id) WHERE status='starting'`); err != nil {
			return err
		}
		// Only an unfinished creation for the current configuration may bind a chat.
		// Historical runs must not undo a user's change of run destination.
		if _, err := tx.ExecContext(ctx, `UPDATE automations SET chat_id=coalesce((SELECT chat_id FROM automation_runs WHERE automation_id=automations.id AND revision=automations.revision AND mode='same' AND status='starting' AND chat_id<>'' ORDER BY rowid DESC LIMIT 1),'') WHERE chat_id='' AND json_extract(config,'$.mode')='same'`); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE automation_runs SET status='failed',reason='Flora restarted before this run could be confirmed. Check the saved chat before running again.' WHERE status='starting'`)
		return err
	})
}

func (s *Store) UnreleasedAutomationRuns(ctx context.Context) ([]AutomationRun, error) {
	rows, err := s.db.QueryContext(ctx, runSelect+" WHERE status='completed' AND released=0")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []AutomationRun{}
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}
func (s *Store) ReleaseAutomationRun(ctx context.Context, runID string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE automation_runs SET released=1 WHERE id=?", runID)
	return err
}

func (s *Store) ChatAutomationRuns(ctx context.Context, chatID string) ([]AutomationRun, error) {
	rows, err := s.db.QueryContext(ctx, runSelect+" WHERE chat_id=? ORDER BY scheduled_at", chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []AutomationRun{}
	for rows.Next() {
		r, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}
