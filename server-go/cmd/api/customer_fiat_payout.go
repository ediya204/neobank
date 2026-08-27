package main

import (
	"math/big"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/coreaccounting"
	"github.com/ediya204/neobank/server-go/internal/d1"
)

var customerFiatPayoutMoney = regexp.MustCompile(`^[0-9]{1,18}(?:\.[0-9]{1,8})?$`)
var customerFiatPayoutVersion = regexp.MustCompile(`^[0-9]{1,20}$`)
var customerFiatPayoutTOTP = regexp.MustCompile(`^[0-9]{6}$`)

type customerFiatPayoutInput struct {
	CurrentPassword        string `json:"current_password"`
	TOTPCode               string `json:"totp_code"`
	Currency               string `json:"currency"`
	Amount                 string `json:"amount"`
	SourceAccountID        string `json:"source_account_id"`
	BeneficiaryID          string `json:"beneficiary_id"`
	ChannelID              string `json:"channel_id"`
	PayoutMethod           string `json:"payout_method"`
	ExpectedFeeAmount      string `json:"expected_fee_amount"`
	ExpectedFeeRuleVersion string `json:"expected_fee_rule_version"`
	IdempotencyKey         string `json:"idempotency_key"`
	Narrative              string `json:"narrative"`
}

func normalizeCustomerFiatPayoutInput(input customerFiatPayoutInput) (customerFiatPayoutInput, bool) {
	input.TOTPCode = strings.TrimSpace(input.TOTPCode)
	input.Currency = strings.ToUpper(strings.TrimSpace(input.Currency))
	input.Amount = strings.TrimSpace(input.Amount)
	input.SourceAccountID = strings.TrimSpace(input.SourceAccountID)
	input.BeneficiaryID = strings.TrimSpace(input.BeneficiaryID)
	input.ChannelID = strings.TrimSpace(input.ChannelID)
	input.PayoutMethod = strings.ToUpper(strings.TrimSpace(input.PayoutMethod))
	input.ExpectedFeeAmount = strings.TrimSpace(input.ExpectedFeeAmount)
	input.ExpectedFeeRuleVersion = strings.TrimSpace(input.ExpectedFeeRuleVersion)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.Narrative = strings.TrimSpace(input.Narrative)
	amount, amountOK := new(big.Rat).SetString(input.Amount)
	fee, feeOK := new(big.Rat).SetString(input.ExpectedFeeAmount)
	methodOK := input.PayoutMethod == "PLATFORM" || input.PayoutMethod == "POBO" || input.PayoutMethod == "VA"
	ok := len(input.CurrentPassword) >= 1 && len(input.CurrentPassword) <= 128 &&
		customerFiatPayoutTOTP.MatchString(input.TOTPCode) &&
		(input.Currency == "USD" || input.Currency == "HKD") &&
		customerFiatPayoutMoney.MatchString(input.Amount) && amountOK && amount.Sign() > 0 &&
		customerFiatPayoutMoney.MatchString(input.ExpectedFeeAmount) && feeOK && fee.Sign() >= 0 &&
		methodOK && safeIdentifier.MatchString(input.SourceAccountID) &&
		safeIdentifier.MatchString(input.BeneficiaryID) && safeIdentifier.MatchString(input.ChannelID) &&
		customerFiatPayoutVersion.MatchString(input.ExpectedFeeRuleVersion) &&
		safeIdentifier.MatchString(input.IdempotencyKey) && len(input.Narrative) <= 500
	return input, ok
}

func (app *application) createCustomerFiatPayout(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": map[string]string{"code": "csrf_or_session_invalid"}})
		return
	}
	var raw customerFiatPayoutInput
	if !decodeJSON(w, r, &raw) {
		return
	}
	input, ok := normalizeCustomerFiatPayoutInput(raw)
	if !ok {
		validationError(w)
		return
	}
	lockRows, err := app.db.Query(r.Context(), `SELECT withdrawals_locked FROM customers
	  WHERE id=? AND tenant_id=? AND status='active' AND kyc_status='approved' AND operations_status='active'`,
		session.CustomerID, app.tenantID)
	if err != nil || len(lockRows) != 1 {
		databaseError(app, w, err)
		return
	}
	if strings.EqualFold(text(lockRows[0]["withdrawals_locked"]), "true") {
		writeJSON(w, http.StatusLocked, map[string]any{"error": map[string]string{"code": "withdrawals_locked"}})
		return
	}
	stepUp, code := app.verifyCustomerSecurityStepUp(r, session, input.CurrentPassword, input.TOTPCode)
	if code != "" {
		writeCustomerSecurityError(w, code)
		return
	}
	nowText := databaseTimestamp(time.Now().UTC())
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_credentials SET totp_last_counter=?, updated_at=?
		  WHERE customer_id=? AND credential_version=? AND totp_last_counter<?`, Params: []any{
			stepUp.TOTPCounter, nowText, session.CustomerID, stepUp.CredentialVersion, stepUp.TOTPCounter,
		}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  SELECT ?, ?, 'financial.fiat_payout_authorized', ?, ?, ?
		  WHERE EXISTS (SELECT 1 FROM customer_credentials
		    WHERE customer_id=? AND credential_version=? AND totp_last_counter=?)`, Params: []any{
			randomID("audit"), session.CustomerID, session.CustomerID,
			mustJSON(map[string]string{"idempotency_key": input.IdempotencyKey}), nowText,
			session.CustomerID, stepUp.CredentialVersion, stepUp.TOTPCounter,
		}},
	)
	if err != nil || len(results) != 2 || resultChanges(results[:1]) != 1 || resultChanges(results[1:]) != 1 {
		writeCustomerSecurityError(w, "step_up_state_changed")
		return
	}
	created, err := app.coreAccounting.CreateCustomerPayout(r.Context(), coreaccounting.CustomerPayoutRequest{
		CustomerID: session.CustomerID, CustomerEmail: session.Email, Currency: input.Currency,
		Amount: input.Amount, SourceAccountID: input.SourceAccountID, BeneficiaryID: input.BeneficiaryID,
		ChannelID: input.ChannelID, PayoutMethod: input.PayoutMethod,
		ExpectedFeeAmount: input.ExpectedFeeAmount, ExpectedFeeRuleVersion: input.ExpectedFeeRuleVersion,
		IdempotencyKey: input.IdempotencyKey, Narrative: input.Narrative,
	})
	if err != nil {
		app.logger.Error("customer fiat payout submission failed", "customer_id", session.CustomerID, "error", err)
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": map[string]string{"code": "payout_submission_failed"}})
		return
	}
	writeJSON(w, http.StatusCreated, created)
}
