package server

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

const ceremonyCookieName = "__Host-flora-webauthn"
const recoveryCookieName = "__Host-flora-recovery"

func namedToken(r *http.Request, name string) string {
	c, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return c.Value
}
func proofCookie(w http.ResponseWriter, name, value string, expires time.Time, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode, Expires: expires, MaxAge: maxAge})
}
func passkeyName(name string) bool {
	return strings.TrimSpace(name) != "" && utf8.ValidString(name) && utf8.RuneCountInString(name) <= 100 && !strings.ContainsAny(name, "\r\n\x00")
}

type ceremony struct {
	Session webauthn.SessionData
	Name    string
	Origin  string
}

func (a *api) passkeyBinding(w http.ResponseWriter, r *http.Request, mode string) (string, bool) {
	var proof string
	var valid bool
	var err error
	switch mode {
	case "setup":
		proof = setupToken(r)
		valid, err = a.auth.SetupValid(r.Context(), proof)
	case "recovery":
		proof = namedToken(r, recoveryCookieName)
		valid, err = a.auth.RecoveryValid(r.Context(), proof)
	case "session":
		proof = token(r)
		valid, err = a.auth.Store.RecentSession(r.Context(), auth.TokenHash(proof), a.auth.Now())
	default:
		failure(w, 400, "Choose setup, recovery, or session registration.")
		return "", false
	}
	if err != nil {
		failure(w, 500, "Account storage unavailable.")
		return "", false
	}
	if !valid {
		failure(w, 403, "Sign in again before changing passkeys, or obtain a new setup or recovery link from the host.")
		return "", false
	}
	return auth.TokenHash(proof), true
}

// Registration begin accepts {mode,name}; finish accepts {mode,credential} with
// the browser's WebAuthn JSON. Modes bind to setup, recovery, or a recent session.
// Login begin accepts {}; finish accepts {credential}. The HttpOnly ceremony
// cookie must accompany finish. Both successful login and enrollment return the
// normal authenticated response; setup and recovery also issue a browser session.
func (a *api) passkeyRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/auth/recovery", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Secret string `json:"secret"`
		}
		if !decode(w, r, &in) {
			return
		}
		valid, err := a.auth.RecoveryValid(r.Context(), in.Secret)
		if err != nil {
			failure(w, 500, "Recovery storage unavailable.")
			return
		}
		if !valid {
			failure(w, 403, "Recovery link expired or was replaced. Obtain a new recovery link from the host.")
			return
		}
		proofCookie(w, recoveryCookieName, in.Secret, a.auth.Now().Add(15*time.Minute), 900)
		jsonResponse(w, 200, map[string]bool{"recoveryAuthorized": true})
	})
	mux.HandleFunc("GET /api/auth/passkeys", func(w http.ResponseWriter, r *http.Request) {
		keys, err := a.auth.Store.Passkeys(r.Context())
		if err != nil {
			failure(w, 500, "Passkey storage unavailable.")
			return
		}
		recent, err := a.auth.Store.RecentSession(r.Context(), auth.TokenHash(token(r)), a.auth.Now())
		if err != nil {
			failure(w, 500, "Session storage unavailable.")
			return
		}
		hash, err := a.auth.Store.AdministratorHash(r.Context())
		if err != nil {
			failure(w, 500, "Account storage unavailable.")
			return
		}
		jsonResponse(w, 200, map[string]any{"passkeys": keys, "recent": recent, "passwordAvailable": hash != "", "origin": a.origin, "available": a.webauthn != nil})
	})
	for _, method := range []string{"PATCH", "DELETE"} {
		mux.HandleFunc(method+" /api/auth/passkeys/{id}", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Name string `json:"name"`
			}
			if r.Method == "PATCH" {
				if !decode(w, r, &in) {
					return
				}
				if !passkeyName(in.Name) {
					failure(w, 400, "Use a passkey name between 1 and 100 characters.")
					return
				}
			}
			if _, ok := a.passkeyBinding(w, r, "session"); !ok {
				return
			}
			err := a.auth.Store.ChangePasskey(r.Context(), r.PathValue("id"), strings.TrimSpace(in.Name), r.Method == "DELETE", auth.TokenHash(token(r)), a.origin, a.auth.Now())
			switch {
			case errors.Is(err, storage.ErrConflict):
				failure(w, 409, "Add another passkey before removing your last sign-in method.")
			case errors.Is(err, storage.ErrNotFound):
				failure(w, 409, "Passkey or recent sign-in is no longer available. Sign in again and reload.")
			case err != nil:
				failure(w, 500, "Could not update passkey. Try again.")
			default:
				jsonResponse(w, 200, map[string]bool{"saved": true})
			}
		})
	}
	for _, action := range []string{"register", "login"} {
		for _, stage := range []string{"begin", "finish"} {
			mux.HandleFunc("POST /api/auth/passkeys/"+action+"/"+stage, func(w http.ResponseWriter, r *http.Request) { a.passkeyCeremony(w, r, action, stage) })
		}
	}
}

func (a *api) passkeyCeremony(w http.ResponseWriter, r *http.Request, action, stage string) {
	if a.webauthn == nil {
		failure(w, 400, auth.ErrPasskeyConfig.Error())
		return
	}
	var in struct {
		Mode       string          `json:"mode"`
		Name       string          `json:"name"`
		Credential json.RawMessage `json:"credential"`
	}
	if !decodeLimit(w, r, &in, 64*1024) {
		return
	}
	binding := ""
	if action == "register" {
		var ok bool
		binding, ok = a.passkeyBinding(w, r, in.Mode)
		if !ok {
			return
		}
	}
	purpose := action + ":" + in.Mode
	user, keys, err := a.auth.PasskeyUser(r.Context(), a.origin)
	if err != nil {
		failure(w, 500, "Passkey storage unavailable.")
		return
	}
	if stage == "begin" {
		if !a.allowCeremony(time.Now()) {
			w.Header().Set("Retry-After", "60")
			failure(w, 429, "Too many passkey requests. Wait one minute and try again.")
			return
		}
		var options any
		var session *webauthn.SessionData
		if action == "register" {
			if !passkeyName(in.Name) {
				failure(w, 400, "Use a passkey name between 1 and 100 characters.")
				return
			}
			if len(keys) >= 20 && in.Mode != "recovery" {
				failure(w, 409, "Remove a passkey before adding another.")
				return
			}
			// Recovery can re-enroll a retained authenticator at the same address.
			if in.Mode == "recovery" {
				user.Credentials = nil
			}
			options, session, err = a.webauthn.BeginRegistration(user, webauthn.WithExclusions(webauthn.Credentials(user.Credentials).CredentialDescriptors()))
		} else {
			options, session, err = a.webauthn.BeginDiscoverableLogin(webauthn.WithUserVerification(protocol.VerificationRequired))
		}
		if err != nil {
			failure(w, 400, "Could not start passkey prompt. Try again or use password login.")
			return
		}
		session.Expires = a.auth.Now().Add(auth.CeremonyLifetime)
		proof := auth.NewSetupToken()
		if action == "login" {
			binding = auth.TokenHash(proof)
		}
		data, err := json.Marshal(ceremony{*session, strings.TrimSpace(in.Name), a.origin})
		if err == nil {
			err = a.auth.Store.SaveCeremony(r.Context(), auth.TokenHash(proof), purpose, binding, string(data), session.Expires, a.auth.Now())
		}
		if err != nil {
			failure(w, 503, "Could not start passkey prompt. Wait and try again.")
			return
		}
		proofCookie(w, ceremonyCookieName, proof, session.Expires, int(auth.CeremonyLifetime.Seconds()))
		jsonResponse(w, 200, options)
		return
	}
	proof := namedToken(r, ceremonyCookieName)
	if action == "login" {
		binding = auth.TokenHash(proof)
	}
	data, err := a.auth.Store.TakeCeremony(r.Context(), auth.TokenHash(proof), purpose, binding, a.auth.Now())
	proofCookie(w, ceremonyCookieName, "", time.Unix(1, 0), -1)
	if err != nil {
		failure(w, 400, "Passkey prompt expired or was already used. Try again.")
		return
	}
	var saved ceremony
	if json.Unmarshal([]byte(data), &saved) != nil || saved.Origin != a.origin {
		failure(w, 400, "Flora's address changed. Start a new passkey prompt or use host recovery.")
		return
	}
	response := r.Clone(r.Context())
	response.Body = io.NopCloser(bytes.NewReader(in.Credential))
	var credential *webauthn.Credential
	if action == "register" {
		credential, err = a.webauthn.FinishRegistration(user, saved.Session, response)
	} else {
		credential, err = a.webauthn.FinishDiscoverableLogin(func(rawID, handle []byte) (webauthn.User, error) {
			if !bytes.Equal(handle, user.Handle) {
				return nil, storage.ErrNotFound
			}
			return user, nil
		}, saved.Session, response)
	}
	if err != nil || credential == nil || credential.Authenticator.CloneWarning {
		failure(w, 400, "Passkey could not be verified. Try again, use another sign-in method, or recover from the host.")
		return
	}
	value, expires, err := a.auth.Session(r.Context())
	if err != nil {
		failure(w, 500, "Session storage unavailable.")
		return
	}
	raw, err := json.Marshal(credential)
	if err != nil {
		failure(w, 500, "Could not save passkey.")
		return
	}
	id := base64.RawURLEncoding.EncodeToString(credential.ID)
	if action == "register" {
		err = a.auth.Store.RegisterPasskey(r.Context(), storage.Passkey{ID: id, Name: saved.Name, Origin: a.origin, Credential: string(raw)}, in.Mode, binding, auth.TokenHash(value), expires, a.auth.Now())
	} else {
		previous := ""
		for _, key := range keys {
			if key.ID == id {
				previous = key.Credential
				break
			}
		}
		err = a.auth.Store.CompletePasskeyLogin(r.Context(), id, a.origin, previous, string(raw), auth.TokenHash(value), expires, a.auth.Now())
	}
	if err != nil {
		failure(w, 409, "Account access or passkey changed. Start again or use host recovery.")
		return
	}
	if action == "login" || in.Mode != "session" {
		// A fresh sign-in replaces the caller's old browser session too.
		if token(r) != "" {
			_ = a.auth.Logout(r.Context(), token(r))
		}
		sessionCookie(w, value, expires, max(1, int(expires.Sub(a.auth.Now()).Seconds())))
		if in.Mode == "setup" {
			setupCookie(w, "", time.Unix(1, 0), -1)
		}
		if in.Mode == "recovery" {
			proofCookie(w, recoveryCookieName, "", time.Unix(1, 0), -1)
		}
	}
	jsonResponse(w, 200, map[string]bool{"authenticated": true})
}

// Password and passkey rate limits are separate so cancelled passkey prompts do
// not block the password recovery path.
func (a *api) allowCeremony(at time.Time) bool {
	a.ceremonyMu.Lock()
	defer a.ceremonyMu.Unlock()
	if at.Sub(a.ceremonyWindow) >= time.Minute {
		a.ceremonyWindow = at
		a.ceremonyAttempts = 0
	}
	if a.ceremonyAttempts >= 30 {
		return false
	}
	a.ceremonyAttempts++
	return true
}
