package coremigrate

import (
	"math"
	"reflect"
	"strings"
	"testing"
)

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
