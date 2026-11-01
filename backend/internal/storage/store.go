// Package storage owns Flora's local durable records. It never submits runtime
// work, replays tools, or infers runtime liveness from a saved chat status.
package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	_ "modernc.org/sqlite"
)

const MaxMessageBytes = 128 * 1024

var (
	ErrNotFound = errors.New("record not found")
	ErrActive   = errors.New("chat has active work; follow-ups are not queued")
	ErrConflict = errors.New("identity already used with different data")
	ErrInvalid  = errors.New("invalid storage input")
	ErrStale    = errors.New("chat turn changed")
)

//go:embed migrations/*.sql
var migrations embed.FS

type Store struct {
	db   *sql.DB
	root string
}
type Paths struct{ Workspace, RuntimeState, Logs, Artifacts string }

// Open initializes private application-owned storage. The root must be on a
// local filesystem, owned by the application user, and not shared with agents.
func Open(ctx context.Context, root string) (*Store, error) {
	if root == "" {
		return nil, ErrInvalid
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	for _, dir := range []string{root, filepath.Join(root, "workspaces"), filepath.Join(root, "runtime-state"), filepath.Join(root, "logs"), filepath.Join(root, "artifacts")} {
		if err := privateDir(dir); err != nil {
			return nil, fmt.Errorf("initialize storage directory: %w", err)
		}
	}
	path := filepath.Join(root, "flora.db")
	if info, err := os.Lstat(path); err == nil && !info.Mode().IsRegular() {
		return nil, fmt.Errorf("storage database must be a regular file")
	} else if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	err = f.Chmod(0600)
	closeErr := f.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	u := url.URL{Scheme: "file", Path: filepath.ToSlash(path)}
	q := u.Query()
	q.Add("_pragma", "foreign_keys(1)")
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "journal_mode(WAL)")
	q.Add("_pragma", "synchronous(FULL)")
	q.Set("_txlock", "immediate")
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, root: root}
	if err := s.migrate(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("initialize storage schema: %w", err)
	}
	return s, nil
}

func privateDir(path string) error {
	if err := os.MkdirAll(path, 0700); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("owned path must be a directory, not a symlink")
	}
	return os.Chmod(path, 0700)
}

func (s *Store) migrate(ctx context.Context) error {
	return s.write(ctx, func(tx *sql.Tx) error {
		var version int
		if err := tx.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
			return err
		}
		entries, err := migrations.ReadDir("migrations")
		if err != nil {
			return err
		}
		if version > len(entries) {
			return fmt.Errorf("database schema %d is newer than supported schema %d", version, len(entries))
		}
		for i := version; i < len(entries); i++ {
			body, err := migrations.ReadFile("migrations/" + entries[i].Name())
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, string(body)); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", i+1)); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Store) Close() error { return s.db.Close() }
func (s *Store) write(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}
func id() string  { return rand.Text() }
func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func found(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

type Repository struct {
	Name       string `json:"name"`
	URL        string `json:"url"`
	BaseBranch string `json:"baseBranch"`
	Role       string `json:"role"`
}
type Configuration struct {
	Repositories []Repository     `json:"repositories"`
	SetupCommand string           `json:"setupCommand"`
	Runtime      *RuntimeDefaults `json:"runtime,omitempty"`
}
type Project struct {
	ID            string        `json:"id"`
	Name          string        `json:"name"`
	Configuration Configuration `json:"configuration"`
	CreatedAt     string        `json:"createdAt"`
}
type Status string

const (
	Working Status = "working"
	Waiting Status = "waiting"
	Failed  Status = "failed"
	Idle    Status = "idle"
	Stopped Status = "stopped"
)

type Chat struct {
	ID, ProjectID, Title                                string
	Configuration                                       Configuration
	ImageDigest, HarnessVersion, ContainerID, SessionID string
	Status                                              Status
	StatusReason, ActiveMessageID, CreatedAt, UpdatedAt string
	StartingCommits                                     map[string]string
}

func configJSON(c Configuration) ([]byte, error) {
	if len(c.Repositories) == 0 || c.Runtime != nil {
		return nil, ErrInvalid
	}
	names := map[string]bool{}
	for _, r := range c.Repositories {
		u, err := url.Parse(r.URL)
		if r.Name == "" || names[r.Name] || r.BaseBranch == "" || (r.Role != "core" && r.Role != "extra") || err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.Trim(u.Path, "/") == "" {
			return nil, ErrInvalid
		}
		names[r.Name] = true
	}
	return json.Marshal(c)
}

func (s *Store) CreateProject(ctx context.Context, name string, c Configuration) (Project, error) {
	p := Project{ID: id(), Name: name, Configuration: c, CreatedAt: now()}
	b, err := configJSON(c)
	if err != nil || name == "" {
		return Project{}, ErrInvalid
	}
	_, err = s.db.ExecContext(ctx, "INSERT INTO projects VALUES (?,?,?,?)", p.ID, p.Name, string(b), p.CreatedAt)
	return p, err
}

func (s *Store) Project(ctx context.Context, projectID string) (Project, error) {
	var p Project
	var b string
	err := s.db.QueryRowContext(ctx, "SELECT id,name,config,created_at FROM projects WHERE id=?", projectID).Scan(&p.ID, &p.Name, &b, &p.CreatedAt)
	if err != nil {
		return p, found(err)
	}
	err = json.Unmarshal([]byte(b), &p.Configuration)
	return p, err
}

func (s *Store) Projects(ctx context.Context) ([]Project, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id,name,config,created_at FROM projects")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := []Project{}
	created := map[string]time.Time{}
	for rows.Next() {
		var p Project
		var config string
		if err := rows.Scan(&p.ID, &p.Name, &config, &p.CreatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(config), &p.Configuration); err != nil {
			return nil, err
		}
		stamp, err := time.Parse(time.RFC3339Nano, p.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("parse project creation time: %w", err)
		}
		created[p.ID] = stamp
		projects = append(projects, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// RFC3339Nano omits trailing fractional zeros, so string order is not time
	// order. Compare parsed instants to retain nanosecond precision and offsets.
	sort.Slice(projects, func(i, j int) bool {
		a, b := created[projects[i].ID], created[projects[j].ID]
		if a.Equal(b) {
			return projects[i].ID < projects[j].ID
		}
		return a.After(b)
	})
	return projects, nil
}

// UpdateProject only affects snapshots taken by later CreateChat calls.
func (s *Store) UpdateProject(ctx context.Context, projectID, name string, c Configuration) error {
	b, err := configJSON(c)
	if err != nil || name == "" {
		return ErrInvalid
	}
	result, err := s.db.ExecContext(ctx, "UPDATE projects SET name=?,config=? WHERE id=?", name, string(b), projectID)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) CreateChat(ctx context.Context, projectID, title, imageDigest, harnessVersion string) (Chat, error) {
	return s.createChat(ctx, projectID, title, imageDigest, harnessVersion, "", "")
}

// CreateChatRequest reserves a creation identity with the immutable first input.
// A retry returns the same chat even if project settings have since changed.
func (s *Store) CreateChatRequest(ctx context.Context, projectID, title, imageDigest, harnessVersion, requestID, text string) (Chat, error) {
	if requestID == "" || len(requestID) > 200 || strings.TrimSpace(text) == "" || !utf8.ValidString(text) || len(text) > MaxAllowedMessageBytes {
		return Chat{}, ErrInvalid
	}
	return s.createChat(ctx, projectID, title, imageDigest, harnessVersion, requestID, text)
}

func (s *Store) createChat(ctx context.Context, projectID, title, imageDigest, harnessVersion, requestID, text string) (Chat, error) {
	imageName, digest, pinned := strings.Cut(imageDigest, "@sha256:")
	if title == "" || imageName == "" || !pinned || !hexHash(digest, 64) || harnessVersion == "" {
		return Chat{}, ErrInvalid
	}
	chatID := id()
	err := s.write(ctx, func(tx *sql.Tx) error {
		if requestID != "" {
			var savedTitle, savedText string
			err := tx.QueryRowContext(ctx, "SELECT chat_id,title,text FROM chat_requests WHERE project_id=? AND request_id=?", projectID, requestID).Scan(&chatID, &savedTitle, &savedText)
			if err == nil {
				if title != savedTitle || text != savedText {
					return ErrConflict
				}
				return nil
			}
			if !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}
		var config string
		if err := tx.QueryRowContext(ctx, "SELECT config FROM projects WHERE id=?", projectID).Scan(&config); err != nil {
			return found(err)
		}
		prefs, err := readPreferences(ctx, tx)
		if err != nil {
			return err
		}
		if len(text) > prefs.MessageBytes {
			return ErrInvalid
		}
		var snapshot Configuration
		if err := json.Unmarshal([]byte(config), &snapshot); err != nil {
			return err
		}
		snapshot.Runtime = &prefs.RuntimeDefaults
		encoded, err := json.Marshal(snapshot)
		if err != nil {
			return err
		}
		config = string(encoded)
		stamp := now()
		_, err = tx.ExecContext(ctx, `INSERT INTO chats (id,project_id,title,config,image_digest,harness_version,status,status_reason,created_at,updated_at) VALUES (?,?,?,?,?,?,'stopped','Not started',?,?)`, chatID, projectID, title, config, imageDigest, harnessVersion, stamp, stamp)
		if err != nil {
			return err
		}
		if requestID != "" {
			if _, err := tx.ExecContext(ctx, "INSERT INTO chat_requests VALUES (?,?,?,?,?)", projectID, requestID, chatID, title, text); err != nil {
				return err
			}
		}
		return addActivity(ctx, tx, chatID, id(), "status", json.RawMessage(`{"status":"stopped","reason":"Not started"}`))
	})
	if err != nil {
		return Chat{}, err
	}
	return s.Chat(ctx, chatID)
}

func (s *Store) Chat(ctx context.Context, chatID string) (Chat, error) {
	var c Chat
	var config string
	// Read the row and starting commits in one snapshot.
	err := s.write(ctx, func(tx *sql.Tx) error {
		err := tx.QueryRowContext(ctx, `SELECT id,project_id,title,config,image_digest,harness_version,coalesce(container_id,''),coalesce(session_id,''),status,status_reason,coalesce(active_message_id,''),created_at,updated_at FROM chats WHERE id=?`, chatID).Scan(&c.ID, &c.ProjectID, &c.Title, &config, &c.ImageDigest, &c.HarnessVersion, &c.ContainerID, &c.SessionID, &c.Status, &c.StatusReason, &c.ActiveMessageID, &c.CreatedAt, &c.UpdatedAt)
		if err != nil {
			return found(err)
		}
		if err := json.Unmarshal([]byte(config), &c.Configuration); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, "SELECT repository,commit_sha FROM starting_commits WHERE chat_id=?", chatID)
		if err != nil {
			return err
		}
		defer rows.Close()
		c.StartingCommits = map[string]string{}
		for rows.Next() {
			var repo, sha string
			if err := rows.Scan(&repo, &sha); err != nil {
				return err
			}
			c.StartingCommits[repo] = sha
		}
		return rows.Err()
	})
	return c, err
}

// Paths creates no runtime or container. Only the caller chooses which one of
// these directories to mount. Never mount the storage root into an agent.
func (s *Store) Paths(ctx context.Context, chatID string) (Paths, error) {
	if _, err := s.Chat(ctx, chatID); err != nil {
		return Paths{}, err
	}
	// IDs are generated internally, but validate before joining any path.
	if filepath.Base(chatID) != chatID || chatID == "." || chatID == ".." || strings.ContainsAny(chatID, "/\\") {
		return Paths{}, ErrInvalid
	}
	p := Paths{filepath.Join(s.root, "workspaces", chatID), filepath.Join(s.root, "runtime-state", chatID), filepath.Join(s.root, "logs", chatID), filepath.Join(s.root, "artifacts", chatID)}
	for _, dir := range []string{p.Workspace, p.RuntimeState, p.Logs, p.Artifacts} {
		if err := privateDir(dir); err != nil {
			return Paths{}, err
		}
	}
	return p, nil
}

// BindRuntime records the container and OpenCode session once. The session may
// be empty until OpenCode starts, so provisioning can save the container first.
// An identical retry succeeds; replacing either identity needs an explicit policy.
func (s *Store) BindRuntime(ctx context.Context, chatID, containerID, sessionID string) error {
	if containerID == "" {
		return ErrInvalid
	}
	return s.write(ctx, func(tx *sql.Tx) error {
		var container, session string
		if err := tx.QueryRowContext(ctx, "SELECT coalesce(container_id,''),coalesce(session_id,'') FROM chats WHERE id=?", chatID).Scan(&container, &session); err != nil {
			return found(err)
		}
		if (container != "" && container != containerID) || (session != "" && sessionID != "" && session != sessionID) {
			return ErrConflict
		}
		if sessionID == "" {
			sessionID = session
		}
		_, err := tx.ExecContext(ctx, "UPDATE chats SET container_id=?,session_id=? WHERE id=?", containerID, sessionID, chatID)
		return err
	})
}

// RecordStartingCommit is called after resolving checkout, not from a branch
// name. Extra repositories may be resolved later. A starting commit cannot move.
func (s *Store) RecordStartingCommit(ctx context.Context, chatID, repository, sha string) error {
	if !hexHash(sha, 40) && !hexHash(sha, 64) {
		return ErrInvalid
	}
	return s.write(ctx, func(tx *sql.Tx) error {
		var config string
		if err := tx.QueryRowContext(ctx, "SELECT config FROM chats WHERE id=?", chatID).Scan(&config); err != nil {
			return found(err)
		}
		var c Configuration
		if err := json.Unmarshal([]byte(config), &c); err != nil {
			return err
		}
		exists := false
		for _, r := range c.Repositories {
			if r.Name == repository {
				exists = true
			}
		}
		if !exists {
			return ErrInvalid
		}
		var existing string
		err := tx.QueryRowContext(ctx, "SELECT commit_sha FROM starting_commits WHERE chat_id=? AND repository=?", chatID, repository).Scan(&existing)
		if err == nil {
			if existing != sha {
				return ErrConflict
			}
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO starting_commits VALUES (?,?,?)", chatID, repository, sha)
		return err
	})
}

func hexHash(value string, length int) bool {
	if len(value) != length {
		return false
	}
	for _, c := range value {
		if !strings.ContainsRune("0123456789abcdef", c) {
			return false
		}
	}
	return true
}
