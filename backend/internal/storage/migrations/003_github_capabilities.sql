CREATE TABLE github_capabilities (
    chat_id TEXT PRIMARY KEY REFERENCES chats(id),
    digest TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL
);
