package main

import (
	"database/sql"
	"path/filepath"
	"testing"
)

// Exercise the driver's persistence contract with CGO disabled, not just linking.
func TestSQLitePersistsAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "flora.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec("CREATE TABLE probe (value TEXT NOT NULL); INSERT INTO probe VALUES ('flora')"); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	var value string
	if err := reopened.QueryRow("SELECT value FROM probe").Scan(&value); err != nil {
		t.Fatal(err)
	}
	if value != "flora" {
		t.Fatalf("persisted value = %q, want flora", value)
	}
}
