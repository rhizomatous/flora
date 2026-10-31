package githubbroker

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMaterializationRequiresChatCapability(t *testing.T) {
	_, chat, b := fixture(t)
	calls := 0
	b.materialize = func(_ context.Context, id, name string) (string, error) {
		calls++
		if id != chat.ID || name != "octo/demo" {
			t.Fatal("incorrect chat or repository")
		}
		return "/workspace", nil
	}
	request := func(method, path, credential, body string, want int) {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+credential)
		w := httptest.NewRecorder()
		b.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body)
		}
	}
	path := "/api/v3/flora/repositories"
	request("POST", path, "invalid", `{"repository":"octo/demo"}`, 401)
	request("GET", path, fixtureCapability, "", 405)
	request("POST", path, fixtureCapability, `{}`, 400)
	request("POST", path, fixtureCapability, strings.Repeat("x", 1025), 400)
	if calls != 0 {
		t.Fatal("invalid request reached helper")
	}
	request("POST", path, fixtureCapability, `{"repository":"octo/demo"}`, 200)
	if calls != 1 {
		t.Fatal("helper not invoked")
	}
	if err := b.Revoke(context.Background(), chat.ID); err != nil {
		t.Fatal(err)
	}
	request("POST", path, fixtureCapability, `{"repository":"octo/demo"}`, 401)
	if calls != 1 {
		t.Fatal("revoked request reached helper")
	}
}
