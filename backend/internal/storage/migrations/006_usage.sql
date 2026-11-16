CREATE TABLE usage_messages (
 chat_id TEXT NOT NULL REFERENCES chats(id),
 session_id TEXT NOT NULL,
 message_id TEXT NOT NULL,
 turn_id TEXT,
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 created_ms INTEGER NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 incomplete INTEGER NOT NULL,
 pricing_known INTEGER NOT NULL,
 PRIMARY KEY(chat_id,session_id,message_id),
 FOREIGN KEY(turn_id,chat_id) REFERENCES messages(id,chat_id)
);
CREATE TABLE usage_steps (
 chat_id TEXT NOT NULL,
 session_id TEXT NOT NULL,
 message_id TEXT NOT NULL,
 step_id TEXT NOT NULL,
 cost_nanos INTEGER,
 input_tokens INTEGER,
 output_tokens INTEGER,
 reasoning_tokens INTEGER,
 cache_read_tokens INTEGER,
 cache_write_tokens INTEGER,
 PRIMARY KEY(chat_id,session_id,message_id,step_id),
 FOREIGN KEY(chat_id,session_id,message_id) REFERENCES usage_messages(chat_id,session_id,message_id)
);
CREATE TABLE usage_capture (
 chat_id TEXT PRIMARY KEY REFERENCES chats(id),
 complete INTEGER NOT NULL,
 checked_at TEXT NOT NULL
);
