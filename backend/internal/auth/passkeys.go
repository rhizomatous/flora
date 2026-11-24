package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/rhizomatous/flora/backend/internal/storage"
)

const CeremonyLifetime = 3 * time.Minute

var ErrPasskeyConfig = errors.New("Passkeys require a canonical HTTPS address with a DNS hostname. Set -public-url on the host, then use host recovery to enroll at the new address.")

// NewWebAuthn trusts only the configured address. Request Host and forwarded
// headers never select the RP, including when Flora runs behind an HTTPS proxy.
func NewWebAuthn(origin string) (*webauthn.WebAuthn, error) {
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || net.ParseIP(u.Hostname()) != nil || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || strings.ToLower(u.Host) != u.Host {
		return nil, ErrPasskeyConfig
	}
	timeout := webauthn.TimeoutConfig{Enforce: true, Timeout: CeremonyLifetime, TimeoutUVD: CeremonyLifetime}
	w, err := webauthn.New(&webauthn.Config{
		RPID: u.Hostname(), RPDisplayName: "Flora", RPOrigins: []string{origin},
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			ResidentKey: protocol.ResidentKeyRequirementRequired, UserVerification: protocol.VerificationRequired,
		},
		Timeouts: webauthn.TimeoutsConfig{Login: timeout, Registration: timeout},
	})
	if err != nil {
		return nil, ErrPasskeyConfig
	}
	return w, nil
}

type PasskeyUser struct {
	Handle      []byte
	Credentials []webauthn.Credential
}

func (u PasskeyUser) WebAuthnID() []byte                         { return u.Handle }
func (u PasskeyUser) WebAuthnName() string                       { return "administrator" }
func (u PasskeyUser) WebAuthnDisplayName() string                { return "Flora administrator" }
func (u PasskeyUser) WebAuthnCredentials() []webauthn.Credential { return u.Credentials }

func (s *Service) PasskeyUser(ctx context.Context, origin string) (PasskeyUser, []storage.Passkey, error) {
	handle, err := s.Store.PasskeyIdentity(ctx)
	if err != nil {
		return PasskeyUser{}, nil, err
	}
	keys, err := s.Store.Passkeys(ctx)
	if err != nil {
		return PasskeyUser{}, nil, err
	}
	user := PasskeyUser{Handle: handle}
	for _, key := range keys {
		if key.Origin != origin {
			continue
		}
		var c webauthn.Credential
		if err := json.Unmarshal([]byte(key.Credential), &c); err != nil {
			return user, nil, err
		}
		user.Credentials = append(user.Credentials, c)
	}
	return user, keys, nil
}

func (s *Service) Session(ctx context.Context) (string, time.Time, error) {
	p, err := s.Store.Preferences(ctx)
	if err != nil {
		return "", time.Time{}, err
	}
	return newToken(), s.Now().Add(time.Duration(p.SessionSeconds) * time.Second).Truncate(time.Second), nil
}

func (s *Service) RecoveryValid(ctx context.Context, token string) (bool, error) {
	if len(token) != 43 {
		return false, nil
	}
	return s.Store.RecoveryValid(ctx, TokenHash(token), s.Now())
}
func (s *Service) RecoverPassword(ctx context.Context, password, proof string) (string, time.Time, error) {
	hash, err := passwordHash(password)
	if err != nil {
		return "", time.Time{}, err
	}
	token, expires, err := s.Session(ctx)
	if err != nil {
		return "", time.Time{}, err
	}
	err = s.Store.RecoverPassword(ctx, hash, TokenHash(proof), TokenHash(token), expires, s.Now())
	if errors.Is(err, storage.ErrNotFound) {
		err = ErrRecovery
	}
	return token, expires, err
}
