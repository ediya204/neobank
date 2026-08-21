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
		"0009_deposit_source_address.sql",
		"0010_cregis_deposit_accounting.sql",
		"0011_cregis_withdrawal_accounting.sql",
		"0012_customer_password_recovery.sql",
		"0013_customer_security_center.sql",
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

func TestCustomerSecurityCenterMigrationStoresNoRawAuthenticationSecrets(t *testing.T) {
	path := filepath.Join("..", "..", "..", "migrations-postgres", "0013_customer_security_center.sql")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sql := string(content)
	for _, required := range []string{
		"ADD COLUMN IF NOT EXISTS withdrawals_locked BOOLEAN NOT NULL DEFAULT FALSE",
		"ADD COLUMN IF NOT EXISTS webauthn_user_handle TEXT",
		"CREATE TABLE IF NOT EXISTS customer_passkeys",
		"credential_ciphertext TEXT NOT NULL",
		"CREATE TABLE IF NOT EXISTS customer_webauthn_challenges",
		"CREATE TABLE IF NOT EXISTS customer_email_change_requests",
		"CREATE TABLE IF NOT EXISTS customer_account_closure_requests",
		"CUSTOMER_EMAIL_CHANGE_VERIFICATION",
		"CUSTOMER_SECURITY_ALERT",
		"VALUES ('0013_customer_security_center')",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("customer security migration must contain %q", required)
		}
	}
	for _, forbidden := range []string{"raw_ip", "session_token", "totp_secret", "recovery_code TEXT"} {
		if strings.Contains(strings.ToLower(sql), strings.ToLower(forbidden)) {
			t.Fatalf("customer security migration must not store %q", forbidden)
		}
	}
}

func TestCustomerPasswordRecoveryMigrationUsesPostgresOutboxAndOneTimeRequests(t *testing.T) {
	path := filepath.Join("..", "..", "..", "migrations-postgres", "0012_customer_password_recovery.sql")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sql := string(content)
	for _, required := range []string{
		"ADD COLUMN IF NOT EXISTS email_verified_at TEXT",
		"CREATE TABLE IF NOT EXISTS customer_email_verification_requests",
		"CREATE TABLE IF NOT EXISTS customer_password_reset_requests",
		"consumed_at TEXT",
		"cancelled_at TEXT",
		"attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8)",
		"CUSTOMER_PASSWORD_RESET_REQUESTED",
		"VALUES ('0012_customer_password_recovery')",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("password recovery migration must contain %q", required)
		}
	}
	if strings.Contains(strings.ToLower(sql), "password_hash text") {
		t.Fatal("password recovery requests must not store password material")
	}
}

func TestDepositSourceAddressMigrationRecordsVersion(t *testing.T) {
	path := filepath.Join("..", "..", "..", "migrations-postgres", "0009_deposit_source_address.sql")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sql := string(content)
	for _, required := range []string{
		"ADD COLUMN IF NOT EXISTS from_address TEXT",
		"VALUES ('0009_deposit_source_address')",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("deposit source-address migration must contain %q", required)
		}
	}
}

func TestDepositAccountingMigrationDoesNotBackfillMoney(t *testing.T) {
	path := filepath.Join("..", "..", "..", "migrations-postgres", "0010_cregis_deposit_accounting.sql")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sql := string(content)
	for _, required := range []string{
		"CREATE TABLE IF NOT EXISTS cregis_deposit_accounting",
		"status IN ('held', 'pending', 'processing', 'posted', 'exception')",
		"FOREIGN KEY (tenant_id, deposit_id)",
		"FOREIGN KEY (tenant_id, customer_id)",
		`FOREIGN KEY (core_operation_id) REFERENCES "Operation"(id)`,
		"backup_sha256 ~ '^[0-9a-f]{64}$'",
		"uq_cregis_deposits_tenant_completed_txid",
		"VALUES ('0010_cregis_deposit_accounting')",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("deposit accounting migration must contain %q", required)
		}
	}
	if strings.Contains(sql, "INSERT INTO cregis_deposit_accounting") {
		t.Fatal("schema migration must not enqueue historical deposits")
	}
}

func TestWithdrawalAccountingMigrationDoesNotReserveHistoricalMoney(t *testing.T) {
	path := filepath.Join("..", "..", "..", "migrations-postgres", "0011_cregis_withdrawal_accounting.sql")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sql := string(content)
	for _, required := range []string{
		"CREATE TABLE IF NOT EXISTS cregis_withdrawal_accounting",
		"'pending_reservation', 'reserving', 'reserved'",
		"'pending_settlement', 'settling', 'settled'",
		"FOREIGN KEY (tenant_id, withdrawal_id)",
		`FOREIGN KEY (core_operation_id) REFERENCES "Operation"(id)`,
		`FOREIGN KEY (core_transfer_id) REFERENCES "CryptoTransfer"(id)`,
		"backup_sha256 ~ '^[0-9a-f]{64}$'",
		"uq_cregis_withdrawals_tenant_completed_txid",
		"VALUES ('0011_cregis_withdrawal_accounting')",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("withdrawal accounting migration must contain %q", required)
		}
	}
	if strings.Contains(sql, "INSERT INTO cregis_withdrawal_accounting") {
		t.Fatal("schema migration must not enqueue historical withdrawals")
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
