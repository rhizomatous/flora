CREATE TABLE IF NOT EXISTS chat_public_ids (
 number INTEGER PRIMARY KEY AUTOINCREMENT CHECK(number > 0),
 prefix TEXT NOT NULL CHECK(length(prefix) BETWEEN 1 AND 4 AND prefix NOT GLOB '*[^A-Z]*'),
 public_id TEXT GENERATED ALWAYS AS (prefix || '-' || number) STORED NOT NULL UNIQUE,
 chat_id TEXT NOT NULL UNIQUE REFERENCES chats(id)
);
-- Strip punctuation and spaces, keeping up to four ASCII letters. Names without
-- ASCII letters use CHAT so references remain easy to type in URLs and commands.
CREATE VIEW IF NOT EXISTS chat_project_prefixes AS
 WITH RECURSIVE letters(project_id,name,position,prefix) AS (
  SELECT id,upper(name),1,'' FROM projects
  UNION ALL
  SELECT project_id,name,position+1,
   prefix || CASE WHEN substr(name,position,1) GLOB '[A-Z]' THEN substr(name,position,1) ELSE '' END
  FROM letters WHERE position <= length(name) AND length(prefix) < 4
 )
 SELECT project_id,coalesce(nullif(prefix,''),'CHAT') AS prefix
 FROM letters WHERE position > length(name) OR length(prefix)=4;
INSERT INTO chat_public_ids(prefix,chat_id)
 SELECT p.prefix,c.id FROM chats c JOIN chat_project_prefixes p ON p.project_id=c.project_id
 WHERE c.id NOT IN (SELECT chat_id FROM chat_public_ids) ORDER BY julianday(c.created_at),c.id;
-- Allocation commits with the chat insert. Reuse the project's first assigned
-- prefix after renames; the installation-wide number distinguishes equal prefixes.
CREATE TRIGGER IF NOT EXISTS allocate_chat_public_id AFTER INSERT ON chats
BEGIN
 INSERT INTO chat_public_ids(prefix,chat_id)
 SELECT coalesce(
  (SELECT p.prefix FROM chat_public_ids p JOIN chats c ON c.id=p.chat_id WHERE c.project_id=NEW.project_id ORDER BY p.number LIMIT 1),
  (SELECT prefix FROM chat_project_prefixes WHERE project_id=NEW.project_id)
 ),NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS immutable_chat_public_id BEFORE UPDATE ON chat_public_ids
BEGIN SELECT RAISE(ABORT, 'public chat ID is immutable'); END;
CREATE TRIGGER IF NOT EXISTS retain_chat_public_id BEFORE DELETE ON chat_public_ids
BEGIN SELECT RAISE(ABORT, 'public chat ID is permanent'); END;
