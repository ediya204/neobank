package main

import (
	"strings"
	"testing"
)

func TestAdminCustomerViewNeverSelectsCredentialMaterial(t *testing.T) {
	for _, prohibited := range []string{"password", "token", "totp", "credential", "recovery"} {
		if strings.Contains(strings.ToLower(adminCustomerFields), prohibited) {
			t.Fatalf("admin customer response must not include %q: %s", prohibited, adminCustomerFields)
		}
	}
	for _, required := range []string{"kyc_status", "operations_status", "kyc_reviewed_by", "activated_by"} {
		if !strings.Contains(adminCustomerFields, required) {
			t.Fatalf("admin customer response must include %q", required)
		}
	}
}

func TestKYCAndOperationsActivationAreIndependentStateGates(t *testing.T) {
	for _, required := range []string{"kyc_status='pending'", "operations_status='pending'"} {
		if !strings.Contains(reviewCustomerKYCSQL, required) {
			t.Fatalf("KYC review SQL must contain %q", required)
		}
	}
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
