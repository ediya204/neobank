package main

import "testing"

func TestReviewedMigrationFilename(t *testing.T) {
	for _, name := range []string{
		"0004_admin_auth.sql",
		"0005_customer_withdrawal_address_whitelist.sql",
		"0006_withdrawal_fee_rules.sql",
	} {
		if !migrationFilename.MatchString(name) {
			t.Fatalf("reviewed migration filename rejected: %s", name)
		}
	}
	for _, name := range []string{"migration.sql", "0005_bad-name.sql", "0005_valid.sql.bak"} {
		if migrationFilename.MatchString(name) {
			t.Fatalf("unsafe migration filename accepted: %s", name)
		}
	}
}
