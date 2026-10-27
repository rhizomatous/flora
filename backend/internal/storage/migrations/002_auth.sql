CREATE TABLE administrator (
 id INTEGER PRIMARY KEY CHECK(id = 1),
 password_hash TEXT NOT NULL
);
CREATE TABLE browser_sessions (
 token_hash TEXT PRIMARY KEY,
 expires_at INTEGER NOT NULL
);
CREATE TABLE installation_credentials (
 id INTEGER PRIMARY KEY CHECK(id = 1),
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 github_token TEXT NOT NULL,
 provider_key TEXT NOT NULL
);
CREATE TRIGGER immutable_installation_model BEFORE UPDATE OF provider,model ON installation_credentials
WHEN NEW.provider <> OLD.provider OR NEW.model <> OLD.model
BEGIN SELECT RAISE(ABORT, 'installation model is immutable'); END;
