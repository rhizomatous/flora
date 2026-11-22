CREATE TABLE IF NOT EXISTS chat_public_ids (
 number INTEGER PRIMARY KEY AUTOINCREMENT CHECK(number > 0),
 public_id TEXT GENERATED ALWAYS AS ('FLORA-' || number) STORED NOT NULL UNIQUE,
 chat_id TEXT NOT NULL UNIQUE REFERENCES chats(id)
);
INSERT INTO chat_public_ids(chat_id)
 SELECT id FROM chats WHERE id NOT IN (SELECT chat_id FROM chat_public_ids) ORDER BY julianday(created_at), id;
-- The insert and allocation commit together, including creation request retries.
CREATE TRIGGER IF NOT EXISTS allocate_chat_public_id AFTER INSERT ON chats
BEGIN INSERT INTO chat_public_ids(chat_id) VALUES (NEW.id); END;
CREATE TRIGGER IF NOT EXISTS immutable_chat_public_id BEFORE UPDATE ON chat_public_ids
BEGIN SELECT RAISE(ABORT, 'public chat ID is immutable'); END;
CREATE TRIGGER IF NOT EXISTS retain_chat_public_id BEFORE DELETE ON chat_public_ids
BEGIN SELECT RAISE(ABORT, 'public chat ID is permanent'); END;
