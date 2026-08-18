package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
)

const (
	addWithdrawalAddressPurpose = "add_withdrawal_address"
	customerStepUpDuration      = 5 * time.Minute
)

const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

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
	if !decodeJSON(w, r, &input) || input.Purpose != addWithdrawalAddressPurpose || len(input.Code) != 6 {
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
