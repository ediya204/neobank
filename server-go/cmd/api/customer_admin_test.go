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
