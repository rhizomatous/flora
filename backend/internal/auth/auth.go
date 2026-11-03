// Package auth manages the single administrator and absolute browser sessions.
package auth

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/rhizomatous/flora/backend/internal/storage"
)

const Lifetime = 7 * 24 * time.Hour
const iterations = 600000

var ErrPassword = errors.New("Use a password between 12 and 1024 bytes.")
var ErrLogin = errors.New("Password is incorrect.")
var ErrEnrollment = errors.New("Installer enrollment code is incorrect.")

type Service struct {
	Store          *storage.Store
	Now            func() time.Time
	enrollmentHash string
}

func New(store *storage.Store) *Service { return &Service{Store: store, Now: time.Now} }

// RequireEnrollment reads a SHA256 digest, never the plaintext code. The file
// must be private and non-symlinked, inside an administrator-controlled directory.
// Call before serving requests. A configured but unreadable file fails closed.
func (s *Service) RequireEnrollment(path string) error {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() & ^os.FileMode(0640) != 0 || info.Size() != 64 {
		return errors.New("enrollment digest must be a private regular file")
	}
	f, err := os.Open(path)
	if err != nil {
		return errors.New("cannot open enrollment digest")
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return errors.New("enrollment digest changed while opening")
	}
	var raw [65]byte
	n, err := io.ReadFull(f, raw[:])
	if err != io.ErrUnexpectedEOF || n != 64 {
		return errors.New("enrollment digest must contain exactly 64 hexadecimal characters")
	}
	decoded, err := hex.DecodeString(string(raw[:64]))
	if err != nil || len(decoded) != 32 {
		return errors.New("invalid enrollment digest")
	}
	s.enrollmentHash = hex.EncodeToString(decoded)
	return nil
}

func (s *Service) EnrollmentRequired() bool { return s.enrollmentHash != "" }

func passwordHash(password string) (string, error) {
	if len(password) < 12 || len(password) > 1024 {
		return "", ErrPassword
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := pbkdf2.Key(sha256.New, password, salt, iterations, 32)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", iterations, base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

func matches(hash, password string) bool {
	p := strings.Split(hash, "$")
	if len(p) != 4 || p[0] != "pbkdf2-sha256" || len(password) > 1024 {
		return false
	}
	count, err := strconv.Atoi(p[1])
	if err != nil || count < iterations || count > 2000000 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(p[2])
	if err != nil || len(salt) != 16 {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(p[3])
	if err != nil || len(want) != 32 {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, password, salt, count, 32)
	return err == nil && subtle.ConstantTimeCompare(got, want) == 1
}

func TokenHash(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

func newToken() string {
	b := make([]byte, 32)
	// crypto/rand.Read fills the slice or terminates the process on RNG failure.
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func (s *Service) Bootstrap(ctx context.Context, password string, code ...string) (string, time.Time, error) {
	if s.enrollmentHash != "" {
		if _, err := s.Store.AdministratorHash(ctx); err == nil {
			return "", time.Time{}, storage.ErrConflict
		} else if !errors.Is(err, storage.ErrNotFound) {
			return "", time.Time{}, err
		}
		if len(code) != 1 || len(code[0]) > 256 || subtle.ConstantTimeCompare([]byte(TokenHash(code[0])), []byte(s.enrollmentHash)) != 1 {
			return "", time.Time{}, ErrEnrollment
		}
	}
	hash, err := passwordHash(password)
	if err != nil {
		return "", time.Time{}, err
	}
	token := newToken()
	p, err := s.Store.Preferences(ctx)
	if err != nil {
		return "", time.Time{}, err
	}
	expires := s.Now().Add(time.Duration(p.SessionSeconds) * time.Second).Truncate(time.Second)
	err = s.Store.Bootstrap(ctx, hash, TokenHash(token), expires)
	return token, expires, err
}

func (s *Service) Login(ctx context.Context, password string) (string, time.Time, error) {
	hash, err := s.Store.AdministratorHash(ctx)
	if errors.Is(err, storage.ErrNotFound) {
		return "", time.Time{}, ErrLogin
	}
	if err != nil {
		return "", time.Time{}, err
	}
	if !matches(hash, password) {
		return "", time.Time{}, ErrLogin
	}
	token := newToken()
	p, err := s.Store.Preferences(ctx)
	if err != nil {
		return "", time.Time{}, err
	}
	expires := s.Now().Add(time.Duration(p.SessionSeconds) * time.Second).Truncate(time.Second)
	err = s.Store.CreateSession(ctx, TokenHash(token), expires)
	return token, expires, err
}

func (s *Service) Valid(ctx context.Context, token string) (bool, error) {
	if len(token) != 43 {
		return false, nil
	}
	return s.Store.SessionValid(ctx, TokenHash(token), s.Now())
}

func (s *Service) Logout(ctx context.Context, token string) error {
	return s.Store.RevokeSession(ctx, TokenHash(token))
}
