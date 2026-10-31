package server

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rhizomatous/flora/backend/internal/chat"
)

func TestChatControlFailureResponse(t *testing.T) {
	reason := "Container stop could not be confirmed. Check Docker and retry Stop container. New messages and question replies remain blocked."
	for _, tt := range []struct {
		name    string
		err     error
		status  int
		message string
	}{
		{"unconfirmed control", &chat.ControlError{Reason: reason}, http.StatusConflict, reason},
		{"unexpected failure", errors.New("secret-diagnostic"), http.StatusServiceUnavailable, "Chat runtime or storage unavailable."},
	} {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			chatError(w, tt.err)
			if w.Code != tt.status || !strings.Contains(w.Body.String(), tt.message) || strings.Contains(w.Body.String(), "secret-diagnostic") {
				t.Fatalf("unsafe or inaccurate control response: %d %s", w.Code, w.Body.String())
			}
		})
	}
}
