package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
	postgresdb "github.com/ediya204/neobank/server-go/internal/postgres"
)

type tableSpec struct {
	Name       string
	PrimaryKey string
	Columns    []string
}

type tableManifest struct {
	Table        string `json:"table"`
	Rows         int    `json:"rows"`
	SourceSHA256 string `json:"source_sha256"`
	TargetSHA256 string `json:"target_sha256"`
}

type manifest struct {
	GeneratedAt string          `json:"generated_at"`
	Source      string          `json:"source"`
	Target      string          `json:"target"`
	Tables      []tableManifest `json:"tables"`
}

var tables = []tableSpec{
	{Name: "customers", PrimaryKey: "id", Columns: fields(`
		id tenant_id email display_name status kyc_status kyc_reviewed_by kyc_reviewed_at
		kyc_review_note operations_status activated_by activated_at created_by created_at updated_at`)},
	{Name: "customer_credentials", PrimaryKey: "customer_id", Columns: fields(`
		customer_id password_salt password_hash password_algorithm password_iterations
		password_memory_kib password_time_cost password_parallelism password_changed_at
		totp_secret_ciphertext totp_last_counter setup_token_hash setup_expires_at setup_consumed_at
		enrollment_token_hash enrollment_expires_at failed_attempts locked_until credential_version updated_at`)},
	{Name: "customer_login_challenges", PrimaryKey: "id", Columns: fields(`
		id customer_id token_hash expires_at consumed_at attempts credential_version created_at`)},
	{Name: "customer_sessions", PrimaryKey: "id", Columns: fields(`
		id customer_id token_hash csrf_hash credential_version expires_at idle_expires_at revoked_at created_at last_seen_at`)},
	{Name: "customer_recovery_codes", PrimaryKey: "id", Columns: fields(`
		id customer_id code_hash used_at created_at`)},
	{Name: "customer_auth_audit_events", PrimaryKey: "id", Columns: fields(`
		id customer_id event_type actor metadata_json created_at`)},
	{Name: "cregis_wallets", PrimaryKey: "id", Columns: fields(`
		id tenant_id customer_id idempotency_key chain_id token_id currency address alias status
		custody_provider ownership_verified_at created_by created_at updated_at`)},
	{Name: "cregis_withdrawals", PrimaryKey: "id", Columns: fields(`
		id tenant_id customer_id wallet_id idempotency_key third_party_id currency amount_text amount_minor
		from_address to_address memo remark status cregis_cid txid block_height block_time maker_id checker_id
		operator_id rejection_reason reconciliation_note reconciled_by reconciled_at created_at approved_at
		submitted_at completed_at updated_at`)},
	{Name: "cregis_deposits", PrimaryKey: "id", Columns: fields(`
		id tenant_id wallet_id cregis_cid chain_id token_id currency address amount_text amount_minor status
		txid block_height block_time received_at raw_sha256`)},
	{Name: "cregis_callback_events", PrimaryKey: "id", Columns: fields(`
		id event_type cregis_cid status payload_sha256 received_at`)},
}

var integerColumns = map[string]struct{}{
	"password_iterations": {}, "password_memory_kib": {}, "password_time_cost": {},
	"password_parallelism": {}, "totp_last_counter": {}, "failed_attempts": {},
	"credential_version": {}, "attempts": {}, "amount_minor": {},
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	source, err := d1.New(os.Getenv("SOURCE_D1_GATEWAY_URL"), os.Getenv("SOURCE_D1_GATEWAY_SECRET"))
	if err != nil {
		fatal(err)
	}
	var target *postgresdb.Client
	if databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL")); databaseURL != "" {
		target, err = postgresdb.New(ctx, databaseURL)
	} else {
		target, err = postgresdb.NewFromEnvironment(ctx)
	}
	if err != nil {
		fatal(err)
	}
	defer target.Close()
	for name, query := range map[string]string{
		"foreign_keys": `SELECT COUNT(*) AS count FROM pragma_foreign_key_check`,
		"negative_wallet_funds": `SELECT COUNT(*) AS count FROM cregis_wallets w
		  WHERE COALESCE((SELECT SUM(d.amount_minor) FROM cregis_deposits d
		    WHERE d.tenant_id=w.tenant_id AND d.wallet_id=w.id AND d.status='completed'), 0)
		  - COALESCE((SELECT SUM(x.amount_minor) FROM cregis_withdrawals x
		    WHERE x.tenant_id=w.tenant_id AND x.wallet_id=w.id
		      AND x.status NOT IN ('rejected', 'failed', 'cancelled')), 0) < 0`,
	} {
		rows, preflightErr := source.Query(ctx, query)
		if preflightErr != nil || len(rows) != 1 || integer(rows[0]["count"]) != 0 {
			fatal(fmt.Errorf("restored D1 preflight %s failed", name))
		}
	}

	version, err := target.Query(ctx, `SELECT version FROM neobank_schema_migrations WHERE version=?`, "0001_neobank_core")
	if err != nil || len(version) != 1 {
		fatal(errors.New("target postgres schema 0001_neobank_core is not applied"))
	}

	sourceRows := make(map[string][]map[string]any, len(tables))
	statements := make([]d1.Statement, 0)
	for _, table := range tables {
		countRows, countErr := target.Query(ctx, fmt.Sprintf("SELECT COUNT(*) AS count FROM %s", table.Name))
		if countErr != nil || len(countRows) != 1 || integer(countRows[0]["count"]) != 0 {
			fatal(fmt.Errorf("target table %s must be empty before migration", table.Name))
		}
		query := fmt.Sprintf("SELECT %s FROM %s ORDER BY %s", selectColumns(table), table.Name, table.PrimaryKey)
		rows, queryErr := source.Query(ctx, query)
		if queryErr != nil {
			fatal(fmt.Errorf("read restored D1 table %s: %w", table.Name, queryErr))
		}
		sourceRows[table.Name] = rows
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(table.Columns)), ",")
		insertSQL := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", table.Name, strings.Join(table.Columns, ", "), placeholders)
		for _, row := range rows {
			params := make([]any, 0, len(table.Columns))
			for _, column := range table.Columns {
				value, valueErr := normalizeDatabaseValue(column, row[column])
				if valueErr != nil {
					fatal(fmt.Errorf("normalize %s.%s: %w", table.Name, column, valueErr))
				}
				params = append(params, value)
			}
			statements = append(statements, d1.Statement{SQL: insertSQL, Params: params})
		}
	}
	if len(statements) != 0 {
		if _, err := target.Batch(ctx, statements...); err != nil {
			fatal(fmt.Errorf("copy restored D1 snapshot into postgres: %w", err))
		}
	}

	result := manifest{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Source:      "isolated-d1-restore",
		Target:      "render-postgres",
	}
	for _, table := range tables {
		query := fmt.Sprintf("SELECT %s FROM %s ORDER BY %s", selectColumns(table), table.Name, table.PrimaryKey)
		targetRows, queryErr := target.Query(ctx, query)
		if queryErr != nil {
			fatal(fmt.Errorf("verify postgres table %s: %w", table.Name, queryErr))
		}
		sourceHash := rowsHash(table, sourceRows[table.Name])
		targetHash := rowsHash(table, targetRows)
		if len(sourceRows[table.Name]) != len(targetRows) || sourceHash != targetHash {
			fatal(fmt.Errorf("verification mismatch for %s", table.Name))
		}
		result.Tables = append(result.Tables, tableManifest{
			Table: table.Name, Rows: len(targetRows), SourceSHA256: sourceHash, TargetSHA256: targetHash,
		})
	}
	encoded, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		fatal(err)
	}
	fmt.Println(string(encoded))
}

func fields(value string) []string {
	return strings.Fields(value)
}

func selectColumns(table tableSpec) string {
	columns := make([]string, 0, len(table.Columns))
	for _, column := range table.Columns {
		if _, integer := integerColumns[column]; integer {
			columns = append(columns, fmt.Sprintf("CAST(%s AS TEXT) AS %s", column, column))
			continue
		}
		columns = append(columns, column)
	}
	return strings.Join(columns, ", ")
}

func rowsHash(table tableSpec, rows []map[string]any) string {
	hash := sha256.New()
	for _, row := range rows {
		for _, column := range table.Columns {
			value, _ := json.Marshal(normalizeHashValue(row[column]))
			_, _ = fmt.Fprintf(hash, "%d:%s=%d:", len(column), column, len(value))
			_, _ = hash.Write(value)
		}
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func normalizeDatabaseValue(column string, value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	if _, integer := integerColumns[column]; integer {
		encoded, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("expected decimal string, got %T", value)
		}
		parsed, err := strconv.ParseInt(encoded, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid int64 %q: %w", encoded, err)
		}
		return parsed, nil
	}
	return value, nil
}

func normalizeHashValue(value any) any {
	switch typed := value.(type) {
	case float64:
		if typed == float64(int64(typed)) {
			return int64(typed)
		}
	case []byte:
		return string(typed)
	}
	return value
}

func integer(value any) int64 {
	switch typed := value.(type) {
	case int64:
		return typed
	case int32:
		return int64(typed)
	case float64:
		return int64(typed)
	case string:
		var result int64
		_, _ = fmt.Sscan(typed, &result)
		return result
	default:
		return 0
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "core migration failed:", err)
	os.Exit(1)
}

func init() {
	for _, table := range tables {
		sorted := append([]string(nil), table.Columns...)
		sort.Strings(sorted)
		for index := 1; index < len(sorted); index++ {
			if sorted[index] == sorted[index-1] {
				panic("duplicate migration column: " + table.Name + "." + sorted[index])
			}
		}
	}
}
