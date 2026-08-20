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
