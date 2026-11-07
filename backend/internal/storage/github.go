package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"time"
)

func capabilityDigest(secret string) string {
	digest := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(digest[:])
}

// ReplaceGitHubCapability revokes the chat's previous credential atomically.
// Only a digest is saved; the caller delivers the secret to the container.
func (s *Store) ReplaceGitHubCapability(ctx context.Context, chatID, secret string, expires time.Time) error {
	if len(secret) < 32 || !expires.After(time.Now()) {
		return ErrInvalid
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO github_capabilities (chat_id,digest,expires_at) VALUES (?,?,?) ON CONFLICT(chat_id) DO UPDATE SET digest=excluded.digest, expires_at=excluded.expires_at`, chatID, capabilityDigest(secret), expires.Unix())
	return err
}

func (s *Store) GitHubCapability(ctx context.Context, secret string, now time.Time) (string, error) {
	var chatID string
	err := s.db.QueryRowContext(ctx, `SELECT chat_id FROM github_capabilities WHERE digest=? AND expires_at>?`, capabilityDigest(secret), now.Unix()).Scan(&chatID)
	return chatID, found(err)
}

func (s *Store) RevokeGitHubCapability(ctx context.Context, chatID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM github_capabilities WHERE chat_id=?`, chatID)
	return err
}
