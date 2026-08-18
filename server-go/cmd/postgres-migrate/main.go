package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var migrationFilename = regexp.MustCompile(`^[0-9]{4}_[a-z0-9_]+\.sql$`)

func main() {
	if len(os.Args) != 2 || !migrationFilename.MatchString(filepath.Base(os.Args[1])) {
		fatal(errors.New("usage: postgres-migrate /path/to/NNNN_reviewed_migration.sql"))
	}
	migrationVersion := strings.TrimSuffix(filepath.Base(os.Args[1]), ".sql")
	sql, err := os.ReadFile(os.Args[1])
	if err != nil {
		fatal(fmt.Errorf("read migration: %w", err))
	}
	digest := sha256.Sum256(sql)
	digestHex := hex.EncodeToString(digest[:])
	approved := strings.ToLower(strings.TrimSpace(os.Getenv("POSTGRES_MIGRATION_APPROVED_SHA256")))
	if approved == "" || approved != digestHex {
		fatal(errors.New("POSTGRES_MIGRATION_APPROVED_SHA256 must match the reviewed migration file"))
	}
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		fatal(errors.New("DATABASE_URL is required"))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		fatal(fmt.Errorf("parse database configuration: %w", err))
	}
	config.MaxConns = 1
	config.ConnConfig.RuntimeParams["application_name"] = "neobank-postgres-migrate"
	config.ConnConfig.RuntimeParams["statement_timeout"] = "60s"
	config.ConnConfig.RuntimeParams["lock_timeout"] = "5s"
	config.ConnConfig.RuntimeParams["search_path"] = "public"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		fatal(fmt.Errorf("connect database: %w", err))
	}
	defer pool.Close()
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		fatal(fmt.Errorf("begin migration transaction: %w", err))
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(781204004)`); err != nil {
		fatal(fmt.Errorf("acquire migration lock: %w", err))
	}
	var applied string
	err = tx.QueryRow(ctx, `SELECT version FROM neobank_schema_migrations WHERE version=$1`, migrationVersion).Scan(&applied)
	if err == nil {
		fmt.Printf("migration already applied: version=%s sha256=%s\n", applied, digestHex)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		fatal(fmt.Errorf("read migration state: %w", err))
	}
	if _, err = tx.Exec(ctx, string(sql)); err != nil {
		fatal(fmt.Errorf("execute migration: %w", err))
	}
	if err = tx.QueryRow(ctx, `SELECT version FROM neobank_schema_migrations WHERE version=$1`, migrationVersion).Scan(&applied); err != nil {
		fatal(fmt.Errorf("verify migration: %w", err))
	}
	if err = tx.Commit(ctx); err != nil {
		fatal(fmt.Errorf("commit migration: %w", err))
	}
	fmt.Printf("migration applied: version=%s sha256=%s\n", applied, digestHex)
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "postgres migration failed:", err)
	os.Exit(1)
}
