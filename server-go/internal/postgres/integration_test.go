package postgres

import (
	"context"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresAdapterIntegration(t *testing.T) {
	databaseURL := os.Getenv("POSTGRES_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("POSTGRES_TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	client, err := New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	parsed, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("PGHOST", parsed.ConnConfig.Host)
	t.Setenv("PGPORT", strconv.Itoa(int(parsed.ConnConfig.Port)))
	t.Setenv("PGUSER", parsed.ConnConfig.User)
	t.Setenv("PGPASSWORD", parsed.ConnConfig.Password)
	t.Setenv("PGDATABASE", parsed.ConnConfig.Database)
	if parsed.ConnConfig.TLSConfig == nil {
		t.Setenv("PGSSLMODE", "disable")
	} else {
		t.Setenv("PGSSLMODE", "require")
	}
	environmentClient, err := NewFromEnvironment(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if rows, queryErr := environmentClient.Query(ctx, `SELECT 1 AS ok`); queryErr != nil || len(rows) != 1 {
		t.Fatalf("PG* environment connection failed: rows=%#v err=%v", rows, queryErr)
	}
	environmentClient.Close()
	settings, err := client.Query(ctx, `SELECT current_setting('statement_timeout') AS statement_timeout,
      current_setting('lock_timeout') AS lock_timeout,
      current_setting('search_path') AS search_path`)
	if err != nil {
		t.Fatal(err)
	}
	if len(settings) != 1 || settings[0]["statement_timeout"] != "15s" ||
		settings[0]["lock_timeout"] != "5s" || settings[0]["search_path"] != "public" {
		t.Fatalf("unexpected postgres safety settings: %#v", settings)
	}

	_, err = client.Batch(ctx,
		d1.Statement{SQL: `CREATE TABLE postgres_adapter_counter (id TEXT PRIMARY KEY, value BIGINT NOT NULL)`},
		d1.Statement{SQL: `INSERT INTO postgres_adapter_counter (id, value) VALUES (?, ?)`, Params: []any{"counter", int64(0)}},
	)
	if err != nil {
		t.Fatal(err)
	}

	update := d1.Statement{SQL: `WITH current_value AS (
      SELECT value FROM postgres_adapter_counter WHERE id=?
    ), updated AS (
      UPDATE postgres_adapter_counter
      SET value=(SELECT value + 1 FROM current_value)
      WHERE id=? RETURNING value
    ) SELECT value FROM updated`, Params: []any{"counter", "counter"}}
	var wait sync.WaitGroup
	errors := make(chan error, 2)
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, updateErr := client.Batch(ctx, update)
			errors <- updateErr
		}()
	}
	wait.Wait()
	close(errors)
	for updateErr := range errors {
		if updateErr != nil {
			t.Fatal(updateErr)
		}
	}
	rows, err := client.Query(ctx, `SELECT CAST(value AS TEXT) AS value FROM postgres_adapter_counter WHERE id=?`, "counter")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0]["value"] != "2" {
		t.Fatalf("serializable retry invariant failed: %#v", rows)
	}
}
