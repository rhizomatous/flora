CREATE TABLE IF NOT EXISTS mcp_servers (
 scope TEXT NOT NULL,
 name TEXT NOT NULL,
 config TEXT NOT NULL,
 headers TEXT NOT NULL,
 PRIMARY KEY(scope,name)
);
