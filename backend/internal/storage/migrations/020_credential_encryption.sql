CREATE TABLE IF NOT EXISTS credential_encryption (
 id INTEGER PRIMARY KEY CHECK(id = 1),
 verifier TEXT NOT NULL,
 cleanup_pending INTEGER NOT NULL CHECK(cleanup_pending IN (0,1))
);
