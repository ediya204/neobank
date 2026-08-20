package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReviewedMigrationFilename(t *testing.T) {
	for _, name := range []string{
		"0004_admin_auth.sql",
		"0005_customer_withdrawal_address_whitelist.sql",
		"0006_withdrawal_fee_rules.sql",
		"0007_admin_rbac.sql",
		"0008_sumsub_individual_kyc.sql",
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

func TestSumsubMigrationPreservesManualApprovalGate(t *testing.T) {
	path := filepath.Join("..", "..", "..", "migrations-postgres", "0008_sumsub_individual_kyc.sql")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sql := string(content)
	for _, required := range []string{
		"ready_for_admin_review",
		"PROOF_OF_RESIDENCE",
		"sumsub_webhook_events",
		"sumsub_sync_jobs",
		"customer_onboarding_sessions",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("Sumsub migration must contain %q", required)
		}
	}
	if strings.Contains(sql, "UPDATE customers SET kyc_status='approved'") {
		t.Fatal("Sumsub migration must not approve a customer account")
	}
}

func TestAdminRBACMigrationScopesCoreIdentityToNeobankOrganization(t *testing.T) {
	path := filepath.Join("..", "..", "..", "migrations-postgres", "0007_admin_rbac.sql")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sql := string(content)
	for _, required := range []string{
		`core_user."organizationId" <> neobank_organization_id`,
		`JOIN "Organization" organization ON organization.id = core_user."organizationId"`,
		`every administrator must be linked to a Neobank Core administrator`,
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("admin RBAC migration must contain tenant guard %q", required)
		}
	}
}
