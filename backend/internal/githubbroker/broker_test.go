package githubbroker

import (
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// TestGitCloneFetchPushThroughBroker proves ordinary git works through the
// broker: a container-style remote URL (capability as username, no
// administrator token anywhere container-side) clones, fetches, and pushes
// against a smart-HTTP upstream that requires the administrator token.
func TestGitCloneFetchPushThroughBroker(t *testing.T) {
	rig := newRig(t)
	cap := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)

	work := filepath.Join(t.TempDir(), "clone")
	gitRun(t, "", "clone", rig.cloneURL(cap, "octo/demo"), work)
	if _, err := os.Stat(filepath.Join(work, "README.md")); err != nil {
		t.Fatalf("clone missing README.md: %v", err)
	}
	if !rig.gitBack.SawToken {
		t.Fatal("upstream never saw the administrator token; broker did not inject it")
	}

	// The remote URL persisted in the container's .git/config must carry
	// only the capability, never the administrator token.
	cfg := gitRun(t, work, "config", "--get", "remote.origin.url")
	if strings.Contains(cfg, rig.adminToken) {
		t.Fatal("administrator token leaked into persisted git config")
	}

	// Commit and push through the broker.
	if err := os.WriteFile(filepath.Join(work, "change.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitRun(t, work, "add", "change.txt")
	gitRun(t, work, "-c", "user.email=probe@example.com", "-c", "user.name=Probe",
		"commit", "-m", "container change")
	gitRun(t, work, "push", "origin", "HEAD:main")

	// A second clone sees the pushed commit, and fetch works.
	work2 := filepath.Join(t.TempDir(), "clone2")
	gitRun(t, "", "clone", rig.cloneURL(cap, "octo/demo"), work2)
	if _, err := os.Stat(filepath.Join(work2, "change.txt")); err != nil {
		t.Fatalf("pushed change not visible in second clone: %v", err)
	}
	gitRun(t, work2, "fetch", "origin")
}

// TestReadOnlyCapabilityCannotPush checks operation scoping for git.
func TestReadOnlyCapabilityCannotPush(t *testing.T) {
	rig := newRig(t)
	cap := mintCap(t, rig.Store, "chat-ro", []string{"octo/demo"}, false)

	work := filepath.Join(t.TempDir(), "clone")
	gitRun(t, "", "clone", rig.cloneURL(cap, "octo/demo"), work) // fetch allowed
	if err := os.WriteFile(filepath.Join(work, "nope.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitRun(t, work, "add", "nope.txt")
	gitRun(t, work, "-c", "user.email=probe@example.com", "-c", "user.name=Probe",
		"commit", "-m", "should not push")
	out, err := gitMayFail(work, nil, "push", "origin", "HEAD:main")
	if err == nil {
		t.Fatalf("read-only capability pushed successfully; output:\n%s", out)
	}
}

// TestGitDenials covers authentication and per-chat/per-repository scoping
// failures at the git transport.
func TestGitDenials(t *testing.T) {
	rig := newRig(t)
	good := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)
	otherRepo := mintCap(t, rig.Store, "chat-2", []string{"octo/other"}, true)
	revoked := mintCap(t, rig.Store, "chat-3", []string{"octo/demo"}, true)
	if err := rig.Store.Revoke(revoked.ID); err != nil {
		t.Fatal(err)
	}
	expired, err := rig.Store.Mint("chat-4", []string{"octo/demo"}, true, -time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(t.TempDir(), "x")

	cases := []struct {
		name string
		url  string
	}{
		{"no capability", rig.front.URL + "/octo/demo.git"},
		{"unknown capability", strings.Replace(rig.cloneURL(good, "octo/demo"), good.ID, "flora_cap_deadbeef", 1)},
		{"revoked capability", rig.cloneURL(revoked, "octo/demo")},
		{"expired capability", rig.cloneURL(expired, "octo/demo")},
		// Cross-chat: chat-2's capability was minted for octo/other and
		// must not reach chat-1's repository.
		{"cross-chat repository", rig.cloneURL(otherRepo, "octo/demo")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, err := gitMayFail("", nil, "clone", tc.url, dst)
			if err == nil {
				t.Fatalf("clone unexpectedly succeeded; output:\n%s", out)
			}
			if strings.Contains(out, rig.adminToken) {
				t.Fatalf("administrator token leaked into git output:\n%s", out)
			}
		})
	}
}

// TestHTTPDenialShapes verifies denial status codes directly.
func TestHTTPDenialShapes(t *testing.T) {
	rig := newRig(t)
	good := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)
	readOnly := mintCap(t, rig.Store, "chat-ro", []string{"octo/demo"}, false)

	check := func(name, method, path, auth string, want int) {
		t.Helper()
		resp := doReq(t, method, rig.front.URL+path, auth, nil)
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != want {
			t.Errorf("%s: got %d, want %d; body: %s", name, resp.StatusCode, want, body)
		}
		if strings.Contains(string(body), rig.adminToken) {
			t.Errorf("%s: response leaked the administrator token", name)
		}
	}

	basic := "Basic " + base64Of(good.ID+":")
	basicRO := "Basic " + base64Of(readOnly.ID+":")
	check("missing auth", "GET", "/octo/demo.git/info/refs?service=git-upload-pack", "", http.StatusUnauthorized)
	check("authorized fetch refs", "GET", "/octo/demo.git/info/refs?service=git-upload-pack", basic, http.StatusOK)
	check("read-only receive-pack refs", "GET", "/octo/demo.git/info/refs?service=git-receive-pack", basicRO, http.StatusForbidden)
	check("unknown path", "GET", "/etc/passwd", basic, http.StatusNotFound)
	// The administrator token itself is never a valid container credential.
	check("admin token as bearer", "GET", "/octo/demo.git/info/refs?service=git-upload-pack",
		"Bearer "+rig.adminToken, http.StatusUnauthorized)
}

// TestRESTAPIScoping exercises the gh-style API surface: authorized
// repository calls pass, cross-repository and account-level calls are
// denied, and read-only capabilities cannot mutate.
func TestRESTAPIScoping(t *testing.T) {
	rig := newRig(t)
	writeCap := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)
	readCap := mintCap(t, rig.Store, "chat-ro", []string{"octo/demo"}, false)

	check := func(name, method, path, auth string, want int) {
		t.Helper()
		resp := doReq(t, method, rig.front.URL+path, auth, strings.NewReader(`{"title":"x"}`))
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != want {
			t.Errorf("%s: got %d, want %d; body: %s", name, resp.StatusCode, want, body)
		}
		if strings.Contains(string(body), rig.adminToken) {
			t.Errorf("%s: response leaked the administrator token", name)
		}
	}

	auth := "token " + writeCap.ID
	authRO := "token " + readCap.ID
	check("view pulls", "GET", "/api/v3/repos/octo/demo/pulls", auth, http.StatusOK)
	check("create draft PR", "POST", "/api/v3/repos/octo/demo/pulls", auth, http.StatusOK)
	check("cross-repository", "GET", "/api/v3/repos/octo/other/pulls", auth, http.StatusForbidden)
	check("account-level endpoint", "GET", "/api/v3/user", auth, http.StatusForbidden)
	check("read-only mutation", "POST", "/api/v3/repos/octo/demo/pulls", authRO, http.StatusForbidden)
	check("read-only read", "GET", "/api/v3/repos/octo/demo/pulls", authRO, http.StatusOK)
}

// TestGraphQLStructuralAuthorization exercises the deny-by-default
// GraphQL authorization: supported gh shapes pass, and adversarial
// documents (decoy fields, node ID smuggling, aliases, fragments,
// multiple operations) are denied instead of forwarding the
// administrator credential.
func TestGraphQLStructuralAuthorization(t *testing.T) {
	rig := newRig(t)
	writeCap := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)
	readCap := mintCap(t, rig.Store, "chat-ro", []string{"octo/demo"}, false)

	check := func(name, body, auth string, want int) {
		t.Helper()
		resp := doReq(t, http.MethodPost, rig.front.URL+"/api/graphql", auth, strings.NewReader(body))
		defer resp.Body.Close()
		respBody, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != want {
			t.Errorf("%s: got %d, want %d; body: %s", name, resp.StatusCode, want, respBody)
		}
		if strings.Contains(string(respBody), rig.adminToken) {
			t.Errorf("%s: response leaked the administrator token", name)
		}
	}
	auth := "token " + writeCap.ID
	authRO := "token " + readCap.ID

	// Supported shapes.
	check("repository literal",
		`{"query":"query { repository(owner:\"octo\", name:\"demo\") { id } }"}`, auth, http.StatusOK)
	check("repository variables",
		`{"query":"query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){ id } }","variables":{"owner":"octo","repo":"demo"}}`,
		auth, http.StatusOK)
	check("repository variable defaults",
		`{"query":"query($owner:String = \"octo\", $name:String = \"demo\"){ repository(owner:$owner,name:$name){ id } }"}`,
		auth, http.StatusOK)
	check("repository alias",
		`{"query":"query { decoy: repository(owner:\"octo\", name:\"demo\") { id } }"}`, auth, http.StatusOK)
	check("repository via named fragment",
		`{"query":"query { ...F } fragment F on Query { repository(owner:\"octo\", name:\"demo\") { id } }"}`, auth, http.StatusOK)
	check("repository via inline fragment",
		`{"query":"query { ... on Query { repository(owner:\"octo\", name:\"demo\") { id } } }"}`, auth, http.StatusOK)
	check("introspection __type",
		`{"query":"query Issue_fields { __type(name:\"Issue\") { fields { name } } }"}`, auth, http.StatusOK)
	check("introspection __schema",
		`{"query":"query { __schema { queryType { name } } }"}`, auth, http.StatusOK)
	check("node id of authorized repository",
		`{"query":"query($id:ID!){ node(id:$id){ __typename } }","variables":{"id":"`+FakeRepoNodeID+`"}}`,
		auth, http.StatusOK)
	check("createPullRequest on authorized repository",
		`{"query":"mutation($id:ID!){ createPullRequest(input:{repositoryId:$id, baseRefName:\"main\", headRefName:\"x\", title:\"t\", draft:true}){ pullRequest { url } } }","variables":{"id":"`+FakeRepoNodeID+`"}}`,
		auth, http.StatusOK)
	check("createPullRequest with input variable (stock gh shape)",
		`{"query":"mutation CreatePullRequest($input: CreatePullRequestInput!) { createPullRequest(input: $input) { pullRequest { url } } }","variables":{"input":{"repositoryId":"`+FakeRepoNodeID+`","baseRefName":"main","headRefName":"x","title":"t","draft":true}}}`,
		auth, http.StatusOK)
	check("createPullRequest foreign repo via input variable",
		`{"query":"mutation CreatePullRequest($input: CreatePullRequestInput!) { createPullRequest(input: $input) { pullRequest { url } } }","variables":{"input":{"repositoryId":"`+FakeForeignNodeID+`","baseRefName":"main","headRefName":"x","title":"t"}}}`,
		auth, http.StatusForbidden)
	check("read-only repository query",
		`{"query":"query { repository(owner:\"octo\", name:\"demo\") { id } }"}`, authRO, http.StatusOK)
	check("narrow viewer login for gh repo network",
		`{"query":"query { viewer { login } }"}`, auth, http.StatusOK)

	// Adversarial and unsupported shapes: all denied.
	check("viewer beyond login",
		`{"query":"query { viewer { login email } }"}`, auth, http.StatusForbidden)
	check("viewer with arguments",
		`{"query":"query { viewer { login } repository(owner:\"octo\", name:\"demo\") { databaseId } } query2:viewer { id }"}`,
		auth, http.StatusForbidden)
	check("decoy repository plus organization",
		`{"query":"query { repository(owner:\"octo\", name:\"demo\") { id } organization(login:\"evilcorp\") { repository(name:\"demo\") { id } } }"}`,
		auth, http.StatusForbidden)
	check("node id of foreign repository",
		`{"query":"query($id:ID!){ node(id:$id){ __typename } }","variables":{"id":"`+FakeForeignNodeID+`"}}`,
		auth, http.StatusForbidden)
	check("node id unknown",
		`{"query":"query($id:ID!){ node(id:$id){ __typename } }","variables":{"id":"bogus"}}`,
		auth, http.StatusForbidden)
	check("createPullRequest on foreign repository",
		`{"query":"mutation($id:ID!){ createPullRequest(input:{repositoryId:$id, baseRefName:\"main\", headRefName:\"x\", title:\"t\"}){ pullRequest { url } } }","variables":{"id":"`+FakeForeignNodeID+`"}}`,
		auth, http.StatusForbidden)
	check("createPullRequest with read-only capability",
		`{"query":"mutation($id:ID!){ createPullRequest(input:{repositoryId:$id, baseRefName:\"main\", headRefName:\"x\", title:\"t\"}){ pullRequest { url } } }","variables":{"id":"`+FakeRepoNodeID+`"}}`,
		authRO, http.StatusForbidden)
	check("repository of foreign owner via variables",
		`{"query":"query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){ id } }","variables":{"owner":"octo","repo":"other"}}`,
		auth, http.StatusForbidden)
	check("repository with unresolvable owner",
		`{"query":"query($owner:String!){ repository(owner:$owner,name:\"demo\"){ id } }"}`,
		auth, http.StatusForbidden)
	check("viewer email field",
		`{"query":"query { viewer { email } }"}`, auth, http.StatusForbidden)
	check("viewer identity fields allowed for gh",
		`{"query":"query { viewer { id login name } }"}`, auth, http.StatusOK)
	check("search field",
		`{"query":"query { search(query:\"x\", type:REPOSITORY, first:1){ nodes { __typename } } }"}`, auth, http.StatusForbidden)
	check("multiple operations",
		`{"query":"query A { repository(owner:\"octo\", name:\"demo\") { id } } query B { viewer { login } }","operationName":"A"}`,
		auth, http.StatusForbidden)
	check("fragment cycle",
		`{"query":"query { ...A } fragment A on Query { ...B } fragment B on Query { ...A }"}`,
		auth, http.StatusForbidden)
	check("undefined fragment",
		`{"query":"query { ...Nope }"}`, auth, http.StatusForbidden)
	check("other mutation",
		`{"query":"mutation { deleteIssue(input:{issueId:\"x\"}){ clientMutationId } }"}`, auth, http.StatusForbidden)
	check("repository root field inside mutation",
		`{"query":"mutation { repository(owner:\"octo\", name:\"demo\") { id } }"}`, auth, http.StatusForbidden)
	check("unparseable document",
		`{"query":"query { repository("}`, auth, http.StatusForbidden)
}

// TestGraphQLNestedTraversalDenied covers R1: cross-repo reads nested
// beneath authorized root fields must fail before any forwarding.
func TestGraphQLNestedTraversalDenied(t *testing.T) {
	rig := newRig(t)
	cap := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)
	auth := "token " + cap.ID

	check := func(name, body string, want int) {
		t.Helper()
		before := len(rig.gqlBodies)
		resp := doReq(t, http.MethodPost, rig.front.URL+"/api/graphql", auth, strings.NewReader(body))
		defer resp.Body.Close()
		respBody, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != want {
			t.Errorf("%s: got %d, want %d; body: %s", name, resp.StatusCode, want, respBody)
		}
		// The broker's own node-resolution query may hit the upstream
		// even when the container's document is denied; the container's
		// document itself must never be forwarded. The resolver body is
		// identified by its exact query text.
		for _, fwd := range rig.gqlBodies[before:] {
			if strings.Contains(fwd, nodeResolutionQuery) {
				continue
			}
			if want == http.StatusForbidden {
				t.Errorf("%s: denied document was forwarded upstream: %s", name, fwd)
			}
		}
	}

	denied := []struct{ name, query string }{
		{"GLM decoy: owner organization repository",
			`query { repository(owner:"octo",name:"demo") { owner { ... on Organization { repository(name:"other-private") { object(expression:"main:secret.txt") { ... on Blob { text } } } } } } }`},
		{"owner repositories enumeration",
			`query { repository(owner:"octo",name:"demo") { owner { repositories(first:10) { nodes { name } } } } }`},
		{"forks connection",
			`query { repository(owner:"octo",name:"demo") { forks(first:10) { nodes { name } } } }`},
		{"node repository owner traversal",
			`query($id:ID!) { node(id:$id) { ... on Repository { owner { repositories(first:5) { nodes { nameWithOwner } } } } } }`},
		{"mutation result traversal",
			`mutation($input:CreatePullRequestInput!) { createPullRequest(input:$input) { pullRequest { repository { name } } } }`},
		{"unknown nested scalar fails closed",
			`query { repository(owner:"octo",name:"demo") { createdAt } }`},
		{"unknown nested object fails closed",
			`query { repository(owner:"octo",name:"demo") { securityPolicy { body } } }`},
		{"scalar with selections",
			`query { repository(owner:"octo",name:"demo") { name { length } } }`},
		{"object without selections",
			`query { repository(owner:"octo",name:"demo") { owner } }`},
		{"fragment-wrapped owner traversal",
			`query { repository(owner:"octo",name:"demo") { ...O } } fragment O on Repository { owner { ... on Organization { repositories(first:5) { nodes { name } } } } }`},
		{"alias-wrapped owner traversal",
			`query { repository(owner:"octo",name:"demo") { x: owner { y: repositories(first:5) { nodes { name } } } } }`},
		{"directive-wrapped traversal still denied",
			`query { repository(owner:"octo",name:"demo") { owner { repositories(first:5) @include(if:true) { nodes { name } } } } }`},
		{"deeply nested unknown path",
			`query { repository(owner:"octo",name:"demo") { pullRequests(first:1) { nodes { reviews(first:1) { nodes { author { ... on User { repositories(first:5) { nodes { name } } } } } } } } } }`},
	}
	for _, tc := range denied {
		vars := ""
		if strings.Contains(tc.query, "$id") {
			vars = `,"variables":{"id":"` + FakeRepoNodeID + `"}`
		}
		if strings.Contains(tc.query, "$input") {
			vars = `,"variables":{"input":{"repositoryId":"` + FakeRepoNodeID + `"}}`
		}
		check(tc.name, `{"query":`+strconv.Quote(tc.query)+vars+`}`, http.StatusForbidden)
	}
}

// TestGraphQLTraversalPruning verifies the two traversal fields stock gh
// requests itself are pruned from the forwarded document rather than
// forwarded or hard-denied.
func TestGraphQLTraversalPruning(t *testing.T) {
	rig := newRig(t)
	cap := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)
	auth := "token " + cap.ID

	post := func(body string) string {
		t.Helper()
		resp := doReq(t, http.MethodPost, rig.front.URL+"/api/graphql", auth, strings.NewReader(body))
		defer resp.Body.Close()
		out, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("got %d, want 200; body: %s", resp.StatusCode, out)
		}
		return string(out)
	}

	// RepoNetwork shape: parent must be pruned from the forwarded query.
	rig.gqlBodies = nil
	post(`{"query":"fragment repo on Repository { id, databaseId, name, owner { login }, viewerPermission, defaultBranchRef { name }, isPrivate } query RepositoryNetwork { viewer { login }, repo_000: repository(owner:\"octo\", name:\"demo\") { ...repo, parent { ...repo } } }"}`)
	forwarded := rig.gqlBodies[len(rig.gqlBodies)-1]
	if strings.Contains(forwarded, "parent") {
		t.Fatalf("parent was forwarded upstream: %s", forwarded)
	}
	if !strings.Contains(forwarded, "repo_000") || !strings.Contains(forwarded, "fragment repo") {
		t.Fatalf("rewrite lost aliased repository or fragment: %s", forwarded)
	}

	// PullRequest view shape: headRepository must be pruned.
	rig.gqlBodies = nil
	post(`{"query":"query($owner:String!,$repo:String!,$number:Int!){ repository(owner:$owner,name:$repo){ pullRequest(number:$number){ id, number, title, state, isDraft, url, headRepository { id, name } } } }","variables":{"owner":"octo","repo":"demo","number":1}}`)
	forwarded = rig.gqlBodies[len(rig.gqlBodies)-1]
	if strings.Contains(forwarded, "headRepository") {
		t.Fatalf("headRepository was forwarded upstream: %s", forwarded)
	}
	if !strings.Contains(forwarded, "isDraft") {
		t.Fatalf("rewrite lost requested fields: %s", forwarded)
	}

	// Mutation output shape: headRepository beneath createPullRequest
	// must be pruned too.
	rig.gqlBodies = nil
	post(`{"query":"mutation($input:CreatePullRequestInput!){ createPullRequest(input:$input){ pullRequest { id, url, headRepository { name } } } }","variables":{"input":{"repositoryId":"` + FakeRepoNodeID + `"}}}`)
	forwarded = rig.gqlBodies[len(rig.gqlBodies)-1]
	if strings.Contains(forwarded, "headRepository") {
		t.Fatalf("headRepository was forwarded upstream: %s", forwarded)
	}

	// A document that needs pruning but carries directives cannot be
	// safely rewritten and is denied instead.
	resp := doReq(t, http.MethodPost, rig.front.URL+"/api/graphql", auth, strings.NewReader(
		`{"query":"query { repository(owner:\"octo\", name:\"demo\") @skip(if:false) { id, parent { id } } }"}`))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("directive-carrying prunable document: got %d, want 403", resp.StatusCode)
	}

	// Stock gh create/view shapes survive intact end to end.
	rig.gqlBodies = nil
	post(`{"query":"query PullRequest($owner:String!,$repo:String!,$number:Int!){ repository(owner:$owner,name:$repo){ pullRequest(number:$number){ id, number, title, state, isDraft, url } } }","variables":{"owner":"octo","repo":"demo","number":1}}`)
}

// TestAmbiguousPathsRejected covers path normalization attacks: dot
// segments and percent-encoded path forms must be rejected before any
// authorization or forwarding decision.
func TestAmbiguousPathsRejected(t *testing.T) {
	rig := newRig(t)
	cap := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)
	auth := "token " + cap.ID

	paths := []string{
		"/api/v3/repos/octo/demo/../other/pulls",
		"/api/v3/repos/octo/./demo/pulls",
		"/api/v3/repos/octo/demo/%2e%2e/other/pulls",
		"/api/v3/repos/octo/demo/%2E%2E/other",
		"/api/v3/repos/octo%2fother/pulls",
		"/octo/demo.git/info/refs/../../etc",
	}
	for _, p := range paths {
		t.Run(p, func(t *testing.T) {
			resp := doReq(t, http.MethodGet, rig.front.URL+p, auth, nil)
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("got %d, want 400", resp.StatusCode)
			}
		})
	}
}

// TestRESTWriteScopeBounded verifies the effective REST write scope is
// pull-request operations only, even for write capabilities.
func TestRESTWriteScopeBounded(t *testing.T) {
	rig := newRig(t)
	cap := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)
	auth := "token " + cap.ID

	check := func(name, method, path string, want int) {
		t.Helper()
		resp := doReq(t, method, rig.front.URL+path, auth, strings.NewReader(`{}`))
		defer resp.Body.Close()
		if resp.StatusCode != want {
			t.Errorf("%s: got %d, want %d", name, resp.StatusCode, want)
		}
	}
	check("create PR", "POST", "/api/v3/repos/octo/demo/pulls", http.StatusOK)
	check("update PR", "PATCH", "/api/v3/repos/octo/demo/pulls/1", http.StatusOK)
	check("delete repository denied", "DELETE", "/api/v3/repos/octo/demo", http.StatusForbidden)
	check("create issue denied", "POST", "/api/v3/repos/octo/demo/issues", http.StatusForbidden)
	check("merge PUT denied", "PUT", "/api/v3/repos/octo/demo/pulls/1/merge", http.StatusForbidden)
}

// TestRedirectProtection proves the broker never follows upstream redirects
// and never forwards the administrator token to another host.
func TestRedirectProtection(t *testing.T) {
	rig := newRig(t)
	cap := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)

	var targetHits int
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		targetHits++
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("redirect target received an Authorization header: %q", got)
		}
	}))
	defer target.Close()

	redirecting := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/stolen", http.StatusFound)
	}))
	defer redirecting.Close()

	gitURL := mustParse(t, rig.gitUp.URL)
	redirURL := mustParse(t, redirecting.URL)
	broker, err := New(Config{
		Token:       rig.adminToken,
		GitUpstream: gitURL,
		APIUpstream: redirURL,
		Store:       rig.Store,
	})
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(broker)
	defer front.Close()

	resp := doReqNoFollow(t, http.MethodGet, front.URL+"/api/v3/repos/octo/demo/pulls", "token "+cap.ID, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("broker should surface the redirect unfollowed; got %d", resp.StatusCode)
	}
	if targetHits != 0 {
		t.Fatalf("broker followed the redirect %d times", targetHits)
	}

	// Defense in depth: even if a request is aimed at a foreign host, the
	// injecting transport must withhold the administrator token.
	foreign := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("foreign host received an Authorization header: %q", got)
		}
	}))
	defer foreign.Close()
	req, err := http.NewRequest(http.MethodGet, foreign.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := broker.client.Do(req); err != nil {
		t.Fatal(err)
	}
}

// TestUpstream401DoesNotChallengeContainer ensures an upstream credential
// failure cannot turn into an interactive prompt inside the container.
func TestUpstream401DoesNotChallengeContainer(t *testing.T) {
	rig := newRig(t)
	rig.apiUp.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("WWW-Authenticate", `Basic realm="GitHub"`)
		http.Error(w, "bad credentials", http.StatusUnauthorized)
	})
	cap := mintCap(t, rig.Store, "chat-1", []string{"octo/demo"}, true)
	resp := doReq(t, http.MethodGet, rig.front.URL+"/api/v3/repos/octo/demo/pulls", "token "+cap.ID, nil)
	defer resp.Body.Close()
	if got := resp.Header.Get("WWW-Authenticate"); got != "" {
		t.Fatalf("upstream challenge forwarded to container: %q", got)
	}
}

func base64Of(s string) string {
	return base64.StdEncoding.EncodeToString([]byte(s))
}
