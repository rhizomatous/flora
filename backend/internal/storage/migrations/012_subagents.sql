CREATE TABLE subagents (
 chat_id TEXT NOT NULL REFERENCES chats(id),
 session_id TEXT NOT NULL,
 parent_id TEXT NOT NULL,
 number INTEGER NOT NULL,
 title TEXT NOT NULL,
 status TEXT NOT NULL,
 collection TEXT NOT NULL,
 created_ms INTEGER NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(chat_id,session_id)
);
CREATE TABLE subagent_messages (
 chat_id TEXT NOT NULL,
 session_id TEXT NOT NULL,
 message_id TEXT NOT NULL,
 created_ms INTEGER NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 PRIMARY KEY(chat_id,session_id,message_id),
 FOREIGN KEY(chat_id,session_id) REFERENCES subagents(chat_id,session_id)
);
-- Settled chats need one more traversal to collect their child prompts and metadata.
UPDATE usage_capture SET chat_revision='';
