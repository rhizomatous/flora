CREATE TABLE attachments (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 chat_id TEXT REFERENCES chats(id),
 message_id TEXT REFERENCES messages(id),
 name TEXT NOT NULL,
 mime TEXT NOT NULL,
 size INTEGER NOT NULL,
 content BLOB NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX abandoned_attachments ON attachments(created_at) WHERE message_id IS NULL;
ALTER TABLE chat_requests ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
