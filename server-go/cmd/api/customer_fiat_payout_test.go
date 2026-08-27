package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ediya204/neobank/server-go/internal/coreaccounting"
	"github.com/ediya204/neobank/server-go/internal/d1"
)

type customerPayoutDatabase struct {
	queries []map[string]any
	batches [][]d1.Statement
}

func (db *customerPayoutDatabase) Query(context.Context, string, ...any) ([]map[string]any, error) {
	if len(db.queries) == 0 {
		return nil, nil
	}
	row := db.queries[0]
	db.queries = db.queries[1:]
	return []map[string]any{row}, nil
}

func (db *customerPayoutDatabase) Batch(_ context.Context, statements ...d1.Statement) ([]d1.Result, error) {
	db.batches = append(db.batches, statements)
	results := make([]d1.Result, len(statements))
	for index := range results {
		results[index] = d1.Result{Meta: map[string]any{"changes": float64(1)}}
	}
	return results, nil
}

type customerPayoutCore struct {
	input coreaccounting.CustomerPayoutRequest
}

func (core *customerPayoutCore) PostDeposit(context.Context, string) (coreaccounting.Result, error) {
	return coreaccounting.Result{}, nil
}

func (core *customerPayoutCore) AdvanceWithdrawal(context.Context, string, string) (coreaccounting.Result, error) {
	return coreaccounting.Result{}, nil
}

func (core *customerPayoutCore) CreateCustomerPayout(_ context.Context, input coreaccounting.CustomerPayoutRequest) (coreaccounting.CustomerPayoutResult, error) {
	core.input = input
	return coreaccounting.CustomerPayoutResult{
		ID: "operation_test", Reference: "OP-TEST", Status: "SUBMITTED",
		Currency: input.Currency, Amount: input.Amount, FeeAmount: "20",
	}, nil
}

func TestCustomerFiatPayoutRequiresSecurityStepUpAndUsesSessionCustomer(t *testing.T) {
	now := time.Now().UTC()
	password := "Customer-Secure-Password-8!"
	secret := "JBSWY3DPEHPK3PXP"
	sessionToken := strings.Repeat("s", 40)
	csrfToken := strings.Repeat("c", 40)
	salt := []byte("0123456789abcdef")
	app := &application{
		tenantID: "tenant_test", coreOrganizationID: "org_test", portalURL: "https://portal.example.test",
		customerPasswordPepper: []byte(strings.Repeat("p", 32)),
		customerTOTPKey:        []byte("0123456789abcdef0123456789abcdef"),
	}
	encryptedTOTP, err := app.encryptCustomerTOTP(secret)
	if err != nil {
		t.Fatal(err)
	}
	passwordHash := app.deriveCustomerArgon2id(password, salt)
	db := &customerPayoutDatabase{queries: []map[string]any{
		{
			"id": "session_test", "customer_id": "customer_test", "csrf_hash": tokenHash(csrfToken),
			"credential_version": int64(1), "current_credential_version": int64(1),
			"expires_at":      now.Add(time.Hour).Format(time.RFC3339Nano),
			"idle_expires_at": now.Add(time.Hour).Format(time.RFC3339Nano),
			"last_seen_at":    now.Format(time.RFC3339Nano), "email": "customer@example.com",
			"display_name": "Customer", "status": "active", "totp_enabled": true,
		},
		{"withdrawals_locked": false},
		{
			"password_salt": hex.EncodeToString(salt), "password_hash": hex.EncodeToString(passwordHash),
			"password_algorithm": customerPasswordAlgorithm, "password_memory_kib": int64(customerArgonMemoryKiB),
			"password_time_cost": int64(customerArgonTimeCost), "password_parallelism": int64(customerArgonParallelism),
			"totp_secret_ciphertext": encryptedTOTP, "totp_last_counter": int64(-1), "credential_version": int64(1),
		},
	}}
	core := &customerPayoutCore{}
	app.db = db
	app.coreAccounting = core
	payload, _ := json.Marshal(map[string]string{
		"current_password": password, "totp_code": totpCodeForTest(t, secret, now),
		"currency": "USD", "amount": "100", "source_account_id": "account_test",
		"beneficiary_id": "beneficiary_test", "channel_id": "channel_test",
		"payout_method": "PLATFORM", "expected_fee_amount": "20",
		"expected_fee_rule_version": "7", "idempotency_key": "request_test",
	})
	request := httptest.NewRequest(http.MethodPost, "https://api.example.test/api/v1/customer/fiat-payouts", bytes.NewReader(payload))
	request.Header.Set("Origin", app.portalURL)
	request.Header.Set("X-CSRF-Token", csrfToken)
	request.AddCookie(&http.Cookie{Name: app.customerCookieName(), Value: sessionToken})
	request.AddCookie(&http.Cookie{Name: app.customerCSRFCookieName(), Value: csrfToken})
	response := httptest.NewRecorder()

	app.createCustomerFiatPayout(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if core.input.CustomerID != "customer_test" || core.input.CustomerEmail != "customer@example.com" || core.input.Amount != "100" {
		t.Fatalf("Core payout identity was not derived from the session: %#v", core.input)
	}
	if len(db.batches) != 1 || len(db.batches[0]) != 2 || !strings.Contains(db.batches[0][0].SQL, "totp_last_counter<?") {
		t.Fatalf("security step-up was not consumed atomically: %#v", db.batches)
	}
}

func TestNormalizeCustomerFiatPayoutRejectsUnsupportedRail(t *testing.T) {
	input := customerFiatPayoutInput{
		Currency: "EUR", Amount: "100", SourceAccountID: "account_test",
		BeneficiaryID: "beneficiary_test", ChannelID: "channel_test", PayoutMethod: "PLATFORM",
		ExpectedFeeAmount: "20", ExpectedFeeRuleVersion: "7", IdempotencyKey: "request_test",
		CurrentPassword: "password", TOTPCode: "123456",
	}
	if _, ok := normalizeCustomerFiatPayoutInput(input); ok {
		t.Fatal("unsupported customer fiat payout currency accepted")
	}
}
