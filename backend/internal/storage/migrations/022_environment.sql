CREATE TABLE environment_variables (
 scope TEXT NOT NULL CHECK(scope IN ('installation','project','chat')),
 owner_id TEXT NOT NULL,
 name TEXT NOT NULL,
 value TEXT NOT NULL,
 secret INTEGER NOT NULL CHECK(secret IN (0,1)),
 PRIMARY KEY(scope,owner_id,name)
);
CREATE TABLE chat_environment_requests (
 chat_id TEXT PRIMARY KEY REFERENCES chats(id),
 input TEXT NOT NULL
);
