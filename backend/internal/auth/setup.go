package auth

import (
	"context"
	"errors"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

const SetupLinkLifetime = 24 * time.Hour
const SetupSessionLifetime = 15 * time.Minute

func NewSetupToken() string { return newToken() }

func (s *Service) RedeemSetup(ctx context.Context, link string) (string, time.Time, error) {
	if len(link) != 43 {
		return "", time.Time{}, ErrSetup
	}
	session := newToken()
	expires := s.Now().Add(SetupSessionLifetime).Truncate(time.Second)
	err := s.Store.RedeemSetup(ctx, TokenHash(link), TokenHash(session), s.Now(), expires)
	if errors.Is(err, storage.ErrNotFound) {
		err = ErrSetup
	}
	return session, expires, err
}

// SetupValid grants first-administrator creation only. Call Valid for every
// authenticated API; setup cookies must never authorize settings or agent work.
func (s *Service) SetupValid(ctx context.Context, session string) (bool, error) {
	if len(session) != 43 {
		return false, nil
	}
	return s.Store.SetupSessionValid(ctx, TokenHash(session), s.Now())
}
