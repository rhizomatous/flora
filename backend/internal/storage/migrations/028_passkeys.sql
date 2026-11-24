CREATE TABLE IF NOT EXISTS passkey_identity (
 id INTEGER PRIMARY KEY CHECK(id=1),
 user_handle BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS passkeys (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 origin TEXT NOT NULL,
 credential TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 last_used_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS auth_ceremonies (
 token_hash TEXT PRIMARY KEY,
 purpose TEXT NOT NULL,
 binding TEXT NOT NULL,
 data TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS account_recovery (
 id INTEGER PRIMARY KEY CHECK(id=1),
 token_hash TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS session_authentication (
 token_hash TEXT PRIMARY KEY REFERENCES browser_sessions(token_hash) ON DELETE CASCADE,
 authenticated_at INTEGER NOT NULL
);
