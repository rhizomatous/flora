CREATE TABLE IF NOT EXISTS shells (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    container_id TEXT NOT NULL,
    runtime_id TEXT NOT NULL,
    title TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'running'
);
CREATE INDEX IF NOT EXISTS shells_chat ON shells(chat_id);
