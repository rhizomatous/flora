// Package redaction removes known credential values from runtime observations
// before they enter browser-readable records. It cannot detect arbitrary secrets
// created by agent commands, so the agent must still avoid printing credentials.
package redaction

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"strings"

	"github.com/rhizomatous/flora/backend/internal/agentfiles"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"go.yaml.in/yaml/v3"
)

// Values includes host credentials and the current revocable git/gh capability.
// Read only the known private file, with a maintained YAML decoder; never expose
// its contents or errors to HTTP clients or logs.
func Values(ctx context.Context, store *storage.Store, chatID string, extra ...string) []string {
	values := append([]string{}, extra...)
	if c, err := store.Credentials(ctx); err == nil {
		values = append(values, c.GitHubToken, c.ProviderKey)
	}
	if paths, err := store.Paths(ctx, chatID); err == nil {
		root, err := os.OpenRoot(paths.RuntimeState)
		if err != nil {
			return values
		}
		defer root.Close()
		if raw, err := agentfiles.Read(root, ".config/gh/hosts.yml", 65536); err == nil {
			var hosts map[string]struct {
				Token string `yaml:"oauth_token"`
			}
			if yaml.Unmarshal(raw, &hosts) == nil {
				for _, h := range hosts {
					values = append(values, h.Token)
				}
			}
		}
	}
	return values
}

func Text(text string, secrets ...string) string {
	for _, secret := range secrets {
		if secret == "" {
			continue
		}
		text = strings.ReplaceAll(text, secret, "[redacted]")
		// Cumulative snapshots may end in an unfinished credential. Hide a
		// substantial matching prefix until the rest of the output arrives.
		for n := len(secret) - 1; n >= 8; n-- {
			if strings.HasSuffix(text, secret[:n]) {
				text = strings.TrimSuffix(text, secret[:n]) + "[redacted]"
				break
			}
		}
		for _, prefix := range []string{"opencode:", "x-access-token:", "flora:"} {
			text = strings.ReplaceAll(text, base64.StdEncoding.EncodeToString([]byte(prefix+secret)), "[redacted]")
		}
	}
	return text
}

// JSON decodes strings before redacting so escaped credentials are also removed.
func JSON(raw json.RawMessage, secrets ...string) json.RawMessage {
	var value any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if decoder.Decode(&value) != nil {
		return json.RawMessage(`{"error":"invalid runtime payload"}`)
	}
	var clean func(any) any
	clean = func(v any) any {
		switch x := v.(type) {
		case string:
			return Text(x, secrets...)
		case []any:
			for i := range x {
				x[i] = clean(x[i])
			}
		case map[string]any:
			result := make(map[string]any, len(x))
			for k, v := range x {
				result[Text(k, secrets...)] = clean(v)
			}
			return result
		}
		return v
	}
	b, _ := json.Marshal(clean(value))
	return b
}
