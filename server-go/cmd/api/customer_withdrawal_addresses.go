package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
)

const (
	addWithdrawalAddressPurpose    = "add_withdrawal_address"
	revokeWithdrawalAddressPurpose = "revoke_withdrawal_address"
	customerStepUpDuration         = 5 * time.Minute
)

const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

var (
	isoCountryCodePattern = regexp.MustCompile(`^[A-Z]{2}$`)
	swiftBICPattern       = regexp.MustCompile(`^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$`)
	ibanPattern           = regexp.MustCompile(`^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$`)
)

func (app *application) createCustomerTOTPStepUp(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": map[string]string{"code": "csrf_or_session_invalid"}})
		return
	}
	var input struct {
		Purpose string `json:"purpose"`
		Code    string `json:"otp_code"`
	}
	if !decodeJSON(w, r, &input) ||
		(input.Purpose != addWithdrawalAddressPurpose && input.Purpose != revokeWithdrawalAddressPurpose) ||
		len(input.Code) != 6 {
		validationError(w)
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT totp_secret_ciphertext, totp_last_counter, credential_version
	  FROM customer_credentials WHERE customer_id=?`, session.CustomerID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 || text(rows[0]["totp_secret_ciphertext"]) == "" {
		conflict(w, "totp_not_enrolled")
		return
	}
	secret, err := app.decryptCustomerTOTP(text(rows[0]["totp_secret_ciphertext"]))
	if err != nil {
		databaseError(app, w, err)
		return
	}
	now := time.Now().UTC()
	counter, valid := verifyTOTPCode(secret, input.Code, now, integer(rows[0]["totp_last_counter"]))
	if !valid {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "invalid_totp_code"}})
		return
	}
	credentialVersion := integer(rows[0]["credential_version"])
	challengeID := randomID("stepup")
	token := randomToken(32)
	nowText := databaseTimestamp(now)
	expiresAt := databaseTimestamp(now.Add(customerStepUpDuration))
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_credentials SET totp_last_counter=?, updated_at=?
	  WHERE customer_id=? AND credential_version=? AND totp_last_counter<?`, Params: []any{
			counter, nowText, session.CustomerID, credentialVersion, counter,
		}},
		d1.Statement{SQL: `INSERT INTO customer_step_up_challenges
	  (id, customer_id, session_id, token_hash, purpose, credential_version, expires_at, created_at)
	  SELECT ?, ?, ?, ?, ?, ?, ?, ?
	  WHERE EXISTS (SELECT 1 FROM customer_credentials
	    WHERE customer_id=? AND credential_version=? AND totp_last_counter=?)`, Params: []any{
			challengeID, session.CustomerID, session.ID, tokenHash(token), input.Purpose,
			credentialVersion, expiresAt, nowText, session.CustomerID, credentialVersion, counter,
		}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
	  (id, customer_id, event_type, actor, metadata_json, created_at)
	  SELECT ?, ?, 'auth.totp_step_up_verified', ?, ?, ?
	  WHERE EXISTS (SELECT 1 FROM customer_step_up_challenges WHERE id=?)`, Params: []any{
			randomID("audit"), session.CustomerID, session.CustomerID,
			mustJSON(map[string]string{"purpose": input.Purpose, "session_id": session.ID}), nowText, challengeID,
		}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 3 || resultChanges(results[:1]) != 1 || resultChanges(results[1:2]) != 1 || resultChanges(results[2:]) != 1 {
		conflict(w, "step_up_state_changed")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"step_up_token": token,
		"purpose":       input.Purpose,
		"expires_at":    expiresAt,
	})
}

type customerFiatBeneficiaryInput struct {
	Name           string `json:"name"`
	Currency       string `json:"currency"`
	BankName       string `json:"bank_name"`
	AccountNumber  string `json:"account_number"`
	SwiftBIC       string `json:"swift_bic"`
	IBAN           string `json:"iban"`
	BankAddress    string `json:"bank_address"`
	CountryCode    string `json:"country_code"`
	StepUpToken    string `json:"step_up_token"`
	IdempotencyKey string `json:"idempotency_key"`
}

func normalizeFiatBeneficiaryInput(input customerFiatBeneficiaryInput) (customerFiatBeneficiaryInput, bool) {
	input.Name = strings.TrimSpace(input.Name)
	input.Currency = strings.ToUpper(strings.TrimSpace(input.Currency))
	input.BankName = strings.TrimSpace(input.BankName)
	input.AccountNumber = strings.TrimSpace(input.AccountNumber)
	input.SwiftBIC = strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(input.SwiftBIC), " ", ""))
	input.IBAN = strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(input.IBAN), " ", ""))
	input.BankAddress = strings.TrimSpace(input.BankAddress)
	input.CountryCode = strings.ToUpper(strings.TrimSpace(input.CountryCode))
	input.StepUpToken = strings.TrimSpace(input.StepUpToken)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	valid := len(input.Name) > 0 && len(input.Name) <= 160 &&
		(input.Currency == "USD" || input.Currency == "HKD") &&
		len(input.BankName) > 0 && len(input.BankName) <= 160 &&
		len(input.AccountNumber) >= 4 && len(input.AccountNumber) <= 80 &&
		len(input.BankAddress) <= 300 && isoCountryCodePattern.MatchString(input.CountryCode) &&
		(input.SwiftBIC == "" || swiftBICPattern.MatchString(input.SwiftBIC)) &&
		(input.IBAN == "" || ibanPattern.MatchString(input.IBAN)) &&
		safeIdentifier.MatchString(input.StepUpToken) && safeIdentifier.MatchString(input.IdempotencyKey)
	return input, valid
}

func fiatBeneficiaryID(customerID, idempotencyKey string) string {
	digest := sha256.Sum256([]byte(customerID + "\x00" + idempotencyKey))
	return "beneficiary_" + hex.EncodeToString(digest[:16])
}

func normalizedBankAccount(value string) string {
	var normalized strings.Builder
	for _, character := range strings.ToUpper(value) {
		if (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') {
			normalized.WriteRune(character)
		}
	}
	return normalized.String()
}

const customerFiatBeneficiaryFields = `id, "customerId" AS customer_id, type, name, currency,
  "bankName" AS bank_name, "accountNumber" AS account_number, "swiftBic" AS swift_bic,
  iban, "bankAddress" AS bank_address, "countryCode" AS country_code, active,
  "createdAt" AS created_at, "updatedAt" AS updated_at`

const updatedCustomerFiatBeneficiaryFields = `beneficiary.id,
  beneficiary."customerId" AS customer_id, beneficiary.type, beneficiary.name,
  beneficiary.currency, beneficiary."bankName" AS bank_name,
  beneficiary."accountNumber" AS account_number, beneficiary."swiftBic" AS swift_bic,
  beneficiary.iban, beneficiary."bankAddress" AS bank_address,
  beneficiary."countryCode" AS country_code, beneficiary.active,
  beneficiary."createdAt" AS created_at, beneficiary."updatedAt" AS updated_at`

func (app *application) listCustomerFiatBeneficiaries(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.loadCustomerSession(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT `+customerFiatBeneficiaryFields+`
	  FROM "Beneficiary" WHERE "customerId"=? AND type='BANK'
	  ORDER BY "createdAt" DESC`, session.CustomerID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}

func (app *application) createCustomerFiatBeneficiary(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": map[string]string{"code": "csrf_or_session_invalid"}})
		return
	}
	var raw customerFiatBeneficiaryInput
	if !decodeJSON(w, r, &raw) {
		return
	}
	input, valid := normalizeFiatBeneficiaryInput(raw)
	if !valid || normalizedBankAccount(input.AccountNumber) == "" {
		validationError(w)
		return
	}
	beneficiaryID := fiatBeneficiaryID(session.CustomerID, input.IdempotencyKey)
	existing, err := app.db.Query(r.Context(), `SELECT `+customerFiatBeneficiaryFields+`
	  FROM "Beneficiary" WHERE id=? AND "customerId"=? AND type='BANK'`, beneficiaryID, session.CustomerID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(existing) == 1 {
		row := existing[0]
		if text(row["name"]) != input.Name || text(row["currency"]) != input.Currency ||
			text(row["bank_name"]) != input.BankName || text(row["account_number"]) != input.AccountNumber ||
			text(row["swift_bic"]) != input.SwiftBIC || text(row["iban"]) != input.IBAN ||
			text(row["bank_address"]) != input.BankAddress || text(row["country_code"]) != input.CountryCode {
			conflict(w, "idempotency_payload_mismatch")
			return
		}
		writeJSON(w, http.StatusOK, row)
		return
	}
	if len(existing) != 0 {
		databaseError(app, w, errors.New("duplicate fiat beneficiary idempotency rows"))
		return
	}
	duplicates, err := app.db.Query(r.Context(), `SELECT id FROM "Beneficiary"
	  WHERE "customerId"=? AND type='BANK' AND active=TRUE AND currency=?::"Currency"
	    AND LOWER(TRIM("bankName"))=LOWER(?)
	    AND regexp_replace(UPPER("accountNumber"), '[^A-Z0-9]', '', 'g')=?`,
		session.CustomerID, input.Currency, input.BankName, normalizedBankAccount(input.AccountNumber))
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(duplicates) != 0 {
		conflict(w, "fiat_beneficiary_already_exists")
		return
	}

	nowText := databaseTimestamp(time.Now().UTC())
	tokenDigest := tokenHash(input.StepUpToken)
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `WITH consumed AS (
		  UPDATE customer_step_up_challenges SET used_at=?
		  WHERE customer_id=? AND session_id=? AND token_hash=? AND purpose=?
		    AND credential_version=? AND expires_at>? AND used_at IS NULL
		    AND EXISTS (SELECT 1 FROM "Customer" c
		      WHERE c.id=? AND c."organizationId"=?)
		    AND NOT EXISTS (SELECT 1 FROM "Beneficiary" b
		      WHERE b."customerId"=? AND b.type='BANK' AND b.active=TRUE
		        AND b.currency=?::"Currency" AND LOWER(TRIM(b."bankName"))=LOWER(?)
		        AND regexp_replace(UPPER(b."accountNumber"), '[^A-Z0-9]', '', 'g')=?)
		  RETURNING id
		), inserted AS (
		  INSERT INTO "Beneficiary"
		    (id, "customerId", type, name, currency, "bankName", "accountNumber", "swiftBic",
		     iban, "bankAddress", "countryCode", active, "createdAt", "updatedAt")
		  SELECT ?, ?, 'BANK'::"BeneficiaryType", ?, ?::"Currency", ?, ?, NULLIF(?, ''),
		    NULLIF(?, ''), NULLIF(?, ''), ?, TRUE, ?::timestamptz, ?::timestamptz
		  FROM consumed
		  RETURNING ` + customerFiatBeneficiaryFields + `
		), audited AS (
		  INSERT INTO customer_auth_audit_events
		    (id, customer_id, event_type, actor, metadata_json, created_at)
		  SELECT ?, ?, 'fiat_beneficiary.added', ?, ?, ? FROM inserted
		  RETURNING id
		)
		SELECT * FROM inserted WHERE EXISTS (SELECT 1 FROM audited)`, Params: []any{
			nowText, session.CustomerID, session.ID, tokenDigest, addWithdrawalAddressPurpose,
			session.CredentialVersion, nowText, session.CustomerID, app.coreOrganizationID,
			session.CustomerID, input.Currency, input.BankName, normalizedBankAccount(input.AccountNumber),
			beneficiaryID, session.CustomerID, input.Name, input.Currency, input.BankName,
			input.AccountNumber, input.SwiftBIC, input.IBAN, input.BankAddress, input.CountryCode,
			nowText, nowText,
			randomID("audit"), session.CustomerID, session.CustomerID,
			mustJSON(map[string]string{"beneficiary_id": beneficiaryID, "currency": input.Currency}),
			nowText,
		}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 1 || len(results[0].Results) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "step_up_required"}})
		return
	}
	writeJSON(w, http.StatusCreated, results[0].Results[0])
}

type revokeWithdrawalDestinationInput struct {
	StepUpToken string `json:"step_up_token"`
}

func withdrawalDestinationRouteID(path, prefix string) string {
	value := strings.TrimSuffix(strings.TrimPrefix(path, prefix), "/revoke")
	if strings.Contains(value, "/") || !safeIdentifier.MatchString(value) {
		return ""
	}
	return value
}

func (app *application) revokeCustomerFiatBeneficiary(w http.ResponseWriter, r *http.Request, beneficiaryID string) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": map[string]string{"code": "csrf_or_session_invalid"}})
		return
	}
	var input revokeWithdrawalDestinationInput
	if !decodeJSON(w, r, &input) || beneficiaryID == "" || !safeIdentifier.MatchString(input.StepUpToken) {
		validationError(w)
		return
	}
	nowText := databaseTimestamp(time.Now().UTC())
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `WITH consumed AS (
		  UPDATE customer_step_up_challenges SET used_at=?
		  WHERE customer_id=? AND session_id=? AND token_hash=? AND purpose=?
		    AND credential_version=? AND expires_at>? AND used_at IS NULL
		    AND EXISTS (SELECT 1 FROM "Beneficiary"
		      WHERE id=? AND "customerId"=? AND type='BANK' AND active=TRUE)
		  RETURNING id
		), updated AS (
		  UPDATE "Beneficiary" AS beneficiary SET active=FALSE, "updatedAt"=?::timestamptz
		  FROM consumed WHERE beneficiary.id=? AND beneficiary."customerId"=?
		    AND beneficiary.type='BANK' AND beneficiary.active=TRUE
		  RETURNING ` + updatedCustomerFiatBeneficiaryFields + `
		), audited AS (
		  INSERT INTO customer_auth_audit_events
		    (id, customer_id, event_type, actor, metadata_json, created_at)
		  SELECT ?, ?, 'fiat_beneficiary.revoked', ?, ?, ? FROM updated
		  RETURNING id
		)
		SELECT * FROM updated WHERE EXISTS (SELECT 1 FROM audited)`, Params: []any{
			nowText, session.CustomerID, session.ID, tokenHash(input.StepUpToken),
			revokeWithdrawalAddressPurpose, session.CredentialVersion, nowText,
			beneficiaryID, session.CustomerID, nowText, beneficiaryID, session.CustomerID,
			randomID("audit"), session.CustomerID, session.CustomerID,
			mustJSON(map[string]string{"beneficiary_id": beneficiaryID}), nowText,
		}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 1 || len(results[0].Results) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "step_up_required"}})
		return
	}
	writeJSON(w, http.StatusOK, results[0].Results[0])
}

func (app *application) revokeCustomerWithdrawalAddress(w http.ResponseWriter, r *http.Request, addressID string) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": map[string]string{"code": "csrf_or_session_invalid"}})
		return
	}
	var input revokeWithdrawalDestinationInput
	if !decodeJSON(w, r, &input) || addressID == "" || !safeIdentifier.MatchString(input.StepUpToken) {
		validationError(w)
		return
	}
	nowText := databaseTimestamp(time.Now().UTC())
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `WITH consumed AS (
		  UPDATE customer_step_up_challenges SET used_at=?
		  WHERE customer_id=? AND session_id=? AND token_hash=? AND purpose=?
		    AND credential_version=? AND expires_at>? AND used_at IS NULL
		    AND EXISTS (SELECT 1 FROM customer_withdrawal_addresses
		      WHERE id=? AND tenant_id=? AND customer_id=? AND status='active')
		  RETURNING id
		), updated AS (
		  UPDATE customer_withdrawal_addresses
		  SET status='revoked', revoked_at=?, updated_at=?
		  FROM consumed WHERE customer_withdrawal_addresses.id=?
		    AND customer_withdrawal_addresses.tenant_id=?
		    AND customer_withdrawal_addresses.customer_id=?
		    AND customer_withdrawal_addresses.status='active'
		  RETURNING customer_withdrawal_addresses.id, label, currency, network, address, status,
		    verified_at, revoked_at, created_at, updated_at
		), audited AS (
		  INSERT INTO customer_auth_audit_events
		    (id, customer_id, event_type, actor, metadata_json, created_at)
		  SELECT ?, ?, 'withdrawal_address.revoked', ?, ?, ? FROM updated
		  RETURNING id
		)
		SELECT * FROM updated WHERE EXISTS (SELECT 1 FROM audited)`, Params: []any{
			nowText, session.CustomerID, session.ID, tokenHash(input.StepUpToken),
			revokeWithdrawalAddressPurpose, session.CredentialVersion, nowText,
			addressID, app.tenantID, session.CustomerID, nowText, nowText,
			addressID, app.tenantID, session.CustomerID,
			randomID("audit"), session.CustomerID, session.CustomerID,
			mustJSON(map[string]string{"withdrawal_address_id": addressID, "network": "TRON"}),
			nowText,
		}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 1 || len(results[0].Results) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "step_up_required"}})
		return
	}
	writeJSON(w, http.StatusOK, results[0].Results[0])
}

func (app *application) listCustomerWithdrawalAddresses(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.loadCustomerSession(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT id, label, currency, network, address, status,
	  verified_at, revoked_at, created_at, updated_at
	  FROM customer_withdrawal_addresses
	  WHERE tenant_id=? AND customer_id=? ORDER BY created_at DESC`, app.tenantID, session.CustomerID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}

func (app *application) createCustomerWithdrawalAddress(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": map[string]string{"code": "csrf_or_session_invalid"}})
		return
	}
	var input struct {
		Label          string `json:"label"`
		Address        string `json:"address"`
		StepUpToken    string `json:"step_up_token"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Label = strings.TrimSpace(input.Label)
	input.Address = strings.TrimSpace(input.Address)
	if input.Label == "" || len(input.Label) > 100 || !validTronAddress(input.Address) ||
		!safeIdentifier.MatchString(input.StepUpToken) || !safeIdentifier.MatchString(input.IdempotencyKey) {
		validationError(w)
		return
	}
	addressDigest := sha256.Sum256([]byte(input.Address))
	addressSHA256 := hex.EncodeToString(addressDigest[:])
	existing, err := app.db.Query(r.Context(), `SELECT id, label, currency, network, address, status,
	  verified_at, revoked_at, created_at, updated_at
	  FROM customer_withdrawal_addresses
	  WHERE tenant_id=? AND customer_id=? AND idempotency_key=?`,
		app.tenantID, session.CustomerID, input.IdempotencyKey)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(existing) == 1 {
		if text(existing[0]["label"]) != input.Label || text(existing[0]["address"]) != input.Address {
			conflict(w, "idempotency_payload_mismatch")
			return
		}
		writeJSON(w, http.StatusOK, existing[0])
		return
	}
	if len(existing) != 0 {
		databaseError(app, w, errors.New("duplicate withdrawal address idempotency rows"))
		return
	}
	duplicates, err := app.db.Query(r.Context(), `SELECT id FROM customer_withdrawal_addresses
	  WHERE tenant_id=? AND customer_id=? AND network='TRON' AND address_sha256=? AND status='active'`,
		app.tenantID, session.CustomerID, addressSHA256)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(duplicates) != 0 {
		conflict(w, "withdrawal_address_already_exists")
		return
	}

	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	addressID := randomID("withdrawal_address")
	tokenDigest := tokenHash(input.StepUpToken)
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_step_up_challenges SET used_at=?
	  WHERE customer_id=? AND session_id=? AND token_hash=? AND purpose=?
	    AND credential_version=? AND expires_at>? AND used_at IS NULL`, Params: []any{
			nowText, session.CustomerID, session.ID, tokenDigest, addWithdrawalAddressPurpose,
			session.CredentialVersion, nowText,
		}},
		d1.Statement{SQL: `INSERT OR IGNORE INTO customer_withdrawal_addresses
	  (id, tenant_id, customer_id, idempotency_key, label, currency, network, address,
	   address_sha256, status, credential_version, verified_at, created_at, updated_at)
	  SELECT ?, ?, ?, ?, ?, ?, 'TRON', ?, ?, 'active', ?, ?, ?, ?
	  WHERE EXISTS (SELECT 1 FROM customer_step_up_challenges
	    WHERE customer_id=? AND session_id=? AND token_hash=? AND purpose=? AND used_at=?)`, Params: []any{
			addressID, app.tenantID, session.CustomerID, input.IdempotencyKey, input.Label,
			usdtTRC20Currency, input.Address, addressSHA256, session.CredentialVersion,
			nowText, nowText, nowText, session.CustomerID, session.ID, tokenDigest,
			addWithdrawalAddressPurpose, nowText,
		}},
		d1.Statement{SQL: `SELECT id, label, currency, network, address, status,
	  verified_at, revoked_at, created_at, updated_at
	  FROM customer_withdrawal_addresses
	  WHERE tenant_id=? AND customer_id=? AND idempotency_key=?`, Params: []any{
			app.tenantID, session.CustomerID, input.IdempotencyKey,
		}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
	  (id, customer_id, event_type, actor, metadata_json, created_at)
	  SELECT ?, ?, 'withdrawal_address.added', ?, ?, ?
	  WHERE EXISTS (SELECT 1 FROM customer_withdrawal_addresses WHERE id=?)`, Params: []any{
			randomID("audit"), session.CustomerID, session.CustomerID,
			mustJSON(map[string]string{"withdrawal_address_id": addressID, "network": "TRON"}), nowText, addressID,
		}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 4 || resultChanges(results[:1]) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "step_up_required"}})
		return
	}
	if resultChanges(results[1:2]) != 1 || len(results[2].Results) != 1 || resultChanges(results[3:]) != 1 {
		conflict(w, "withdrawal_address_state_changed")
		return
	}
	writeJSON(w, http.StatusCreated, results[2].Results[0])
}

func validTronAddress(value string) bool {
	if len(value) != 34 || value[0] != 'T' {
		return false
	}
	decoded := make([]byte, 0, 25)
	for _, character := range value {
		position := strings.IndexRune(base58Alphabet, character)
		if position < 0 {
			return false
		}
		carry := position
		for index := len(decoded) - 1; index >= 0; index-- {
			carry += int(decoded[index]) * 58
			decoded[index] = byte(carry & 0xff)
			carry >>= 8
		}
		for carry > 0 {
			decoded = append([]byte{byte(carry & 0xff)}, decoded...)
			carry >>= 8
		}
	}
	for _, character := range value {
		if character != '1' {
			break
		}
		decoded = append([]byte{0}, decoded...)
	}
	if len(decoded) != 25 || decoded[0] != 0x41 {
		return false
	}
	first := sha256.Sum256(decoded[:21])
	second := sha256.Sum256(first[:])
	return hmac.Equal(decoded[21:], second[:4])
}
