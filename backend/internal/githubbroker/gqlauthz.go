package githubbroker

import "fmt"

// This file is the broker's deny-by-default schema policy for GraphQL
// selection trees. Root-field authorization (repository attribution,
// node ID resolution, write checks) lives in broker.go; here the entire
// nested selection tree of every forwarded document is validated against
// an explicit type/field allowlist covering the shapes stock gh uses for
// the pull-request workflow. Any field or type not listed is denied
// before the document is forwarded upstream.
//
// The policy deliberately contains no field that can traverse to a
// repository outside the authorized set: no Repository.parent, no
// Repository.forks, no owner.repositories enumeration, no
// PullRequest.headRepository. Two traversal fields that stock gh itself
// requests (Repository.parent in RepoNetwork and
// PullRequest.headRepository in some views) are PRUNED from the document
// before forwarding, so gh sees a null and proceeds as if the
// repository were not a fork; see pruneField.

// gqlTypePolicy maps a GraphQL object/interface type to the fields the
// broker allows beneath it. A field maps to the child type for
// recursion, or "" for scalar/enum leaves (which must not carry
// selection sets).
var gqlTypePolicy = map[string]map[string]string{
	"Repository": {
		"id": "", "databaseId": "", "name": "", "nameWithOwner": "",
		"isPrivate": "", "url": "", "viewerPermission": "", "isFork": "",
		"description": "", "visibility": "",
		"hasIssuesEnabled": "", "hasProjectsEnabled": "",
		"hasDiscussionsEnabled": "", "hasWikiEnabled": "",
		"isInOrganization": "", "autoMergeAllowed": "",
		"mergeCommitAllowed": "", "squashMergeAllowed": "",
		"rebaseMergeAllowed": "", "forkingAllowed": "",
		"owner":            "RepositoryOwner",
		"defaultBranchRef": "Ref",
		"ref":              "Ref",
		"pullRequest":      "PullRequest",
		"pullRequests":     "PullRequestConnection",
	},
	"RepositoryOwner": {"login": ""},
	"User":            {"id": "", "login": "", "name": ""},
	"Organization":    {"id": "", "login": "", "name": ""},
	"Actor":           {"login": ""},
	"Ref":             {"name": "", "prefix": ""},
	"Node":            {"id": ""},
	"Issue": {
		"id": "", "number": "", "title": "", "body": "", "state": "",
		"url": "", "createdAt": "", "updatedAt": "", "closed": "",
		"author": "Actor", "labels": "LabelConnection",
		"assignees": "UserConnection", "milestone": "Milestone",
	},
	"PullRequest": {
		"id": "", "number": "", "title": "", "body": "", "state": "",
		"isDraft": "", "url": "", "baseRefName": "", "headRefName": "",
		"isCrossRepository": "", "maintainerCanModify": "",
		"createdAt": "", "updatedAt": "", "closed": "", "merged": "",
		"mergedAt": "", "additions": "", "deletions": "", "changedFiles": "",
		"reviewDecision": "", "mergeable": "", "mergeStateStatus": "",
		"author": "Actor", "headRepositoryOwner": "User",
		"labels": "LabelConnection", "assignees": "UserConnection",
		"milestone": "Milestone", "reviews": "ReviewConnection",
	},
	"PullRequestConnection": {"totalCount": "", "nodes": "PullRequest", "pageInfo": "PageInfo"},
	"PageInfo":              {"hasNextPage": "", "hasPreviousPage": "", "startCursor": "", "endCursor": ""},
	"LabelConnection":       {"totalCount": "", "nodes": "Label"},
	"Label":                 {"id": "", "name": "", "color": ""},
	"UserConnection":        {"totalCount": "", "nodes": "User"},
	"Milestone":             {"id": "", "number": "", "title": "", "description": "", "state": ""},
	"ReviewConnection":      {"totalCount": "", "nodes": "Review"},
	"Review":                {"id": "", "state": "", "body": "", "submittedAt": "", "author": "Actor"},
	"CreatePullRequestPayload": {
		"clientMutationId": "",
		"pullRequest":      "PullRequest",
	},
}

// pruneField reports whether a field is dropped from the document rather
// than denied. These are traversal fields stock gh requests itself;
// removing them makes gh treat the repository as a non-fork and the pull
// request's head repository as absent, which is compatible with the
// same-repository workflow Flora supports. Everything else not in the
// policy is a hard denial.
func pruneField(typeName, fieldName string) bool {
	return (typeName == "Repository" && fieldName == "parent") ||
		(typeName == "PullRequest" && fieldName == "headRepository")
}

// gqlWalk carries authorization state across one document walk.
type gqlWalk struct {
	fragStack map[string]bool
	count     int
	pruned    bool
}

const maxGQLFields = 4000

// authorizeSelections validates a selection set against the policy for
// typeName, expanding inline and named fragments, and returns the
// selection set with any prunable fields removed. Aliases and directives
// do not affect authorization: directives are conservatively treated as
// always applying.
func (d *GQLDocument) authorizeSelections(sels []GQLSelection, typeName string, st *gqlWalk) ([]GQLSelection, error) {
	policy, ok := gqlTypePolicy[typeName]
	if !ok {
		return nil, fmt.Errorf("type %s is not supported", typeName)
	}
	out := make([]GQLSelection, 0, len(sels))
	for _, sel := range sels {
		st.count++
		if st.count > maxGQLFields {
			return nil, fmt.Errorf("document too large")
		}
		switch {
		case sel.Field != nil:
			f := sel.Field
			if f.Name == "__typename" {
				if len(f.Selections) != 0 {
					return nil, fmt.Errorf("__typename cannot have selections")
				}
				out = append(out, sel)
				continue
			}
			child, ok := policy[f.Name]
			if !ok {
				if pruneField(typeName, f.Name) {
					st.pruned = true
					continue
				}
				return nil, fmt.Errorf("field %s.%s is not allowed", typeName, f.Name)
			}
			if child == "" {
				if len(f.Selections) != 0 {
					return nil, fmt.Errorf("field %s.%s is scalar", typeName, f.Name)
				}
				out = append(out, sel)
				continue
			}
			if len(f.Selections) == 0 {
				return nil, fmt.Errorf("field %s.%s requires selections", typeName, f.Name)
			}
			sub, err := d.authorizeSelections(f.Selections, child, st)
			if err != nil {
				return nil, err
			}
			f.Selections = sub
			out = append(out, sel)
		case sel.Inline != nil:
			t := sel.Inline.TypeCondition
			if t == "" {
				t = typeName
			}
			sub, err := d.authorizeSelections(sel.Inline.Selections, t, st)
			if err != nil {
				return nil, err
			}
			sel.Inline.Selections = sub
			out = append(out, sel)
		default:
			if st.fragStack[sel.FragmentSpread] {
				return nil, fmt.Errorf("fragment cycle at %q", sel.FragmentSpread)
			}
			frag, ok := d.Fragments[sel.FragmentSpread]
			if !ok {
				return nil, fmt.Errorf("undefined fragment %q", sel.FragmentSpread)
			}
			st.fragStack[sel.FragmentSpread] = true
			sub, err := d.authorizeSelections(frag.Selections, frag.TypeCondition, st)
			if err != nil {
				return nil, err
			}
			frag.Selections = sub
			delete(st.fragStack, sel.FragmentSpread)
			out = append(out, sel)
		}
	}
	return out, nil
}
