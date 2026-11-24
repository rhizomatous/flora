DROP TRIGGER IF EXISTS immutable_installation_model;
CREATE TABLE IF NOT EXISTS model_providers (
    provider TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    provider_key TEXT NOT NULL
);

UPDATE chats
SET execution = (
    SELECT json_object('provider', provider, 'model', model, 'variant', '')
    FROM installation_credentials WHERE id = 1
)
WHERE coalesce(json_extract(execution, '$.model'), '') = ''
  AND EXISTS (SELECT 1 FROM installation_credentials WHERE id = 1 AND provider <> '');
