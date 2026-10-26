package githubbroker

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestNodeResolutionReResolves proves there is no stale node-ID cache:
// when the upstream mapping for an ID changes (repository renamed or
// transferred), the very next request uses the new mapping.
func TestNodeResolutionReResolves(t *testing.T) {
	adminToken := "admin-fine-grained-token-TESTONLY"
	currentRepo := "octo/other" // starts foreign
	apiUp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+adminToken {
			http.Error(w, "upstream auth required", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"data":{"node":{"__typename":"Repository","nameWithOwner":%q}}}`, currentRepo)
	}))
	defer apiUp.Close()
	gitUp := httptest.NewServer(http.NotFoundHandler())
	defer gitUp.Close()

	store := newStore(t)
	broker, err := New(Config{
		Token:       adminToken,
		GitUpstream: mustParse(t, gitUp.URL),
		APIUpstream: mustParse(t, apiUp.URL),
		Store:       store,
	})
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(broker)
	defer front.Close()

	cap := mintCap(t, store, "chat-1", []string{"octo/demo"}, true)
	auth := "token " + cap.ID
	body := `{"query":"query($id:ID!){ node(id:$id){ __typename } }","variables":{"id":"some-node"}}`

	check := func(want int) {
		t.Helper()
		resp := doReq(t, http.MethodPost, front.URL+"/api/graphql", auth, strings.NewReader(body))
		defer resp.Body.Close()
		out, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != want {
			t.Fatalf("repo=%s: got %d, want %d; body: %s", currentRepo, resp.StatusCode, want, out)
		}
	}

	check(http.StatusForbidden) // foreign mapping denied
	currentRepo = "octo/demo"   // repository transferred/renamed into scope
	check(http.StatusOK)        // next request re-resolves; no stale denial
	currentRepo = "octo/other"  // and back out of scope
	check(http.StatusForbidden)
}
