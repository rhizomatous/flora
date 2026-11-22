CREATE TABLE compaction_choices (
 chat_id TEXT NOT NULL REFERENCES chats(id),
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 threshold INTEGER NOT NULL CHECK(threshold > 0 AND threshold <= 1000000000000),
 PRIMARY KEY(chat_id, provider, model)
);
