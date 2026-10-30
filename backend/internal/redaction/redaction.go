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
	"sort"
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
	forms := credentialForms(secrets)
	return textForms(text, forms)
}

func textForms(text string, forms []string) string {
	return maskEdges(replaceForms(text, forms), forms, false, true)
}

// Tail redacts a bounded source window before and after selecting its last limit
// bytes. Both cut boundaries may contain credential fragments. Matching fragments
// of at least eight bytes are hidden; shorter coincidences retain ordinary text.
func Tail(text string, limit int, secrets ...string) string {
	if limit <= 0 {
		return ""
	}
	forms := credentialForms(secrets)
	text = maskEdges(replaceForms(text, forms), forms, true, true)
	if len(text) > limit {
		text = text[len(text)-limit:]
	}
	return maskEdges(text, forms, true, true)
}

func credentialForms(secrets []string) []string {
	unique := map[string]bool{}
	var forms []string
	for _, secret := range secrets {
		if secret == "" {
			continue
		}
		candidates := []string{secret}
		for _, prefix := range []string{"opencode:", "x-access-token:", "flora:"} {
			candidates = append(candidates, base64.StdEncoding.EncodeToString([]byte(prefix+secret)))
		}
		for _, value := range candidates {
			if !unique[value] {
				unique[value] = true
				forms = append(forms, value)
			}
		}
	}
	// Replace longer overlapping representations first so a shorter credential
	// cannot leave the remainder of a longer one in the output.
	sort.Slice(forms, func(i, j int) bool {
		if len(forms[i]) == len(forms[j]) {
			return forms[i] < forms[j]
		}
		return len(forms[i]) > len(forms[j])
	})
	return forms
}

func replaceForms(text string, forms []string) string {
	for _, form := range forms {
		text = strings.ReplaceAll(text, form, "[redacted]")
	}
	return text
}

func maskEdges(text string, forms []string, leading, trailing bool) string {
	left, right := 0, 0
	for _, form := range forms {
		for n := min(len(text), len(form)-1); n >= 8; n-- {
			if leading && n > left && strings.HasPrefix(text, form[len(form)-n:]) {
				left = n
			}
			if trailing && n > right && strings.HasSuffix(text, form[:n]) {
				right = n
			}
		}
	}
	if left == 0 && right == 0 {
		return text
	}
	if left+right >= len(text) {
		return fragmentMarker(len(text))
	}
	result := text[left : len(text)-right]
	if left > 0 {
		result = fragmentMarker(left) + result
	}
	if right > 0 {
		result += fragmentMarker(right)
	}
	return result
}

// Boundary masking must not expand a bounded preview beyond its byte limit.
func fragmentMarker(size int) string {
	if size < len("[redacted]") {
		return "[hidden]"
	}
	return "[redacted]"
}

// JSON decodes strings before redacting so escaped credentials are also removed.
func JSON(raw json.RawMessage, secrets ...string) json.RawMessage {
	var value any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if decoder.Decode(&value) != nil {
		return json.RawMessage(`{"error":"invalid runtime payload"}`)
	}
	forms := credentialForms(secrets)
	var clean func(any) any
	clean = func(v any) any {
		switch x := v.(type) {
		case string:
			return textForms(x, forms)
		case []any:
			for i := range x {
				x[i] = clean(x[i])
			}
		case map[string]any:
			result := make(map[string]any, len(x))
			for k, v := range x {
				result[textForms(k, forms)] = clean(v)
			}
			return result
		}
		return v
	}
	b, _ := json.Marshal(clean(value))
	return b
}
