CREATE TABLE automations (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 config TEXT NOT NULL CHECK(json_valid(config)),
 enabled INTEGER NOT NULL,
 next_run TEXT NOT NULL,
 chat_id TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE automation_runs (
 id TEXT PRIMARY KEY,
 automation_id TEXT NOT NULL REFERENCES automations(id),
 scheduled_at TEXT NOT NULL,
 mode TEXT NOT NULL,
 revision INTEGER NOT NULL,
 status TEXT NOT NULL,
 reason TEXT NOT NULL DEFAULT '',
 chat_id TEXT NOT NULL DEFAULT '',
 message_id TEXT NOT NULL DEFAULT '',
 released INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX automation_run_history ON automation_runs(automation_id,scheduled_at DESC);
