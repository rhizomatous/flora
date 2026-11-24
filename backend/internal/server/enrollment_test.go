package server

import (
	"context"
	"encoding/json"
	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func TestInstallerSetupHTTP(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := auth.New(store)
	secret := auth.NewSetupToken()
	if err := store.SaveSetupLink(ctx, auth.TokenHash(secret), time.Now().Add(time.Hour), false); err != nil {
		t.Fatal(err)
	}
	handler := New(fstest.MapFS{}, service, settings.New(store), "https://flora.test")
	call := func(path, body, origin string, cookie *http.Cookie) *httptest.ResponseRecorder {
		t.Helper()
		method := "POST"
		if path == "/api/auth/status" || path == "/api/settings" {
			method = "GET"
		}
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Origin", origin)
		r.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	body := `{"secret":"` + secret + `"}`
	for _, origin := range []string{"", "https://evil.test"} {
		if w := call("/api/auth/setup", body, origin, nil); w.Code != 403 {
			t.Fatal(w.Code)
		}
	}
	if w := call("/api/auth/bootstrap", `{"password":"long unique password"}`, "https://flora.test", nil); w.Code != 403 {
		t.Fatal(w.Code)
	}
	w := call("/api/auth/setup", body, "https://flora.test", nil)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	cookie := w.Result().Cookies()[0]
	if cookie.Name != setupCookieName || !cookie.Secure || !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/" || cookie.MaxAge > 3600 || cookie.MaxAge < 3595 || cookie.Domain != "" {
		t.Fatal("unsafe setup cookie", cookie)
	}
	if strings.Contains(w.Body.String(), secret) {
		t.Fatal("secret leaked")
	}
	if w := call("/api/settings", "", "", cookie); w.Code != 401 {
		t.Fatal("setup grants admin access", w.Code)
	}
	status := call("/api/auth/status", "", "", cookie)
	var state map[string]bool
	if err := json.Unmarshal(status.Body.Bytes(), &state); err != nil {
		t.Fatal(err)
	}
	if !state["setupAuthorized"] || state["authenticated"] {
		t.Fatal(state)
	}
	if w := call("/api/auth/setup", body, "https://flora.test", nil); w.Code != 200 {
		t.Fatal("link resume", w.Code)
	}
	w = call("/api/auth/bootstrap", `{"password":"long unique password"}`, "https://flora.test", cookie)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 2 || cookies[0].Name != setupCookieName || cookies[0].MaxAge != -1 || cookies[1].Name != cookieName {
		t.Fatal(cookies)
	}
	if w := call("/api/auth/bootstrap", `{"password":"long unique password"}`, "https://flora.test", cookie); w.Code != 409 {
		t.Fatal(w.Code)
	}
	if w := call("/api/auth/setup", body, "https://flora.test", nil); w.Code != 403 {
		t.Fatal(w.Code)
	}
}
