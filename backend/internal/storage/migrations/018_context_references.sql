CREATE TABLE IF NOT EXISTS context_references (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 payload TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS request_context (
 scope TEXT NOT NULL, request_id TEXT NOT NULL, refs TEXT NOT NULL,
 PRIMARY KEY(scope, request_id)
);
