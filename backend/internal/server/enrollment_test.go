package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func enrollmentService(t *testing.T) (*storage.Store, *auth.Service) {
	t.Helper()
	store, err := storage.Open(context.Background(), filepath.Join(t.TempDir(), "data"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	file := filepath.Join(t.TempDir(), "enrollment.sha256")
	if err := os.WriteFile(file, []byte(auth.TokenHash("fixture-installer-enrollment-code")), 0600); err != nil {
		t.Fatal(err)
	}
	service := auth.New(store)
	if err := service.RequireEnrollment(file); err != nil {
		t.Fatal(err)
	}
	return store, service
}

func TestInstallerEnrollmentHTTP(t *testing.T) {
	store, service := enrollmentService(t)
	handler := New(fstest.MapFS{}, service, settings.New(store), "https://flora.test")
	for _, tc := range []struct {
		origin, code string
		status       int
	}{
		{"https://flora.test", "", 403},
		{"https://flora.test", "wrong", 403},
		{"https://evil.test", "fixture-installer-enrollment-code", 403},
		{"https://flora.test", "fixture-installer-enrollment-code", 200},
		{"https://flora.test", "fixture-installer-enrollment-code", 409},
	} {
		r := httptest.NewRequest(http.MethodPost, "/api/auth/bootstrap", strings.NewReader(`{"password":"long unique password","enrollmentCode":"`+tc.code+`"}`))
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("status %d, want %d", w.Code, tc.status)
		}
		if strings.Contains(w.Body.String(), "fixture-installer-enrollment-code") {
			t.Fatal("response leaked enrollment code")
		}
	}
}
