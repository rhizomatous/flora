CREATE TABLE projects (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 config TEXT NOT NULL CHECK(json_valid(config)),
 created_at TEXT NOT NULL
);
CREATE TABLE chats (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 title TEXT NOT NULL,
 config TEXT NOT NULL CHECK(json_valid(config)),
 image_digest TEXT NOT NULL,
 harness_version TEXT NOT NULL,
 container_id TEXT,
 session_id TEXT,
 status TEXT NOT NULL CHECK(status IN ('working','waiting','failed','idle','stopped')),
 status_reason TEXT NOT NULL,
 active_message_id TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(active_message_id,id) REFERENCES messages(id,chat_id),
 CHECK(active_message_id IS NULL OR status IN ('working','waiting'))
);
CREATE TRIGGER immutable_chat_config BEFORE UPDATE OF project_id,config,image_digest,harness_version ON chats
BEGIN SELECT RAISE(ABORT, 'chat configuration is immutable'); END;
CREATE TABLE starting_commits (
 chat_id TEXT NOT NULL REFERENCES chats(id),
 repository TEXT NOT NULL,
 commit_sha TEXT NOT NULL,
 PRIMARY KEY(chat_id,repository)
);
CREATE TABLE messages (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 chat_id TEXT NOT NULL REFERENCES chats(id),
 request_id TEXT,
 runtime_message_id TEXT,
 role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
 text TEXT NOT NULL,
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 created_at TEXT NOT NULL,
 UNIQUE(chat_id,request_id),
 UNIQUE(chat_id,runtime_message_id),
 UNIQUE(id,chat_id),
 CHECK(request_id IS NULL OR role = 'user'),
 CHECK(role <> 'user' OR length(CAST(text AS BLOB)) <= 131072)
);
CREATE INDEX messages_chat ON messages(chat_id,sequence);
CREATE TABLE activity (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 chat_id TEXT NOT NULL REFERENCES chats(id),
 event_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 created_at TEXT NOT NULL,
 UNIQUE(chat_id,event_id)
);
CREATE INDEX activity_chat ON activity(chat_id,sequence);
