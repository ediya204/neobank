package postgres

import (
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestPostgresSQLRebindsParametersWithoutChangingQuotedQuestionMarks(t *testing.T) {
	sql, query := postgresSQL("SELECT '?' AS literal, value FROM test WHERE first=? AND second=?")
	if !query {
		t.Fatal("SELECT must be classified as a query")
	}
	want := "SELECT '?' AS literal, value FROM test WHERE first=$1 AND second=$2"
	if sql != want {
		t.Fatalf("unexpected SQL: %s", sql)
	}
}

func TestPostgresSQLClassifiesQueriesAcrossWhitespace(t *testing.T) {
	tests := []struct {
		name  string
		sql   string
		query bool
	}{
		{name: "select newline", sql: "SELECT\nvalue FROM test", query: true},
		{name: "with newline", sql: "WITH\nvalues AS (SELECT 1) SELECT * FROM values", query: true},
		{name: "update", sql: "UPDATE test SET value=?", query: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, query := postgresSQL(test.sql)
			if query != test.query {
				t.Fatalf("query classification = %t, want %t", query, test.query)
			}
		})
	}
}

func TestPostgresSQLConvertsInsertOrIgnore(t *testing.T) {
	sql, query := postgresSQL("INSERT OR IGNORE INTO test (id, value) VALUES (?, ?)")
	if query {
		t.Fatal("INSERT must not be classified as a query")
	}
	want := "INSERT INTO test (id, value) VALUES ($1, $2) ON CONFLICT DO NOTHING"
	if sql != want {
		t.Fatalf("unexpected SQL: %s", sql)
	}
}

func TestRetryableTransactionErrors(t *testing.T) {
	for _, code := range []string{"40001", "40P01"} {
		err := fmt.Errorf("wrapped: %w", &pgconn.PgError{Code: code})
		if !isRetryableTransactionError(err) {
			t.Fatalf("expected SQLSTATE %s to be retryable", code)
		}
	}
	if isRetryableTransactionError(&pgconn.PgError{Code: "23505"}) {
		t.Fatal("unique constraint violations must not be retried")
	}
}
