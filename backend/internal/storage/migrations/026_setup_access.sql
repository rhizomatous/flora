CREATE TABLE IF NOT EXISTS setup_access (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    link_hash TEXT NOT NULL,
    link_expires INTEGER NOT NULL,
    session_hash TEXT NOT NULL DEFAULT '',
    session_expires INTEGER NOT NULL DEFAULT 0
);
