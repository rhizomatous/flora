CREATE TABLE IF NOT EXISTS github_app (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    credentials TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS github_setup (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    state_hash TEXT NOT NULL,
    session_hash TEXT NOT NULL,
    kind TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
