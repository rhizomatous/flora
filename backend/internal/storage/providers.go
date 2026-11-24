package storage

import (
	"context"
	"database/sql"
	"errors"
)

func (s *Store) saveProvider(ctx context.Context, tx *sql.Tx, c Credentials) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO model_providers(provider,model,provider_key) VALUES(?,?,?) ON CONFLICT(provider) DO UPDATE SET model=excluded.model,provider_key=excluded.provider_key`, c.Provider, c.Model, s.secrets.seal(c.ProviderKey, "model-provider:"+c.Provider))
	return err
}

// ProviderCredentials resolves a saved chat choice using that provider's key.
// An empty choice retains the installation default for legacy callers.
func (s *Store) ProviderCredentials(ctx context.Context, e Execution) (Credentials, error) {
	c, err := s.Credentials(ctx)
	if err != nil || e.Provider == "" {
		return c, err
	}
	if c.Provider != e.Provider {
		s.secretMu.Lock()
		defer s.secretMu.Unlock()
		var encrypted string
		err = s.db.QueryRowContext(ctx, `SELECT model,provider_key FROM model_providers WHERE provider=?`, e.Provider).Scan(&c.Model, &encrypted)
		if err != nil {
			return Credentials{}, found(err)
		}
		c.Provider = e.Provider
		c.ProviderKey, err = s.secrets.open(encrypted, "model-provider:"+e.Provider)
		if err != nil {
			return Credentials{}, err
		}
	}
	if e.Model != "" {
		c.Model = e.Model
	}
	return c, nil
}

// Providers returns backend-only connections, including the pre-upgrade default.
func (s *Store) Providers(ctx context.Context) ([]Credentials, error) {
	c, err := s.Credentials(ctx)
	if errors.Is(err, ErrNotFound) {
		return []Credentials{}, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT provider FROM model_providers ORDER BY provider`)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	result := []Credentials{}
	if c.Provider != "" {
		result = append(result, c)
	}
	for _, id := range ids {
		if id == c.Provider {
			continue
		}
		p, err := s.ProviderCredentials(ctx, Execution{Provider: id})
		if err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, nil
}

// rotateProviders authenticates every saved key before updating any ciphertext.
// A nil destination only checks integrity during startup.
func rotateProviders(ctx context.Context, db interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, old, next *secretBox) error {
	rows, err := db.QueryContext(ctx, `SELECT provider,provider_key FROM model_providers`)
	if err != nil {
		return err
	}
	type record struct{ provider, key string }
	var records []record
	for rows.Next() {
		var r record
		if err := rows.Scan(&r.provider, &r.key); err != nil {
			rows.Close()
			return err
		}
		r.key, err = old.open(r.key, "model-provider:"+r.provider)
		if err != nil {
			rows.Close()
			return err
		}
		records = append(records, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if next != nil {
		for _, r := range records {
			if _, err := db.ExecContext(ctx, `UPDATE model_providers SET provider_key=? WHERE provider=?`, next.seal(r.key, "model-provider:"+r.provider), r.provider); err != nil {
				return err
			}
		}
	}
	return nil
}
