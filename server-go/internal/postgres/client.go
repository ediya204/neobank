package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxSerializableAttempts = 3

const defaultMaxConnections int32 = 4

type Client struct {
	pool *pgxpool.Pool
}

func New(ctx context.Context, databaseURL string) (*Client, error) {
	if strings.TrimSpace(databaseURL) == "" {
		return nil, errors.New("DATABASE_URL is required for the postgres backend")
	}
	return newClient(ctx, databaseURL)
}

// NewFromEnvironment uses libpq-compatible PG* environment variables. It is
// reserved for the operator-run migration command so a credential-bearing URL
// never needs to appear in a psql process argument.
func NewFromEnvironment(ctx context.Context) (*Client, error) {
	return newClient(ctx, "")
}

func newClient(ctx context.Context, connectionString string) (*Client, error) {
	config, err := pgxpool.ParseConfig(connectionString)
	if err != nil {
		return nil, fmt.Errorf("parse postgres configuration: %w", err)
	}
	config.ConnConfig.RuntimeParams["application_name"] = "neobank-go-api"
	config.ConnConfig.RuntimeParams["statement_timeout"] = "15s"
	config.ConnConfig.RuntimeParams["lock_timeout"] = "5s"
	config.ConnConfig.RuntimeParams["idle_in_transaction_session_timeout"] = "10s"
	config.ConnConfig.RuntimeParams["search_path"] = "public"
	// Basic-256mb is intentionally small. Keep a narrow application-side pool
	// so a restart or scale-out cannot consume the database connection budget.
	config.MaxConns = defaultMaxConnections
	config.MinConns = 0
	config.MaxConnIdleTime = 5 * time.Minute
	config.MaxConnLifetime = 30 * time.Minute
	config.MaxConnLifetimeJitter = 5 * time.Minute
	config.HealthCheckPeriod = time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create postgres pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return &Client{pool: pool}, nil
}

func (c *Client) Close() {
	c.pool.Close()
}

func (c *Client) Batch(ctx context.Context, statements ...d1.Statement) ([]d1.Result, error) {
	if len(statements) == 0 {
		return nil, errors.New("postgres batch requires at least one statement")
	}
	var lastErr error
	for attempt := 1; attempt <= maxSerializableAttempts; attempt++ {
		results, err := c.batchOnce(ctx, statements...)
		if err == nil {
			return results, nil
		}
		lastErr = err
		if !isRetryableTransactionError(err) || ctx.Err() != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("postgres batch exhausted serializable retries: %w", lastErr)
}

func (c *Client) batchOnce(ctx context.Context, statements ...d1.Statement) ([]d1.Result, error) {
	// D1 serializes each batch. Preserve the same financial invariant on
	// Postgres so concurrent balance reservations cannot both commit from one
	// stale snapshot.
	tx, err := c.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, fmt.Errorf("begin postgres batch: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	results := make([]d1.Result, 0, len(statements))
	for _, statement := range statements {
		sql, query := postgresSQL(statement.SQL)
		if query {
			rows, queryErr := tx.Query(ctx, sql, statement.Params...)
			if queryErr != nil {
				return nil, fmt.Errorf("query postgres batch: %w", queryErr)
			}
			mapped, mapErr := collectRows(rows)
			if mapErr != nil {
				return nil, mapErr
			}
			results = append(results, d1.Result{
				Results: mapped,
				Success: true,
				Meta:    map[string]any{"changes": float64(0)},
			})
			continue
		}
		command, execErr := tx.Exec(ctx, sql, statement.Params...)
		if execErr != nil {
			return nil, fmt.Errorf("execute postgres batch: %w", execErr)
		}
		results = append(results, d1.Result{
			Success: true,
			Meta:    map[string]any{"changes": float64(command.RowsAffected())},
		})
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit postgres batch: %w", err)
	}
	return results, nil
}

func isRetryableTransactionError(err error) bool {
	var postgresErr *pgconn.PgError
	if !errors.As(err, &postgresErr) {
		return false
	}
	return postgresErr.Code == "40001" || postgresErr.Code == "40P01"
}

func (c *Client) Query(ctx context.Context, sql string, params ...any) ([]map[string]any, error) {
	results, err := c.Batch(ctx, d1.Statement{SQL: sql, Params: params})
	if err != nil {
		return nil, err
	}
	if len(results) != 1 || !results[0].Success {
		return nil, errors.New("postgres query did not succeed")
	}
	return results[0].Results, nil
}

func collectRows(rows pgx.Rows) ([]map[string]any, error) {
	defer rows.Close()
	fields := rows.FieldDescriptions()
	result := make([]map[string]any, 0)
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, fmt.Errorf("read postgres row: %w", err)
		}
		row := make(map[string]any, len(fields))
		for index, field := range fields {
			row[string(field.Name)] = values[index]
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate postgres rows: %w", err)
	}
	return result, nil
}

func postgresSQL(raw string) (string, bool) {
	sql := strings.TrimSpace(raw)
	upper := strings.ToUpper(sql)
	fields := strings.Fields(upper)
	query := len(fields) > 0 && (fields[0] == "SELECT" || fields[0] == "WITH")
	if strings.HasPrefix(upper, "INSERT OR IGNORE INTO ") {
		sql = "INSERT INTO " + strings.TrimSpace(sql[len("INSERT OR IGNORE INTO "):])
		sql += " ON CONFLICT DO NOTHING"
	}
	return rebindQuestionMarks(sql), query
}

func rebindQuestionMarks(sql string) string {
	var output strings.Builder
	output.Grow(len(sql) + 16)
	parameter := 1
	inSingleQuote := false
	inDoubleQuote := false
	for index := 0; index < len(sql); index++ {
		character := sql[index]
		if character == '\'' && !inDoubleQuote {
			output.WriteByte(character)
			if inSingleQuote && index+1 < len(sql) && sql[index+1] == '\'' {
				output.WriteByte(sql[index+1])
				index++
				continue
			}
			inSingleQuote = !inSingleQuote
			continue
		}
		if character == '"' && !inSingleQuote {
			inDoubleQuote = !inDoubleQuote
			output.WriteByte(character)
			continue
		}
		if character == '?' && !inSingleQuote && !inDoubleQuote {
			_, _ = fmt.Fprintf(&output, "$%d", parameter)
			parameter++
			continue
		}
		output.WriteByte(character)
	}
	return output.String()
}
