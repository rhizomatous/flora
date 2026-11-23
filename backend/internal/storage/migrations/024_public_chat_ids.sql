CREATE TABLE IF NOT EXISTS project_chat_ids (
 project_id TEXT PRIMARY KEY REFERENCES projects(id),
 prefix TEXT NOT NULL UNIQUE CHECK(length(prefix)>0 AND prefix NOT GLOB '*[^A-Z]*'),
 last_number INTEGER NOT NULL DEFAULT 0 CHECK(last_number>=0)
);
CREATE TABLE IF NOT EXISTS chat_public_ids (
 prefix TEXT NOT NULL REFERENCES project_chat_ids(prefix),
 number INTEGER NOT NULL CHECK(number>0),
 public_id TEXT GENERATED ALWAYS AS (prefix || '-' || number) STORED NOT NULL UNIQUE,
 chat_id TEXT PRIMARY KEY REFERENCES chats(id),
 UNIQUE(prefix,number)
);
-- The counter and ID commit with the chat insert, including retried requests.
CREATE TRIGGER IF NOT EXISTS allocate_chat_public_id AFTER INSERT ON chats
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM project_chat_ids WHERE project_id=NEW.project_id)
  THEN RAISE(ABORT, 'project chat prefix is missing') END;
 UPDATE project_chat_ids SET last_number=last_number+1 WHERE project_id=NEW.project_id;
 INSERT INTO chat_public_ids(prefix,number,chat_id)
 SELECT prefix,last_number,NEW.id FROM project_chat_ids WHERE project_id=NEW.project_id;
END;
CREATE TRIGGER IF NOT EXISTS immutable_project_chat_prefix BEFORE UPDATE OF project_id,prefix ON project_chat_ids
BEGIN SELECT RAISE(ABORT, 'project chat prefix is permanent'); END;
CREATE TRIGGER IF NOT EXISTS retain_project_chat_prefix BEFORE DELETE ON project_chat_ids
BEGIN SELECT RAISE(ABORT, 'project chat prefix is permanent'); END;
CREATE TRIGGER IF NOT EXISTS monotonic_project_chat_counter BEFORE UPDATE OF last_number ON project_chat_ids
WHEN NEW.last_number < OLD.last_number
BEGIN SELECT RAISE(ABORT, 'chat counter cannot decrease'); END;
CREATE TRIGGER IF NOT EXISTS immutable_chat_public_id BEFORE UPDATE ON chat_public_ids
BEGIN SELECT RAISE(ABORT, 'public chat ID is immutable'); END;
CREATE TRIGGER IF NOT EXISTS retain_chat_public_id BEFORE DELETE ON chat_public_ids
BEGIN SELECT RAISE(ABORT, 'public chat ID is permanent'); END;
