CREATE TABLE chat_read_state (
 chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision >= 0)
);
