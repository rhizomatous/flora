package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

// EnvironmentChange explicitly distinguishes preserving, replacing and removing
// a saved secret. Empty ordinary values are valid; empty secret replacements fail.
type EnvironmentChange struct {
	Name   string `json:"name"`
	Action string `json:"action"`
	Value  string `json:"value,omitempty"`
	Secret bool   `json:"secret"`
	// Nil preserves the description; an empty string clears it.
	Description *string `json:"description,omitempty"`
}
type EnvironmentVariable struct {
	Name        string `json:"name"`
	Value       string `json:"value,omitempty"`
	Secret      bool   `json:"secret"`
	Description string `json:"description,omitempty"`
}
type EnvironmentError struct{ Message string }

func (e *EnvironmentError) Error() string     { return e.Message }
func environmentInvalid(message string) error { return &EnvironmentError{message} }

var environmentName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)

// Runtime-owned names and process startup hooks cannot be overridden by tasks.
func reservedEnvironment(name string) bool {
	n := strings.ToUpper(name)
	for _, prefix := range []string{"FLORA_", "OPENCODE_", "SETUP_", "GIT_", "GH_", "LD_", "DYLD_", "BASH_FUNC_"} {
		if strings.HasPrefix(n, prefix) {
			return true
		}
	}
	switch n {
	case "PATH", "HOME", "USER", "LOGNAME", "SHELL", "PWD", "OLDPWD", "ENV", "BASH_ENV", "SHELLOPTS", "BASHOPTS", "IFS", "NODE_OPTIONS", "NODE_PATH", "PYTHONPATH", "PYTHONHOME", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME":
		return true
	}
	return false
}
func ValidateEnvironment(changes []EnvironmentChange) error {
	if len(changes) > 100 {
		return environmentInvalid("Configure at most 100 environment variables.")
	}
	seen := map[string]bool{}
	total := 0
	for _, c := range changes {
		if !environmentName.MatchString(c.Name) || reservedEnvironment(c.Name) {
			return environmentInvalid("Use a variable name of at most 128 letters, numbers or underscores, starting with a letter or underscore, without reserved runtime names.")
		}
		if seen[c.Name] {
			return environmentInvalid("Configure each environment variable only once.")
		}
		seen[c.Name] = true
		if c.Description != nil && (!utf8.ValidString(*c.Description) || strings.ContainsRune(*c.Description, 0) || len(*c.Description) > 512) {
			return environmentInvalid("Descriptions must be UTF-8, at most 512 bytes, without NUL characters.")
		}
		if !utf8.ValidString(c.Value) || strings.ContainsRune(c.Value, 0) || len(c.Value) > 8192 {
			return environmentInvalid("Variable values must be UTF-8, at most 8192 bytes, without NUL characters.")
		}
		total += len(c.Name) + len(c.Value) + 2
		switch c.Action {
		case "set":
			if c.Secret {
				return environmentInvalid("Choose Replace to save a secret.")
			}
		case "replace":
			if !c.Secret || c.Value == "" {
				return environmentInvalid("Enter a nonempty replacement secret.")
			}
		case "keep", "remove":
			if c.Value != "" {
				return environmentInvalid("Keep and Remove must not include a value.")
			}
		default:
			return environmentInvalid("Choose Set, Keep, Replace or Remove for each variable.")
		}
	}
	if total > 32768 {
		return environmentInvalid("Environment variables must total at most 32768 bytes.")
	}
	return nil
}
func environmentIdentity(scope, owner, name string) string {
	b, _ := json.Marshal([]string{"environment_variables", scope, owner, name})
	return string(b)
}
func readEnvironment(ctx context.Context, tx *sql.Tx, box *secretBox, scope, owner string) (map[string]EnvironmentVariable, error) {
	rows, err := tx.QueryContext(ctx, "SELECT name,value,secret,description FROM environment_variables WHERE scope=? AND owner_id=?", scope, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]EnvironmentVariable{}
	for rows.Next() {
		var v EnvironmentVariable
		if err := rows.Scan(&v.Name, &v.Value, &v.Secret, &v.Description); err != nil {
			return nil, err
		}
		if v.Secret {
			var err error
			v.Value, err = box.open(v.Value, environmentIdentity(scope, owner, v.Name))
			if err != nil {
				return nil, err
			}
		}
		result[v.Name] = v
	}
	return result, rows.Err()
}
func applyEnvironment(values map[string]EnvironmentVariable, changes []EnvironmentChange) error {
	for _, c := range changes {
		switch c.Action {
		case "keep":
			if v, ok := values[c.Name]; !ok || !v.Secret {
				return environmentInvalid("The secret to keep no longer exists. Reload and try again.")
			}
		case "remove":
			delete(values, c.Name)
		default:
			values[c.Name] = EnvironmentVariable{Name: c.Name, Value: c.Value, Secret: c.Secret, Description: values[c.Name].Description}
		}
		if c.Action != "remove" && c.Description != nil {
			v := values[c.Name]
			v.Description = *c.Description
			values[c.Name] = v
		}
	}
	checks := []EnvironmentChange{}
	for _, v := range values {
		action := "set"
		if v.Secret {
			action = "replace"
		}
		checks = append(checks, EnvironmentChange{v.Name, action, v.Value, v.Secret, &v.Description})
	}
	return ValidateEnvironment(checks)
}
func writeEnvironment(ctx context.Context, tx *sql.Tx, box *secretBox, scope, owner string, values map[string]EnvironmentVariable) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM environment_variables WHERE scope=? AND owner_id=?", scope, owner); err != nil {
		return err
	}
	for _, v := range values {
		value := v.Value
		if v.Secret {
			value = box.seal(value, environmentIdentity(scope, owner, v.Name))
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO environment_variables(scope,owner_id,name,value,secret,description) VALUES(?,?,?,?,?,?)", scope, owner, v.Name, value, v.Secret, v.Description); err != nil {
			return err
		}
	}
	return nil
}

// Environment returns ordinary values and secret presence only. Decryption is
// restricted to runtime delivery and the redaction pipeline.
func (s *Store) Environment(ctx context.Context, scope, owner string) ([]EnvironmentVariable, error) {
	values := []EnvironmentVariable{}
	err := s.write(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, "SELECT name,CASE WHEN secret=1 THEN '' ELSE value END,secret,description FROM environment_variables WHERE scope=? AND owner_id=? ORDER BY name", scope, owner)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var v EnvironmentVariable
			if err := rows.Scan(&v.Name, &v.Value, &v.Secret, &v.Description); err != nil {
				return err
			}
			values = append(values, v)
		}
		return rows.Err()
	})
	return values, err
}
func (s *Store) SaveEnvironment(ctx context.Context, scope, owner string, changes []EnvironmentChange) error {
	if scope != "installation" && scope != "project" || scope == "installation" && owner != "" {
		return ErrInvalid
	}
	if err := ValidateEnvironment(changes); err != nil {
		return err
	}
	s.secretMu.Lock()
	defer s.secretMu.Unlock()
	return s.write(ctx, func(tx *sql.Tx) error {
		if scope == "project" {
			var id string
			if err := tx.QueryRowContext(ctx, "SELECT id FROM projects WHERE id=?", owner).Scan(&id); err != nil {
				return found(err)
			}
		}
		values, err := readEnvironment(ctx, tx, s.secrets, scope, owner)
		if err != nil {
			return err
		}
		if err := applyEnvironment(values, changes); err != nil {
			return err
		}
		return writeEnvironment(ctx, tx, s.secrets, scope, owner, values)
	})
}
func (s *Store) environmentRequestJSON(changes []EnvironmentChange) string {
	sorted := append([]EnvironmentChange{}, changes...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Name < sorted[j].Name })
	raw, _ := json.Marshal(sorted)
	return string(raw)
}

// snapshotEnvironment runs inside chat creation, after reserving its identity.
// Installation defaults are overridden by project values, then chat changes.
func (s *Store) snapshotEnvironment(ctx context.Context, tx *sql.Tx, project, chat string, changes []EnvironmentChange) error {
	values, err := readEnvironment(ctx, tx, s.secrets, "installation", "")
	if err != nil {
		return err
	}
	projectValues, err := readEnvironment(ctx, tx, s.secrets, "project", project)
	if err != nil {
		return err
	}
	for n, v := range projectValues {
		values[n] = v
	}
	if err := applyEnvironment(values, changes); err != nil {
		return err
	}
	if err := writeEnvironment(ctx, tx, s.secrets, "chat", chat, values); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO chat_environment_requests VALUES(?,?)", chat, s.secrets.seal(s.environmentRequestJSON(changes), environmentIdentity("request", chat, "")))
	return err
}

// RuntimeEnvironment opens only a chat's frozen environment. Old chats have an
// empty snapshot and never inherit subsequently configured defaults.
func (s *Store) RuntimeEnvironment(ctx context.Context, chat string) ([]string, []string, error) {
	s.secretMu.Lock()
	defer s.secretMu.Unlock()
	var env, secrets []string
	err := s.write(ctx, func(tx *sql.Tx) error {
		values, err := readEnvironment(ctx, tx, s.secrets, "chat", chat)
		if err != nil {
			return err
		}
		for _, v := range values {
			env = append(env, v.Name+"="+v.Value)
			if v.Secret {
				secrets = append(secrets, v.Value)
			}
		}
		return nil
	})
	sort.Strings(env)
	return env, secrets, err
}

// rotateEnvironment rebinds every encrypted default and immutable chat snapshot
// to the replacement key in the same transaction as installation credentials.
func rotateEnvironment(ctx context.Context, tx *sql.Tx, old, next *secretBox) error {
	rows, err := tx.QueryContext(ctx, "SELECT scope,owner_id,name,value FROM environment_variables WHERE secret=1")
	if err != nil {
		return err
	}
	type record struct{ scope, owner, name, value string }
	var records []record
	for rows.Next() {
		var r record
		if err := rows.Scan(&r.scope, &r.owner, &r.name, &r.value); err != nil {
			rows.Close()
			return err
		}
		records = append(records, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, r := range records {
		identity := environmentIdentity(r.scope, r.owner, r.name)
		value, err := old.open(r.value, identity)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE environment_variables SET value=? WHERE scope=? AND owner_id=? AND name=?", next.seal(value, identity), r.scope, r.owner, r.name); err != nil {
			return err
		}
	}
	rows, err = tx.QueryContext(ctx, "SELECT chat_id,input FROM chat_environment_requests")
	if err != nil {
		return err
	}
	records = nil
	for rows.Next() {
		var r record
		if err := rows.Scan(&r.owner, &r.value); err != nil {
			rows.Close()
			return err
		}
		records = append(records, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, r := range records {
		identity := environmentIdentity("request", r.owner, "")
		value, err := old.open(r.value, identity)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE chat_environment_requests SET input=? WHERE chat_id=?", next.seal(value, identity), r.owner); err != nil {
			return err
		}
	}
	return nil
}

// PreviewEnvironment validates chat overrides without saving or returning secrets.
func (s *Store) PreviewEnvironment(ctx context.Context, project string, changes []EnvironmentChange) ([]EnvironmentVariable, error) {
	if err := ValidateEnvironment(changes); err != nil {
		return nil, err
	}
	s.secretMu.Lock()
	defer s.secretMu.Unlock()
	result := []EnvironmentVariable{}
	err := s.write(ctx, func(tx *sql.Tx) error {
		values, err := readEnvironment(ctx, tx, s.secrets, "installation", "")
		if err != nil {
			return err
		}
		projectValues, err := readEnvironment(ctx, tx, s.secrets, "project", project)
		if err != nil {
			return err
		}
		for n, v := range projectValues {
			values[n] = v
		}
		if err := applyEnvironment(values, changes); err != nil {
			return err
		}
		for _, v := range values {
			if v.Secret {
				v.Value = ""
			}
			result = append(result, v)
		}
		return nil
	})
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	return result, err
}
