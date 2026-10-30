package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/chat"
	"github.com/rhizomatous/flora/backend/internal/projects"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

const cookieName = "__Host-flora"

type api struct {
	auth          *auth.Service
	settings      *settings.Service
	projects      *projects.Service
	chats         *chat.Service
	origin        string
	passwordSlots chan struct{}
	attemptMu     sync.Mutex
	attempts      int
	attemptWindow time.Time
}

// The installation has one account. Limit password work globally rather than
// trusting client IPs supplied by an HTTPS proxy or forwarded request headers.
func (a *api) allowPassword(at time.Time) bool {
	a.attemptMu.Lock()
	defer a.attemptMu.Unlock()
	if at.Sub(a.attemptWindow) >= time.Minute {
		a.attemptWindow = at
		a.attempts = 0
	}
	if a.attempts >= 10 {
		return false
	}
	a.attempts++
	return true
}

func jsonResponse(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func failure(w http.ResponseWriter, status int, message string) {
	jsonResponse(w, status, map[string]string{"error": message})
}
func token(r *http.Request) string {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return ""
	}
	return c.Value
}
func sessionCookie(w http.ResponseWriter, value string, expires time.Time, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: value, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode, Expires: expires, MaxAge: maxAge})
}

func (a *api) protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		mutation := r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS"
		if mutation && (r.Header.Get("Origin") != a.origin || (r.Header.Get("Sec-Fetch-Site") != "" && r.Header.Get("Sec-Fetch-Site") != "same-origin")) {
			failure(w, 403, "Use Flora from its configured HTTPS address to make changes.")
			return
		}
		public := (r.Method == "GET" || r.Method == "HEAD") && (r.URL.Path == "/api/health" || r.URL.Path == "/api/auth/status")
		public = public || (r.Method == "POST" && (r.URL.Path == "/api/auth/bootstrap" || r.URL.Path == "/api/auth/login"))
		if !public && (mutation || r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/")) {
			valid, err := a.auth.Valid(r.Context(), token(r))
			if err != nil {
				failure(w, 500, "Session storage unavailable. Check storage permissions and free space.")
				return
			}
			if !valid {
				failure(w, 401, "Log in to continue.")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	return decodeLimit(w, r, v, 16*1024)
}

func decodeLimit(w http.ResponseWriter, r *http.Request, v any, limit int64) bool {
	if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
		failure(w, 415, "Send application/json.")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		failure(w, 400, "Invalid request. Check the fields and request size.")
		return false
	}
	if err := d.Decode(new(any)); err != io.EOF {
		failure(w, 400, "Send one JSON object.")
		return false
	}
	return true
}

func (a *api) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/status", func(w http.ResponseWriter, r *http.Request) {
		_, err := a.auth.Store.AdministratorHash(r.Context())
		if err != nil && !errors.Is(err, storage.ErrNotFound) {
			failure(w, 500, "Administrator storage unavailable.")
			return
		}
		valid, e := a.auth.Valid(r.Context(), token(r))
		if e != nil {
			failure(w, 500, "Session storage unavailable.")
			return
		}
		jsonResponse(w, 200, map[string]bool{"setupRequired": errors.Is(err, storage.ErrNotFound), "authenticated": valid})
	})
	for _, action := range []string{"bootstrap", "login"} {
		mux.HandleFunc("POST /api/auth/"+action, func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Password string `json:"password"`
			}
			if !decode(w, r, &in) {
				return
			}
			if !a.allowPassword(time.Now()) {
				w.Header().Set("Retry-After", "60")
				failure(w, 429, "Too many login attempts. Wait one minute and try again.")
				return
			}
			// Bound simultaneous expensive password hashes, including unauthenticated work.
			select {
			case a.passwordSlots <- struct{}{}:
				defer func() { <-a.passwordSlots }()
			default:
				failure(w, 429, "Too many login attempts. Try again shortly.")
				return
			}
			var value string
			var expires time.Time
			var err error
			if action == "bootstrap" {
				value, expires, err = a.auth.Bootstrap(r.Context(), in.Password)
			} else {
				value, expires, err = a.auth.Login(r.Context(), in.Password)
			}
			switch {
			case errors.Is(err, storage.ErrConflict):
				failure(w, 409, "Administrator already exists. Log in instead.")
			case errors.Is(err, auth.ErrPassword):
				failure(w, 400, auth.ErrPassword.Error())
			case errors.Is(err, auth.ErrLogin):
				failure(w, 401, auth.ErrLogin.Error())
			case err != nil:
				failure(w, 500, "Could not save the session. Check storage permissions and free space.")
			default:
				sessionCookie(w, value, expires, int(auth.Lifetime.Seconds()))
				jsonResponse(w, 200, map[string]bool{"authenticated": true})
			}
		})
	}
	mux.HandleFunc("POST /api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		if err := a.auth.Logout(r.Context(), token(r)); err != nil {
			failure(w, 500, "Could not revoke the session. Try again.")
			return
		}
		sessionCookie(w, "", time.Unix(1, 0), -1)
		jsonResponse(w, 200, map[string]bool{"authenticated": false})
	})
	mux.HandleFunc("GET /api/settings", func(w http.ResponseWriter, r *http.Request) {
		view, err := a.settings.View(r.Context())
		if err != nil {
			failure(w, 500, "Settings storage unavailable.")
			return
		}
		jsonResponse(w, 200, view)
	})
	mux.HandleFunc("PUT /api/settings", func(w http.ResponseWriter, r *http.Request) {
		var in settings.Input
		if !decode(w, r, &in) {
			return
		}
		if err := a.settings.Save(r.Context(), in); err != nil {
			var validation *settings.ValidationError
			if errors.As(err, &validation) {
				failure(w, 400, validation.Message)
			} else {
				failure(w, 500, "Could not save settings. Check storage permissions and free space.")
			}
			return
		}
		view, err := a.settings.View(r.Context())
		if err != nil {
			failure(w, 500, "Settings storage unavailable.")
			return
		}
		jsonResponse(w, 200, view)
	})
}
