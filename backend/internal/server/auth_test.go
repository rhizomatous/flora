package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func TestAuthenticationBoundaries(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := auth.New(store)
	config := settings.New(store)
	config.Validate = func(context.Context, storage.Credentials) error { return nil }
	handler := New(fstest.MapFS{"index.html": {Data: []byte("public shell")}}, service, config, "https://flora.test")
	call := func(method, path, body, origin, site, cookie string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if site != "" {
			r.Header.Set("Sec-Fetch-Site", site)
		}
		if cookie != "" {
			r.Header.Set("Cookie", cookie)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	expect := func(w *httptest.ResponseRecorder, status int) {
		t.Helper()
		if w.Code != status {
			t.Fatalf("status %d want %d: %s", w.Code, status, w.Body)
		}
	}
	for _, path := range []string{"/api/projects", "/api/chats/1", "/api/chats/1/logs", "/api/chats/1/diff", "/api/chats/1/download", "/api/chats/1/events", "/api/settings", "/api/missing", "/api"} {
		for _, method := range []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"} {
			expect(call(method, path, "{}", "https://flora.test", "same-origin", ""), 401)
		}
	}
	password := `{"password":"a long unique password"}`
	for _, origin := range []string{"", "null", "https://evil.test", "http://flora.test", "https://flora.test.evil.test"} {
		expect(call("POST", "/api/auth/bootstrap", password, origin, "", ""), 403)
	}
	expect(call("POST", "/api/auth/bootstrap", password, "https://flora.test", "cross-site", ""), 403)
	setup := call("POST", "/api/auth/bootstrap", password, "https://flora.test", "same-origin", "")
	expect(setup, 200)
	cookies := setup.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatal("missing cookie")
	}
	c := cookies[0]
	if c.Name != cookieName || !c.HttpOnly || !c.Secure || c.Path != "/" || c.Domain != "" || c.SameSite != http.SameSiteStrictMode || c.MaxAge != 604800 {
		t.Fatalf("unsafe cookie: %+v", c)
	}
	cookie := c.Name + "=" + c.Value
	expect(call("POST", "/api/auth/bootstrap", password, "https://flora.test", "", cookie), 409)
	expect(call("GET", "/api/settings", "", "", "", cookie), 200)
	expect(call("GET", "/api/projects", "", "", "", cookie), 200)
	input := `{"provider":"openai","model":"gpt-test","githubToken":"github_pat_PRIVATE","providerKey":"PROVIDER_PRIVATE"}`
	for _, origin := range []string{"", "https://evil.test", "null"} {
		expect(call("PUT", "/api/settings", input, origin, "", cookie), 403)
	}
	saved := call("PUT", "/api/settings", input, "https://flora.test", "same-origin", cookie)
	expect(saved, 200)
	view := call("GET", "/api/settings", "", "", "", cookie)
	expect(view, 200)
	for _, response := range []*httptest.ResponseRecorder{saved, view} {
		if strings.Contains(response.Body.String(), "PRIVATE") || strings.Contains(response.Body.String(), "providerKey") || strings.Contains(response.Body.String(), "githubToken") {
			t.Fatal("leaked credential")
		}
	}
	expect(call("PUT", "/api/settings", `{"provider":"anthropic"}`, "https://flora.test", "", cookie), 400)
	expect(call("PUT", "/api/settings", `{"providerKey":"replacement-secret"}`, "https://flora.test", "", cookie), 200)
	config.Validate = func(context.Context, storage.Credentials) error {
		return &settings.ValidationError{Message: "Provider rejected the credential. Check its expiry."}
	}
	invalid := call("PUT", "/api/settings", input, "https://flora.test", "", cookie)
	expect(invalid, 400)
	if strings.Contains(invalid.Body.String(), "PRIVATE") {
		t.Fatal("validation leaked credential")
	}
	expect(call("POST", "/api/auth/logout", "", "https://evil.test", "", cookie), 403)
	logout := call("POST", "/api/auth/logout", "", "https://flora.test", "", cookie)
	expect(logout, 200)
	if logout.Result().Cookies()[0].MaxAge != -1 {
		t.Fatal("cookie not cleared")
	}
	expect(call("GET", "/api/settings", "", "", "", cookie), 401)
	expect(call("POST", "/api/auth/login", `{"password":"wrong"}`, "https://flora.test", "", ""), 401)
	login := call("POST", "/api/auth/login", password, "https://flora.test", "", "")
	expect(login, 200)
	cookie = login.Result().Cookies()[0].Name + "=" + login.Result().Cookies()[0].Value
	service.Now = func() time.Time { return time.Now().Add(auth.Lifetime) }
	expect(call("GET", "/api/settings", "", "", "", cookie), 401)
}

func TestMalformedAndOversizeRequests(t *testing.T) {
	store, err := storage.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	handler := New(fstest.MapFS{}, auth.New(store), settings.New(store), "https://flora.test")
	for _, body := range []string{`{"password":"short"}`, `{"password":"secret","extra":true}`, `{} {}`, `{"password":"` + strings.Repeat("x", 17000) + `"}`} {
		r := httptest.NewRequest("POST", "/api/auth/bootstrap", strings.NewReader(body))
		r.Header.Set("Origin", "https://flora.test")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatalf("status=%d", w.Code)
		}
	}
}

func TestPasswordAttemptLimit(t *testing.T) {
	a := &api{}
	at := time.Now()
	for i := 0; i < 10; i++ {
		if !a.allowPassword(at) {
			t.Fatal("limited too early")
		}
	}
	if a.allowPassword(at.Add(59 * time.Second)) {
		t.Fatal("password rate limit bypassed")
	}
	if !a.allowPassword(at.Add(time.Minute)) {
		t.Fatal("password limit did not reset")
	}
}
