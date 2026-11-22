// Package commands defines the prompt operations accepted by Flora's composer.
package commands

import (
	"fmt"
	"regexp"
	"strings"
)

type Definition struct {
	Name  string `json:"name"`
	Label string `json:"label"`
}

type Invocation struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
	Version   int    `json:"version"`
}

type Error struct{ Reason string }

func (e *Error) Error() string { return e.Reason }

// These operations mirror the built-in init and review operations in OpenCode
// 1.2.27. Flora expands its own fixed prompts through /session/{id}/message so
// system instructions, text attachments and context references remain attached.
// This does not invoke runtime-defined commands, skills, or shell substitutions.
var Registry = []Definition{
	{Name: "review", Label: "Review changes"},
	{Name: "init", Label: "Update repository instructions"},
}

func Supported(harness string) bool {
	return harness == "1.2.27" || harness == "opencode/1.2.27"
}

var token = regexp.MustCompile(`^/([A-Za-z][A-Za-z0-9-]*)(?:\s|$)`)

// Resolve recognizes commands only at the start of input. Paths, URLs and inline
// slashes remain text. A doubled leading slash escapes one slash, including an
// otherwise valid command name. The returned prompt must be saved at acceptance.
func Resolve(text, harness string) (*Invocation, string, error) {
	if strings.HasPrefix(text, "//") {
		return nil, text[1:], nil
	}
	match := token.FindStringSubmatch(text)
	if match == nil {
		return nil, text, nil
	}
	name := match[1]
	arguments := strings.TrimSpace(text[len(name)+1:])
	var prompt string
	switch name {
	case "review":
		prompt = "Review code changes and report actionable bugs with file and line references. Do not edit files, commit, push, or open a pull request. Read the changed files and relevant surrounding code, verify suspected bugs, and prioritize findings by severity. If no target is supplied, review uncommitted staged and unstaged changes. Otherwise inspect the supplied commit, branch, or pull request.\n\nReview target: " + arguments
	case "init":
		prompt = "Inspect the repository and create or improve its AGENTS.md with concise, accurate instructions for coding agents. Read existing repository instructions first. Include verified build, lint, and test commands, code conventions, and important repository structure. Preserve useful existing instructions and unrelated work.\n\nAdditional instructions: " + arguments
	default:
		return nil, "", &Error{Reason: fmt.Sprintf("Unknown command /%s. Use /review or /init. Start with // to send a literal slash.", name)}
	}
	if !Supported(harness) {
		return nil, "", &Error{Reason: fmt.Sprintf("Command /%s is unavailable for this chat's runtime.", name)}
	}
	return &Invocation{Name: name, Arguments: arguments, Version: 1}, prompt, nil
}
