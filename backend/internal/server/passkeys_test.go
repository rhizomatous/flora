package server

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/fxamacker/cbor/v2"
	"github.com/rhizomatous/flora/backend/internal/auth"
	"github.com/rhizomatous/flora/backend/internal/settings"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

func encoded(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

type passkeyHarness struct {
	t       *testing.T
	store   *storage.Store
	service *auth.Service
	handler http.Handler
	cookies map[string]*http.Cookie
	at      time.Time
}

func newPasskeyHarness(t *testing.T) *passkeyHarness {
	t.Helper()
	store, err := storage.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	service := auth.New(store)
	h := &passkeyHarness{t: t, store: store, service: service, cookies: map[string]*http.Cookie{}, at: time.Now()}
	service.Now = func() time.Time { return h.at }
	h.handler = New(fstest.MapFS{}, service, settings.New(store), "https://flora.test:8443")
	return h
}
func (h *passkeyHarness) call(method, path string, body any, want int) map[string]json.RawMessage {
	h.t.Helper()
	raw, _ := json.Marshal(body)
	r := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "https://flora.test:8443")
	for _, c := range h.cookies {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	h.handler.ServeHTTP(w, r)
	if w.Code != want {
		h.t.Fatalf("%s %s: %d want %d: %s", method, path, w.Code, want, w.Body.String())
	}
	for _, c := range w.Result().Cookies() {
		if !c.Secure || !c.HttpOnly || c.SameSite != http.SameSiteStrictMode {
			h.t.Fatal("unsafe cookie", c)
		}
		if c.MaxAge < 0 {
			delete(h.cookies, c.Name)
		} else {
			h.cookies[c.Name] = c
		}
	}
	var result map[string]json.RawMessage
	_ = json.Unmarshal(w.Body.Bytes(), &result)
	return result
}
func (h *passkeyHarness) setup() {
	h.t.Helper()
	proof := auth.NewSetupToken()
	if err := h.store.SaveSetupLink(context.Background(), auth.TokenHash(proof), h.at.Add(time.Hour), false); err != nil {
		h.t.Fatal(err)
	}
	h.call("POST", "/api/auth/setup", map[string]string{"secret": proof}, 200)
}

type options struct {
	PublicKey struct {
		Challenge string `json:"challenge"`
		RP        struct {
			ID string `json:"id"`
		} `json:"rp"`
		RPID string `json:"rpId"`
		User struct {
			ID string `json:"id"`
		} `json:"user"`
	} `json:"publicKey"`
}

func (h *passkeyHarness) begin(action, mode, name string) options {
	h.t.Helper()
	result := h.call("POST", "/api/auth/passkeys/"+action+"/begin", map[string]string{"mode": mode, "name": name}, 200)
	raw, _ := json.Marshal(result)
	var out options
	if err := json.Unmarshal(raw, &out); err != nil {
		h.t.Fatal(err)
	}
	return out
}
func registration(t *testing.T, key *ecdsa.PrivateKey, id []byte, o options, origin, rpid string, uv bool) map[string]any {
	t.Helper()
	cose, err := cbor.Marshal(map[int]any{1: 2, 3: -7, -1: 1, -2: key.X.FillBytes(make([]byte, 32)), -3: key.Y.FillBytes(make([]byte, 32))})
	if err != nil {
		t.Fatal(err)
	}
	rp := sha256.Sum256([]byte(rpid))
	data := append([]byte{}, rp[:]...)
	flags := byte(0x41)
	if uv {
		flags |= 4
	}
	data = append(data, flags, 0, 0, 0, 0)
	data = append(data, make([]byte, 16)...)
	data = binary.BigEndian.AppendUint16(data, uint16(len(id)))
	data = append(data, id...)
	data = append(data, cose...)
	att, err := cbor.Marshal(map[string]any{"fmt": "none", "attStmt": map[string]any{}, "authData": data})
	if err != nil {
		t.Fatal(err)
	}
	client, _ := json.Marshal(map[string]any{"type": "webauthn.create", "challenge": o.PublicKey.Challenge, "origin": origin})
	return map[string]any{"id": encoded(id), "rawId": encoded(id), "type": "public-key", "response": map[string]any{"attestationObject": encoded(att), "clientDataJSON": encoded(client), "transports": []string{"internal"}}, "clientExtensionResults": map[string]any{}}
}
func assertion(t *testing.T, key *ecdsa.PrivateKey, id []byte, o options, handle, origin, rpid string, uv bool, count uint32) map[string]any {
	t.Helper()
	client, _ := json.Marshal(map[string]any{"type": "webauthn.get", "challenge": o.PublicKey.Challenge, "origin": origin})
	rp := sha256.Sum256([]byte(rpid))
	data := append([]byte{}, rp[:]...)
	flags := byte(1)
	if uv {
		flags |= 4
	}
	data = append(data, flags)
	data = binary.BigEndian.AppendUint32(data, count)
	clientHash := sha256.Sum256(client)
	message := append(append([]byte{}, data...), clientHash[:]...)
	digest := sha256.Sum256(message)
	sig, err := ecdsa.SignASN1(rand.Reader, key, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return map[string]any{"id": encoded(id), "rawId": encoded(id), "type": "public-key", "response": map[string]any{"clientDataJSON": encoded(client), "authenticatorData": encoded(data), "signature": encoded(sig), "userHandle": handle}, "clientExtensionResults": map[string]any{}}
}
func TestPasskeySetupAuthenticationAndSessions(t *testing.T) {
	h := newPasskeyHarness(t)
	ctx := context.Background()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	id := []byte("primary-passkey-id")
	h.call("POST", "/api/auth/passkeys/register/begin", map[string]string{"mode": "setup", "name": "Phone"}, 403)
	h.setup()
	o := h.begin("register", "setup", "Phone")
	if o.PublicKey.RP.ID != "flora.test" {
		t.Fatal("RP must exclude port", o)
	}
	h.call("GET", "/api/settings", nil, 401)
	credential := registration(t, key, id, o, "https://flora.test:8443", "flora.test", true)
	finish := map[string]any{"mode": "setup", "credential": credential}
	cookie := h.cookies[ceremonyCookieName]
	h.call("POST", "/api/auth/passkeys/register/finish", finish, 200)
	session := h.cookies[cookieName].Value
	if valid, _ := h.service.Valid(ctx, session); !valid {
		t.Fatal("passkey session invalid")
	}
	h.cookies[ceremonyCookieName] = cookie
	h.call("POST", "/api/auth/passkeys/register/finish", finish, 403)
	h.call("PATCH", "/api/auth/passkeys/"+encoded(id), map[string]string{"name": "Phone renamed"}, 200)
	h.call("DELETE", "/api/auth/passkeys/"+encoded(id), nil, 409)
	h.at = h.at.Add(6 * time.Minute)
	h.call("POST", "/api/auth/passkeys/register/begin", map[string]string{"mode": "session", "name": "Spare"}, 403)
	h.call("POST", "/api/auth/logout", nil, 200)
	if valid, _ := h.service.Valid(ctx, session); valid {
		t.Fatal("logout retained session")
	}
	login := h.begin("login", "", "")
	response := assertion(t, key, id, login, o.PublicKey.User.ID, "https://flora.test:8443", "flora.test", true, 1)
	proof := h.cookies[ceremonyCookieName]
	h.call("POST", "/api/auth/passkeys/login/finish", map[string]any{"credential": response}, 200)
	session = h.cookies[cookieName].Value
	h.cookies[ceremonyCookieName] = proof
	h.call("POST", "/api/auth/passkeys/login/finish", map[string]any{"credential": response}, 400)
	spare := h.begin("register", "session", "Spare")
	h.call("POST", "/api/auth/passkeys/register/finish", map[string]any{"mode": "session", "credential": registration(t, key, []byte("spare-id"), spare, "https://flora.test:8443", "flora.test", true)}, 200)
	h.call("DELETE", "/api/auth/passkeys/"+encoded(id), nil, 200)
	login = h.begin("login", "", "")
	h.call("POST", "/api/auth/passkeys/login/finish", map[string]any{"credential": assertion(t, key, id, login, o.PublicKey.User.ID, "https://flora.test:8443", "flora.test", true, 2)}, 400)
	h.at = h.at.Add(auth.Lifetime)
	if valid, _ := h.service.Valid(ctx, session); valid {
		t.Fatal("session did not expire")
	}
}

func TestPasskeyRejectsOriginRPVerificationAndExpiry(t *testing.T) {
	for _, scenario := range []string{"origin", "port", "rp", "uv", "expired", "replaced-setup", "browser"} {
		t.Run(scenario, func(t *testing.T) {
			h := newPasskeyHarness(t)
			h.setup()
			key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
			o := h.begin("register", "setup", "Phone")
			origin, rp, uv := "https://flora.test:8443", "flora.test", true
			switch scenario {
			case "origin":
				origin = "https://evil.test"
			case "port":
				origin = "https://flora.test"
			case "rp":
				rp = "evil.test"
			case "uv":
				uv = false
			case "expired":
				h.at = h.at.Add(4 * time.Minute)
			case "replaced-setup":
				_ = h.store.SaveSetupLink(context.Background(), auth.TokenHash(auth.NewSetupToken()), h.at.Add(time.Hour), true)
			case "browser":
				delete(h.cookies, ceremonyCookieName)
			}
			want := 400
			if scenario == "replaced-setup" {
				want = 403
			}
			h.call("POST", "/api/auth/passkeys/register/finish", map[string]any{"mode": "setup", "credential": registration(t, key, []byte("id"), o, origin, rp, uv)}, want)
			if _, err := h.store.AdministratorHash(context.Background()); err != storage.ErrNotFound {
				t.Fatal("invalid credential claimed installation", err)
			}
		})
	}
}

func TestPasskeyRecoveryAndGrantReplacement(t *testing.T) {
	h := newPasskeyHarness(t)
	h.setup()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	o := h.begin("register", "setup", "Lost phone")
	h.call("POST", "/api/auth/passkeys/register/finish", map[string]any{"mode": "setup", "credential": registration(t, key, []byte("lost-id"), o, "https://flora.test:8443", "flora.test", true)}, 200)
	oldSession := h.cookies[cookieName].Value
	proof := auth.NewSetupToken()
	ctx := context.Background()
	if err := h.store.SaveRecoveryLink(ctx, auth.TokenHash(proof), h.at.Add(15*time.Minute)); err != nil {
		t.Fatal(err)
	}
	h.call("POST", "/api/auth/recovery", map[string]string{"secret": proof}, 200)
	o = h.begin("register", "recovery", "Replacement")
	h.call("POST", "/api/auth/passkeys/register/finish", map[string]any{"mode": "recovery", "credential": registration(t, key, []byte("new-id"), o, "https://flora.test:8443", "flora.test", true)}, 200)
	if valid, _ := h.service.Valid(ctx, oldSession); valid {
		t.Fatal("recovery retained old session")
	}
	keys, _ := h.store.Passkeys(ctx)
	if len(keys) != 1 || keys[0].Name != "Replacement" {
		t.Fatal(keys)
	}
	h.call("POST", "/api/auth/recovery", map[string]string{"secret": proof}, 403)
	proof = auth.NewSetupToken()
	_ = h.store.SaveRecoveryLink(ctx, auth.TokenHash(proof), h.at.Add(15*time.Minute))
	h.call("POST", "/api/auth/recovery", map[string]string{"secret": proof}, 200)
	h.call("POST", "/api/auth/recover-password", map[string]string{"password": "replacement host password"}, 200)
	keys, _ = h.store.Passkeys(ctx)
	if len(keys) != 0 {
		t.Fatal("password recovery retained passkeys")
	}
	h.call("POST", "/api/auth/logout", nil, 200)
	h.call("POST", "/api/auth/login", map[string]string{"password": "replacement host password"}, 200)
}

func TestPasskeyLoginRejectsUnverifiedAssertions(t *testing.T) {
	h := newPasskeyHarness(t)
	h.setup()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	id := []byte("login-id")
	o := h.begin("register", "setup", "Phone")
	h.call("POST", "/api/auth/passkeys/register/finish", map[string]any{"mode": "setup", "credential": registration(t, key, id, o, "https://flora.test:8443", "flora.test", true)}, 200)
	h.call("POST", "/api/auth/logout", nil, 200)
	for _, scenario := range []string{"origin", "rp", "uv", "user", "signature", "expired"} {
		t.Run(scenario, func(t *testing.T) {
			login := h.begin("login", "", "")
			origin, rp, uv, handle := "https://flora.test:8443", "flora.test", true, o.PublicKey.User.ID
			signer := key
			switch scenario {
			case "origin":
				origin = "https://other.test"
			case "rp":
				rp = "other.test"
			case "uv":
				uv = false
			case "user":
				handle = encoded([]byte("another-user"))
			case "signature":
				signer, _ = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
			case "expired":
				h.at = h.at.Add(4 * time.Minute)
			}
			h.call("POST", "/api/auth/passkeys/login/finish", map[string]any{"credential": assertion(t, signer, id, login, handle, origin, rp, uv, 1)}, 400)
			if h.cookies[cookieName] != nil {
				t.Fatal("invalid assertion created a session")
			}
		})
	}
}

func TestRecoveryCannotFinishAfterReplacementOrExpiry(t *testing.T) {
	for _, scenario := range []string{"replaced", "expired"} {
		t.Run(scenario, func(t *testing.T) {
			h := newPasskeyHarness(t)
			h.setup()
			h.call("POST", "/api/auth/bootstrap", map[string]string{"password": "original admin password"}, 200)
			proof := auth.NewSetupToken()
			ctx := context.Background()
			_ = h.store.SaveRecoveryLink(ctx, auth.TokenHash(proof), h.at.Add(15*time.Minute))
			h.call("POST", "/api/auth/recovery", map[string]string{"secret": proof}, 200)
			if scenario == "replaced" {
				_ = h.store.SaveRecoveryLink(ctx, auth.TokenHash(auth.NewSetupToken()), h.at.Add(15*time.Minute))
			} else {
				h.at = h.at.Add(16 * time.Minute)
			}
			h.call("POST", "/api/auth/recover-password", map[string]string{"password": "unwanted replacement password"}, 403)
			if _, _, err := h.service.Login(ctx, "original admin password"); err != nil {
				t.Fatal("failed recovery changed password", err)
			}
		})
	}
}
