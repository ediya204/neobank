package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUSDTMicroUnitConversionIsExactAndBounded(t *testing.T) {
	tests := map[string]int64{
		"0.000001":             1,
		"1":                    1_000_000,
		"1.23":                 1_230_000,
		"9223372036854.775807": 9_223_372_036_854_775_807,
	}
	for input, expected := range tests {
		actual, ok := parseUSDTMicroUnits(input)
		if !ok || actual != expected {
			t.Fatalf("parseUSDTMicroUnits(%q) = %d, %v; want %d, true", input, actual, ok, expected)
		}
		if formatted := formatUSDTMicroUnits(actual); formatted != input {
			t.Fatalf("formatUSDTMicroUnits(%d) = %q; want %q", actual, formatted, input)
		}
	}
	for _, input := range []string{
		"0", "0.000000", "1.0000001", "01", "-1", "1e6", "9223372036854.775808",
	} {
		if _, ok := parseUSDTMicroUnits(input); ok {
			t.Fatalf("unsafe micro-unit amount accepted: %q", input)
		}
	}
}

func TestOnlyUSDTTRC20AssetIdentifiers(t *testing.T) {
	if usdtTRC20ChainID != "195" {
		t.Fatalf("unexpected TRON chain id: %s", usdtTRC20ChainID)
	}
	if usdtTRC20TokenID != "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" {
		t.Fatalf("unexpected USDT-TRC20 token id: %s", usdtTRC20TokenID)
	}
	if usdtTRC20Currency != "195@TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" {
		t.Fatalf("unexpected USDT-TRC20 currency: %s", usdtTRC20Currency)
	}
	if cregisPayoutPath != "/api/v2/payout" {
		t.Fatalf("customer withdrawals must use the Cregis wallet payout API: %s", cregisPayoutPath)
	}
}

func TestCregisPayoutUsesProjectDefaultWallet(t *testing.T) {
	payload := cregisDefaultWalletPayout(map[string]any{
		"currency": "195@token", "net_amount_text": "0.1", "to_address": "destination",
		"from_address": "customer-deposit-sub-address", "third_party_id": "business-id",
	}, "https://api.example.com")
	if _, exists := payload["wallet_id"]; exists {
		t.Fatal("wallet_id must be omitted so Cregis uses the project default payout wallet")
	}
	if _, exists := payload["from_address"]; exists {
		t.Fatal("customer deposit sub-address must not be sent as the Cregis payout source")
	}
	if payload["to_address"] != "destination" {
		t.Fatalf("unexpected payout destination: %v", payload["to_address"])
	}
}

func TestSingleAdministratorWithdrawalStateTransitions(t *testing.T) {
	tests := []struct {
		name       string
		sql        string
		required   []string
		prohibited []string
	}{
		{
			name:       "approve preserves submitted state gate",
			sql:        approveWithdrawalSQL,
			required:   []string{"status='approved'", "status='submitted'", "checker_id=?"},
			prohibited: []string{"maker_id<>", "checker_id<>"},
		},
		{
			name:       "reject preserves submitted state gate",
			sql:        rejectWithdrawalSQL,
			required:   []string{"status='rejected'", "status='submitted'", "checker_id=?"},
			prohibited: []string{"maker_id<>", "checker_id<>"},
		},
		{
			name:       "execute requires an explicit approval",
			sql:        startWithdrawalExecutionSQL,
			required:   []string{"status='executing'", "status='approved'", "checker_id IS NOT NULL", "operator_id=?"},
			prohibited: []string{"maker_id<>", "checker_id<>"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			for _, required := range test.required {
				if !strings.Contains(test.sql, required) {
					t.Fatalf("SQL must contain %q: %s", required, test.sql)
				}
			}
			for _, prohibited := range test.prohibited {
				if strings.Contains(test.sql, prohibited) {
					t.Fatalf("SQL must allow one administrator; found %q: %s", prohibited, test.sql)
				}
			}
		})
	}
}

func TestAdminWithdrawalHistoryKeepsReservedSubmissionApprovable(t *testing.T) {
	for _, required := range []string{
		"WHEN a.status='reserved' AND x.status='submitted' THEN 'submitted'",
		"WHEN a.status='settled' THEN 'completed'",
		"ELSE 'processing'",
	} {
		if !strings.Contains(adminWithdrawalHistoryStatusSQL, required) {
			t.Fatalf("admin withdrawal history status SQL must contain %q: %s", required, adminWithdrawalHistoryStatusSQL)
		}
	}
}

func TestDepositWalletActivationRequiresCregisOwnershipEvidence(t *testing.T) {
	for _, required := range []string{
		"custody_provider='cregis'",
		"ownership_verified_at=?",
		"status='active'",
		"status='creating'",
	} {
		if !strings.Contains(activateVerifiedWalletSQL, required) {
			t.Fatalf("verified wallet activation SQL must contain %q: %s", required, activateVerifiedWalletSQL)
		}
	}
	if !strings.HasPrefix(strings.TrimSpace(activateVerifiedWalletSQL), "WITH activated AS") ||
		!strings.Contains(activateVerifiedWalletSQL, "SELECT id FROM activated") {
		t.Fatalf("verified wallet activation must return its PostgreSQL result through a query CTE: %s", activateVerifiedWalletSQL)
	}
	if strings.Contains(failWalletOwnershipVerificationSQL, "status='active'") ||
		strings.Contains(failWalletOwnershipVerificationSQL, "ownership_verified_at") {
		t.Fatalf("failed ownership verification must not enable deposits: %s", failWalletOwnershipVerificationSQL)
	}
}

func TestWalletOwnershipRepairAcceptsUnverifiedActiveReservation(t *testing.T) {
	if !strings.HasPrefix(strings.TrimSpace(resetWalletOwnershipVerificationSQL), "WITH reset AS") ||
		!strings.Contains(resetWalletOwnershipVerificationSQL, "SELECT id FROM reset") {
		t.Fatalf("wallet ownership retry must return its PostgreSQL result through a query CTE: %s", resetWalletOwnershipVerificationSQL)
	}
	tests := map[string]bool{
		"error":    true,
		"active":   true,
		"creating": false,
		"frozen":   false,
		"closed":   false,
	}
	for status, expected := range tests {
		if actual := walletReservationCanRetryOwnership(status); actual != expected {
			t.Fatalf("walletReservationCanRetryOwnership(%q) = %v; want %v", status, actual, expected)
		}
	}
}

func TestWithdrawalReservationRechecksFundsAndOnboardingInOneStatement(t *testing.T) {
	for _, required := range []string{
		"INSERT OR IGNORE INTO cregis_withdrawals",
		"amount_minor",
		"fee_amount_minor",
		"net_amount_minor",
		"fee_rule_version",
		"c.kyc_status='approved'",
		"c.operations_status='active'",
		"c.status='active'",
		`"Account"`,
		`"availableBalance"`,
		"SUM(x.amount_minor)",
		"a.status IN ('pending_reservation','reserving')",
	} {
		if !strings.Contains(reserveWithdrawalSQL, required) {
			t.Fatalf("atomic reservation SQL must contain %q", required)
		}
	}
}

func TestExceptionReconciliationKeepsFundsFrozenUntilSignedFinalCallback(t *testing.T) {
	for _, required := range []string{
		"status='submitted_to_cregis'",
		"cregis_cid=?",
		"reconciliation_note=?",
		"reconciled_by=?",
		"reconciled_at=?",
		"status='exception'",
		"cregis_cid IS NULL",
		"a.status='approved'",
		"a.core_operation_id IS NOT NULL",
		"a.core_transfer_id IS NOT NULL",
		`FROM "Operation" operation`,
		`FROM "CryptoTransfer" transfer`,
		"operation.metadata->>'custodyWithdrawalId'=cregis_withdrawals.id",
	} {
		if !strings.Contains(reconcileWithdrawalSubmittedSQL, required) {
			t.Fatalf("exception reconciliation SQL must contain %q", required)
		}
	}
	for _, forbidden := range []string{"pending_release", "status='failed'", "status='cancelled'"} {
		if strings.Contains(reconcileWithdrawalSubmittedSQL, forbidden) {
			t.Fatalf("ambiguous exception reconciliation must not contain %q", forbidden)
		}
	}
	if !strings.Contains(walletBalancesSQL, `core_account."frozenBalance"`) ||
		!strings.Contains(walletBalancesSQL, `core_wallet."frozenBalance"`) {
		t.Fatalf("wallet balances must expose the Core account and validate its compatibility mirror: %s", walletBalancesSQL)
	}
}

func TestExceptionReconciliationRejectsManualTerminalRelease(t *testing.T) {
	for _, resolution := range []string{"failed", "cancelled"} {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/crypto/withdrawals/withdrawal_test/reconcile",
			bytes.NewBufferString(`{"resolution":"`+resolution+`","note":"provider result is ambiguous"}`))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		app := &application{tenantID: "tenant_test"}
		app.reconcileCregisWithdrawal(response, request, "withdrawal_test")
		if response.Code != http.StatusUnprocessableEntity {
			t.Fatalf("resolution %q status=%d body=%q", resolution, response.Code, response.Body.String())
		}
	}
}

func TestUSDTFeeCanBeZeroButWithdrawalCannot(t *testing.T) {
	if amount, ok := parseUSDTMicroUnitsAllowZero("0"); !ok || amount != 0 {
		t.Fatalf("zero fee must be accepted exactly, got %d, %v", amount, ok)
	}
	if _, ok := parseUSDTMicroUnits("0"); ok {
		t.Fatal("zero withdrawal amount must remain invalid")
	}
}

func TestPayoutPersistenceCannotClaimAStaleSubmissionState(t *testing.T) {
	for _, required := range []string{"status='submitted_to_cregis'", "cregis_cid=?", "status='executing'"} {
		if !strings.Contains(persistWithdrawalSubmissionSQL, required) {
			t.Fatalf("payout persistence SQL must contain %q", required)
		}
	}
	for _, status := range []string{"submitted_to_cregis", "completed", "rejected", "failed"} {
		if !isCregisFinalOrSubmittedStatus(status) {
			t.Fatalf("callback-advanced status %q must be readable after an update race", status)
		}
	}
	for _, status := range []string{"executing", "exception", "approved", "cancelled", ""} {
		if isCregisFinalOrSubmittedStatus(status) {
			t.Fatalf("stale or unrelated status %q must not be reported as a successful submission", status)
		}
	}
}
