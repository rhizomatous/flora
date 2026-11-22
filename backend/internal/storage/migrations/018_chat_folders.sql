CREATE TABLE chat_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    revision INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE chats ADD COLUMN folder_id TEXT REFERENCES chat_folders(id);
CREATE INDEX chats_folder ON chats(folder_id);
