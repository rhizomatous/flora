CREATE TABLE chat_requests (
 project_id TEXT NOT NULL REFERENCES projects(id),
 request_id TEXT NOT NULL,
 chat_id TEXT NOT NULL UNIQUE REFERENCES chats(id),
 title TEXT NOT NULL,
 text TEXT NOT NULL,
 PRIMARY KEY(project_id, request_id)
);
