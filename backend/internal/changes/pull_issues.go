package changes

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

type PullIssue struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	URL    string `json:"url"`
}
type PullIssues struct {
	Items     []PullIssue `json:"items"`
	CheckedAt string      `json:"checkedAt,omitempty"`
	Error     string      `json:"error,omitempty"`
}

func githubAvatar(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host != "avatars.githubusercontent.com" || u.User != nil {
		return ""
	}
	return u.String()
}

// Keep complete closing-issue results across GraphQL errors or incomplete pages.
// Node IDs come only from the verified PR response. Requests use the same host,
// credentials, timeout, and budget as PR and check discovery.
func collectPullIssues(node string, previous *PullIssues, stamp string, call func(string, []byte, any) int) *PullIssues {
	if node == "" {
		return previous
	}
	saved := PullIssues{Items: []PullIssue{}}
	if previous != nil {
		saved = *previous
	}
	saved.Error = "Linked issues could not be refreshed. Saved issues are retained."
	items := []PullIssue{}
	cursor := ""
	seen := map[string]bool{}
	for page := 0; page < 3; page++ {
		var after any
		if cursor != "" {
			after = cursor
		}
		payload, _ := json.Marshal(map[string]any{
			"query":     `query($id:ID!,$after:String){node(id:$id){... on PullRequest{closingIssuesReferences(first:100,after:$after){nodes{number title url repository{nameWithOwner}} pageInfo{hasNextPage endCursor}}}}}`,
			"variables": map[string]any{"id": node, "after": after},
		})
		var result struct {
			Errors []json.RawMessage `json:"errors"`
			Data   struct {
				Node *struct {
					Issues *struct {
						Nodes []struct {
							Number     int    `json:"number"`
							Title      string `json:"title"`
							URL        string `json:"url"`
							Repository struct {
								Name string `json:"nameWithOwner"`
							} `json:"repository"`
						} `json:"nodes"`
						PageInfo *struct {
							More   bool   `json:"hasNextPage"`
							Cursor string `json:"endCursor"`
						} `json:"pageInfo"`
					} `json:"closingIssuesReferences"`
				} `json:"node"`
			} `json:"data"`
		}
		if call("/graphql", payload, &result) != 200 || len(result.Errors) > 0 || result.Data.Node == nil || result.Data.Node.Issues == nil || result.Data.Node.Issues.PageInfo == nil {
			return &saved
		}
		for _, issue := range result.Data.Node.Issues.Nodes {
			if !repositoryName.MatchString(issue.Repository.Name) || issue.Number < 1 {
				return &saved
			}
			canonical := fmt.Sprintf("https://github.com/%s/issues/%d", strings.ToLower(issue.Repository.Name), issue.Number)
			if !strings.EqualFold(canonical, issue.URL) {
				return &saved
			}
			if !seen[canonical] {
				items = append(items, PullIssue{Number: issue.Number, Title: issue.Title, URL: canonical})
				seen[canonical] = true
			}
		}
		if !result.Data.Node.Issues.PageInfo.More {
			return &PullIssues{Items: items, CheckedAt: stamp}
		}
		next := result.Data.Node.Issues.PageInfo.Cursor
		if next == "" || next == cursor {
			return &saved
		}
		cursor = next
	}
	return &saved
}
