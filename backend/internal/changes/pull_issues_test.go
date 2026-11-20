package changes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

const issueResponse = `{"data":{"node":{"closingIssuesReferences":{"nodes":[{"number":115,"title":"PR checks","url":"https://github.com/example/core/issues/115","repository":{"nameWithOwner":"example/core"}}],"pageInfo":{"hasNextPage":false,"endCursor":"end"}}}}}`

func TestPullIssuesRetainCompleteResultsOnFailures(t *testing.T) {
	previous := &PullIssues{Items: []PullIssue{{Number: 1, Title: "Saved", URL: "https://github.com/example/core/issues/1"}}, CheckedAt: "saved"}
	for _, mode := range []string{"success", "paged", "permission", "graphql-error", "partial", "invalid-link", "malformed"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			got := collectPullIssues("verified-node", previous, "now", func(path string, payload []byte, target any) int {
				calls++
				if path != "/graphql" || !strings.Contains(string(payload), `"id":"verified-node"`) {
					t.Fatal("unsafe query")
				}
				if mode == "permission" {
					return 403
				}
				if mode == "partial" && calls == 2 {
					return 503
				}
				body := issueResponse
				if mode == "graphql-error" {
					body = `{"errors":[{"message":"private upstream error"}],"data":null}`
				}
				if mode == "malformed" {
					body = `{"data":{"node":{"closingIssuesReferences":{}}}}`
				}
				if mode == "paged" && calls == 1 {
					body = strings.ReplaceAll(body, `"hasNextPage":false`, `"hasNextPage":true`)
				}
				if mode == "partial" {
					body = strings.ReplaceAll(body, `"hasNextPage":false`, `"hasNextPage":true`)
				}
				if mode == "invalid-link" {
					body = strings.ReplaceAll(body, "https://github.com/example/core/issues/115", "https://evil.test/115")
				}
				if err := json.Unmarshal([]byte(body), target); err != nil {
					t.Fatal(err)
				}
				return 200
			})
			if mode == "success" || mode == "paged" {
				if got.CheckedAt != "now" || got.Error != "" || len(got.Items) != 1 || got.Items[0].Number != 115 {
					t.Fatalf("issues missing: %+v", got)
				}
			} else if got.CheckedAt != "saved" || got.Error == "" || got.Items[0].Number != 1 || strings.Contains(got.Error, "private") {
				t.Fatalf("saved issues replaced: %+v", got)
			}
		})
	}
}

func TestMetadataRefreshWithOptionalIssuePermissionFailure(t *testing.T) {
	s, c, _ := fixture(t)
	ctx := context.Background()
	credentials(t, s, t.Name())
	linkMessage(t, s, c, "https://github.com/example/core/pull/7")
	sha := strings.Repeat("a", 40)
	denyIssues, failPR := false, false
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "api.github.com" || r.Header.Get("Authorization") != "Bearer "+t.Name() {
			t.Fatal("unsafe transport")
		}
		switch {
		case r.URL.Path == "/graphql":
			if r.Method != "POST" || r.Header.Get("Content-Type") != "application/json" {
				t.Fatal("invalid GraphQL request")
			}
			if denyIssues {
				return reply(403, `{}`), nil
			}
			return reply(200, issueResponse), nil
		case strings.HasSuffix(r.URL.Path, "/check-runs"):
			return reply(200, `{"total_count":0,"check_runs":[]}`), nil
		case strings.HasSuffix(r.URL.Path, "/status"):
			return reply(200, fmt.Sprintf(`{"sha":%q,"total_count":0,"statuses":[]}`, sha)), nil
		default:
			if failPR {
				return reply(503, `{}`), nil
			}
			return reply(200, fmt.Sprintf(`{"number":7,"node_id":"verified-node","state":"open","html_url":"https://github.com/example/core/pull/7","head":{"sha":%q},"created_at":"2026-11-17T12:00:00Z","user":{"login":"octocat","avatar_url":"https://avatars.githubusercontent.com/u/583231"},"requested_reviewers":[{"login":"reviewer","avatar_url":"https://evil.test/image"}],"labels":[{"name":"bug"}]}`, sha)), nil
		}
	})}
	s.verifyPulls(ctx, c, client)
	saved := s.ReadPulls(ctx, c.ID).Items[0]
	if !saved.MetadataKnown || saved.AuthorAvatar == "" || saved.CreatedAt == "" || len(saved.Reviewers) != 1 || saved.Reviewers[0].Avatar != "" || len(saved.Labels) != 1 || saved.Issues == nil || saved.Issues.Items[0].Number != 115 {
		t.Fatalf("metadata missing: %+v", saved)
	}
	denyIssues = true
	expirePulls(t, s, c)
	s.verifyPulls(ctx, c, client)
	retained := s.ReadPulls(ctx, c.ID).Items[0]
	if retained.Checks.Error != "" || retained.Issues.Error == "" || retained.Issues.CheckedAt != saved.Issues.CheckedAt || retained.Issues.Items[0].Number != 115 {
		t.Fatalf("optional denial broke checks or lost issues: %+v", retained)
	}
	failPR = true
	expirePulls(t, s, c)
	s.verifyPulls(ctx, c, client)
	retained = s.ReadPulls(ctx, c.ID).Items[0]
	if retained.AuthorAvatar != saved.AuthorAvatar || retained.CreatedAt != saved.CreatedAt || len(retained.Labels) != 1 || len(retained.Reviewers) != 1 {
		t.Fatalf("metadata lost during outage: %+v", retained)
	}
}
