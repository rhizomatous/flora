CREATE TABLE context_limits (
 chat_id TEXT NOT NULL REFERENCES chats(id),
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 token_limit INTEGER NOT NULL CHECK(token_limit > 0),
 PRIMARY KEY(chat_id,provider,model)
);
