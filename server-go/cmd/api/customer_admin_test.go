package main

import (
	"errors"
	"strings"
	"testing"
)

func TestAdminCustomerViewNeverSelectsCredentialMaterial(t *testing.T) {
	for _, prohibited := range []string{"password", "token", "totp", "credential", "recovery"} {
		if strings.Contains(strings.ToLower(adminCustomerFields), prohibited) {
			t.Fatalf("admin customer response must not include %q: %s", prohibited, adminCustomerFields)
		}
	}
	for _, required := range []string{
		"kyc_status", "operations_status", "kyc_reviewed_by", "activated_by", "wallet_count", "wallet_status",
	} {
		if !strings.Contains(adminCustomerFields, required) {
			t.Fatalf("admin customer response must include %q", required)
		}
	}
}

func TestKYCApprovalAutomaticallyActivatesCustomerBeforeWalletProvisioning(t *testing.T) {
	for _, required := range []string{
		"kyc_status='approved'",
		"operations_status='active'",
		"kyc_status='pending'",
		"operations_status='pending'",
		"password_hash IS NOT NULL",
		"THEN 'active'",
	} {
		if !strings.Contains(approveCustomerKYCAutomationSQL, required) {
			t.Fatalf("automatic KYC approval SQL must contain %q", required)
		}
	}
	if got := automaticWalletIdempotency("customer_123"); got != "auto-kyc-customer_123" {
		t.Fatalf("automatic wallet idempotency = %q", got)
	}
	if !safeIdentifier.MatchString(automaticWalletIdempotency("customer_123")) {
		t.Fatal("automatic wallet idempotency must satisfy the public wallet API contract")
	}
	if got := automaticWalletAlias("customer_123"); got != "customer_123" {
		t.Fatalf("automatic wallet alias = %q", got)
	}
}

func TestKYCApprovalReportsWalletRetryWithoutReversingApproval(t *testing.T) {
	metadata := walletProvisioningRetryMetadata(&walletProvisionError{
		status: 502,
		code:   "cregis_address_ownership_verification_failed",
		cause:  errors.New("internal cause"),
	})
	if metadata["status"] != "retry_required" {
		t.Fatalf("wallet provisioning status = %q", metadata["status"])
	}
	if metadata["error_code"] != "cregis_address_ownership_verification_failed" {
		t.Fatalf("wallet provisioning error code = %q", metadata["error_code"])
	}
	if _, exposed := metadata["cause"]; exposed {
		t.Fatal("wallet provisioning metadata must not expose the internal cause")
	}
}

func TestManualActivationRemainsARepairPath(t *testing.T) {
	for _, required := range []string{
		"kyc_status='approved'",
		"operations_status='pending'",
		"status IN ('pending_setup', 'active')",
		"password_hash IS NOT NULL",
		"THEN 'active'",
	} {
		if !strings.Contains(activateCustomerOperationsSQL, required) {
			t.Fatalf("operations activation SQL must contain %q", required)
		}
	}
	if !strings.Contains(issueCustomerSetupCredentialSQL, "status='pending_setup'") {
		t.Fatal("setup credentials may only be issued to pending_setup customers")
	}
}

func TestSumsubApprovalGate(t *testing.T) {
	tests := []struct {
		name        string
		account     string
		status      string
		level       string
		environment string
		configured  bool
		want        string
	}{
		{name: "legacy individual remains reviewable", account: "individual"},
		{name: "business remains manual", account: "business", status: "provider_reviewing"},
		{name: "ready", account: "individual", status: "ready_for_admin_review", level: "neobank_individual_v1", environment: "sandbox", configured: true},
		{name: "steps incomplete", account: "individual", status: "provider_reviewing", level: "neobank_individual_v1", environment: "sandbox", configured: true, want: "sumsub_verification_not_ready"},
		{name: "wrong level", account: "individual", status: "ready_for_admin_review", level: "other", environment: "sandbox", configured: true, want: "sumsub_configuration_mismatch"},
		{name: "provider disabled", account: "individual", status: "ready_for_admin_review", level: "neobank_individual_v1", environment: "sandbox", want: "sumsub_configuration_mismatch"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := sumsubApprovalBlockCode(test.account, test.status, test.level, test.environment,
				"neobank_individual_v1", "sandbox", test.configured)
			if got != test.want {
				t.Fatalf("block code = %q, want %q", got, test.want)
			}
		})
	}
}
