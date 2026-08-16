package coremigrate

import (
	"context"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/ediya204/neobank/server-go/internal/d1"
)

type schemaTestDatabase struct {
	versions map[string]bool
	counts   map[string]int64
	batch    []d1.Statement
}

func (database *schemaTestDatabase) Query(_ context.Context, sql string, params ...any) ([]map[string]any, error) {
	if strings.Contains(sql, "neobank_schema_migrations") {
		version := params[0].(string)
		if database.versions[version] {
			return []map[string]any{{"version": version}}, nil
		}
		return nil, nil
	}
	for table, count := range database.counts {
		if strings.Contains(sql, "FROM "+table) {
			return []map[string]any{{"count": count}}, nil
		}
	}
	return nil, nil
}

func (database *schemaTestDatabase) Batch(_ context.Context, statements ...d1.Statement) ([]d1.Result, error) {
	database.batch = append(database.batch, statements...)
	database.versions[customerApplicationsMigration] = true
	results := make([]d1.Result, len(statements))
	return results, nil
}

func TestMigrationIncludesCustomerApplications(t *testing.T) {
	var applicationTable *tableSpec
	for index := range tables {
		if tables[index].Name == "customer_applications" {
			applicationTable = &tables[index]
			break
		}
	}
	if applicationTable == nil {
		t.Fatal("customer_applications must be copied during the whole-core migration")
	}
	wantColumns := fields(`
		id tenant_id customer_id application_reference idempotency_key request_fingerprint account_type
		phone_country_code phone residence_country full_name date_of_birth nationality legal_name
		registration_number incorporation_country contact_name contact_role beneficial_owner_name
		beneficial_owner_ownership kyc_consent_at terms_accepted_at submitted_at updated_at`)
	if !reflect.DeepEqual(applicationTable.Columns, wantColumns) {
		t.Fatalf("unexpected customer_applications columns: %#v", applicationTable.Columns)
	}
}

func TestEnsureTargetSchemaAppliesCustomerApplicationsOnlyToEmptyTarget(t *testing.T) {
	database := &schemaTestDatabase{versions: map[string]bool{}, counts: map[string]int64{}}
	for _, table := range tables {
		if table.Name != "customer_applications" {
			database.counts[table.Name] = 0
		}
	}
	if err := ensureTargetSchema(context.Background(), database); err != nil {
		t.Fatal(err)
	}
	if len(database.batch) != 3 {
		t.Fatalf("expected one atomic three-statement migration, got %d statements", len(database.batch))
	}
	if !strings.Contains(database.batch[0].SQL, "CREATE TABLE IF NOT EXISTS customer_applications") {
		t.Fatalf("unexpected migration statement: %s", database.batch[0].SQL)
	}

	nonempty := &schemaTestDatabase{versions: map[string]bool{}, counts: map[string]int64{}}
	for _, table := range tables {
		if table.Name != "customer_applications" {
			nonempty.counts[table.Name] = 0
		}
	}
	nonempty.counts["customers"] = 1
	if err := ensureTargetSchema(context.Background(), nonempty); err == nil {
		t.Fatal("nonempty target must fail closed before schema reconciliation")
	}
}

func TestSelectColumnsCastsIntegersToText(t *testing.T) {
	table := tableSpec{Name: "example", Columns: []string{"id", "amount_minor", "credential_version"}}
	query := selectColumns(table)
	for _, expected := range []string{
		"id",
		"CAST(amount_minor AS TEXT) AS amount_minor",
		"CAST(credential_version AS TEXT) AS credential_version",
	} {
		if !strings.Contains(query, expected) {
			t.Fatalf("expected %q in %q", expected, query)
		}
	}
}

func TestNormalizeDatabaseValuePreservesInt64Precision(t *testing.T) {
	value, err := normalizeDatabaseValue("amount_minor", "9223372036854775807")
	if err != nil {
		t.Fatal(err)
	}
	if value != int64(math.MaxInt64) {
		t.Fatalf("unexpected value: %#v", value)
	}
	if _, err := normalizeDatabaseValue("amount_minor", float64(9_007_199_254_740_992)); err == nil {
		t.Fatal("floating-point source integers must fail closed")
	}
}
