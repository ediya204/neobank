package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/pbkdf2"
	cryptorand "crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
)

const (
	customerPasswordIterations = 210_000
	customerSessionDuration    = 12 * time.Hour
	customerSetupDuration      = 30 * time.Minute
	customerChallengeDuration  = 5 * time.Minute
	customerEnrollmentDuration = 10 * time.Minute
	customerLockDuration       = 15 * time.Minute
	customerSessionCookie      = "__Host-neobank_customer"
	customerCSRFCookie         = "__Host-neobank_csrf"
	recoveryCustomerSessionSQL = `INSERT INTO customer_sessions
    (id, customer_id, token_hash, csrf_hash, credential_version, expires_at, created_at, last_seen_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM customer_recovery_codes WHERE id=? AND customer_id=? AND used_at=?)`
)

var customerPasswordPattern = regexp.MustCompile(`^[\x20-\x7e]{14,128}$`)

type customerSession struct {
	ID                string
	CustomerID        string
	Email             string
	DisplayName       string
	Status            string
	CSRFHash          string
	CredentialVersion int64
	ExpiresAt         time.Time
}

func (app *application) routeCustomerAuth(w http.ResponseWriter, r *http.Request) bool {
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/api/auth/customer/login":
		app.customerLogin(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/auth/customer/setup/complete":
		app.completeCustomerSetup(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/auth/customer/totp/setup":
		app.customerTOTPSetup(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/auth/customer/totp/verify":
		app.verifyCustomerTOTP(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/api/auth/me":
		app.customerSessionInfo(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/auth/logout":
		app.customerLogout(w, r)
	default:
		return false
	}
	return true
}

func (app *application) routeCustomerAPI(w http.ResponseWriter, r *http.Request) bool {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/admin/customers":
		app.listAdminCustomers(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/admin/customers":
		app.createCustomer(w, r)
	case r.Method == http.MethodPatch && strings.HasPrefix(r.URL.Path, "/api/v1/admin/customers/") && strings.HasSuffix(r.URL.Path, "/kyc"):
		app.reviewCustomerKYC(w, r, adminCustomerRouteID(r.URL.Path, "/kyc"))
	case r.Method == http.MethodPatch && strings.HasPrefix(r.URL.Path, "/api/v1/admin/customers/") && strings.HasSuffix(r.URL.Path, "/activate"):
		app.activateCustomerOperations(w, r, adminCustomerRouteID(r.URL.Path, "/activate"))
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/customer/profile":
		app.getCustomerProfile(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/customer/wallets":
		app.listCustomerWallets(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/customer/history":
		app.listCustomerHistory(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/customer/withdrawals":
		app.createCustomerWithdrawal(w, r)
	default:
		return false
	}
	return true
}

func (app *application) createCustomer(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email       string `json:"email"`
		DisplayName string `json:"display_name"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	email := normalizeCustomerEmail(input.Email)
	displayName := strings.TrimSpace(input.DisplayName)
	if email == "" || displayName == "" || len(displayName) > 100 {
		validationError(w)
		return
	}
	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	customerID := randomID("customer")
	existing, err := app.db.Query(r.Context(), `SELECT id FROM customers WHERE tenant_id=? AND email=?`, app.tenantID, email)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(existing) != 0 {
		conflict(w, "customer_already_exists")
		return
	}
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `INSERT OR IGNORE INTO customers
	      (id, tenant_id, email, display_name, status, kyc_status, operations_status, created_by, created_at, updated_at)
	      VALUES (?, ?, ?, ?, 'pending_setup', 'pending', 'pending', ?, ?, ?)`, Params: []any{customerID, app.tenantID, email, displayName, edgeUser(r), nowText, nowText}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
	      (id, customer_id, event_type, actor, metadata_json, created_at)
	      SELECT ?, ?, 'customer.created', ?, '{}', ?
	      WHERE EXISTS (SELECT 1 FROM customers WHERE id=? AND tenant_id=? AND kyc_status='pending' AND operations_status='pending')`, Params: []any{randomID("audit"), customerID, edgeUser(r), nowText, customerID, app.tenantID}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 2 || resultChanges(results[:1]) != 1 || resultChanges(results[1:2]) != 1 {
		conflict(w, "customer_already_exists")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": customerID, "email": email, "display_name": displayName, "status": "pending_setup",
		"kyc_status": "pending", "operations_status": "pending",
	})
}

func (app *application) completeCustomerSetup(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SetupToken string `json:"setup_token"`
		Password   string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if len(input.SetupToken) < 32 || !validCustomerPassword(input.Password) {
		validationError(w)
		return
	}
	now := time.Now().UTC()
	setupHash := tokenHash(input.SetupToken)
	rows, err := app.db.Query(r.Context(), `SELECT c.id, c.email, c.display_name, cc.setup_expires_at
    FROM customers c JOIN customer_credentials cc ON cc.customer_id=c.id
	    WHERE c.tenant_id=? AND c.status='pending_setup' AND c.kyc_status='approved' AND c.operations_status='active' AND cc.setup_token_hash=?
      AND cc.setup_consumed_at IS NULL AND cc.setup_expires_at>?`, app.tenantID, setupHash, databaseTimestamp(now))
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "setup_token_invalid"}})
		return
	}
	customerID := text(rows[0]["id"])
	salt := randomBytes(16)
	passwordHash, err := app.deriveCustomerPassword(input.Password, salt)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	totpSecret := randomTOTPSecret()
	encryptedSecret, err := app.encryptCustomerTOTP(totpSecret)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	enrollmentToken := randomToken(32)
	nowText := databaseTimestamp(now)
	result, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_credentials
      SET password_salt=?, password_hash=?, password_iterations=?, totp_secret_ciphertext=?,
          setup_consumed_at=?, enrollment_token_hash=?, enrollment_expires_at=?, updated_at=?
      WHERE customer_id=? AND setup_token_hash=? AND setup_consumed_at IS NULL AND setup_expires_at>?`, Params: []any{
			hex.EncodeToString(salt), hex.EncodeToString(passwordHash), customerPasswordIterations, encryptedSecret,
			nowText, tokenHash(enrollmentToken), databaseTimestamp(now.Add(customerEnrollmentDuration)), nowText,
			customerID, setupHash, nowText,
		}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
      (id, customer_id, event_type, actor, metadata_json, created_at)
      SELECT ?, ?, 'auth.password_enrolled', ?, '{}', ?
      WHERE EXISTS (SELECT 1 FROM customer_credentials WHERE customer_id=? AND enrollment_token_hash=?)`, Params: []any{
			randomID("audit"), customerID, customerID, nowText, customerID, tokenHash(enrollmentToken),
		}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if resultChanges(result[:1]) != 1 {
		conflict(w, "setup_state_changed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"next_step": "totp_setup_required", "enrollment_token": enrollmentToken,
	})
}

func (app *application) customerTOTPSetup(w http.ResponseWriter, r *http.Request) {
	var input struct {
		EnrollmentToken string `json:"enrollment_token"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	nowText := databaseTimestamp(time.Now())
	rows, err := app.db.Query(r.Context(), `SELECT c.email, cc.totp_secret_ciphertext
    FROM customers c JOIN customer_credentials cc ON cc.customer_id=c.id
	    WHERE c.tenant_id=? AND c.status='pending_setup' AND c.kyc_status='approved' AND c.operations_status='active' AND cc.enrollment_token_hash=?
      AND cc.enrollment_expires_at>?`, app.tenantID, tokenHash(input.EnrollmentToken), nowText)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "invalid_enrollment_token"}})
		return
	}
	secret, err := app.decryptCustomerTOTP(text(rows[0]["totp_secret_ciphertext"]))
	if err != nil {
		databaseError(app, w, err)
		return
	}
	email := text(rows[0]["email"])
	issuer := "SCC Digital Bank"
	otpauth := "otpauth://totp/" + url.PathEscape(issuer+":"+email) + "?secret=" + url.QueryEscape(secret) + "&issuer=" + url.QueryEscape(issuer) + "&algorithm=SHA1&digits=6&period=30"
	writeJSON(w, http.StatusOK, map[string]any{
		"secret": secret, "otpauth_uri": otpauth, "issuer": issuer, "account_name": email,
		"enrollment_token": input.EnrollmentToken,
	})
}

func (app *application) customerLogin(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	email := normalizeCustomerEmail(input.Email)
	rows, err := app.db.Query(r.Context(), `SELECT c.id, c.status, cc.password_salt, cc.password_hash,
      cc.password_iterations, cc.failed_attempts, cc.locked_until
    FROM customers c JOIN customer_credentials cc ON cc.customer_id=c.id
	    WHERE c.tenant_id=? AND c.email=? AND c.kyc_status='approved' AND c.operations_status='active'`, app.tenantID, email)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	now := time.Now().UTC()
	valid := false
	customerID := ""
	failedAttempts := int64(0)
	if len(rows) == 1 && text(rows[0]["status"]) == "active" {
		customerID = text(rows[0]["id"])
		failedAttempts = integer(rows[0]["failed_attempts"])
		lockedUntil, _ := time.Parse(time.RFC3339Nano, text(rows[0]["locked_until"]))
		if lockedUntil.IsZero() || !lockedUntil.After(now) {
			salt, saltErr := hex.DecodeString(text(rows[0]["password_salt"]))
			expected, hashErr := hex.DecodeString(text(rows[0]["password_hash"]))
			iterations := int(integer(rows[0]["password_iterations"]))
			if saltErr == nil && hashErr == nil && iterations == customerPasswordIterations {
				actual, deriveErr := app.deriveCustomerPassword(input.Password, salt)
				valid = deriveErr == nil && subtle.ConstantTimeCompare(actual, expected) == 1
			}
		}
	}
	if !valid {
		_, _ = app.deriveCustomerPassword(input.Password, make([]byte, 16))
		if customerID != "" {
			failedAttempts++
			lockedUntil := any(nil)
			if failedAttempts >= 5 {
				lockedUntil = databaseTimestamp(now.Add(customerLockDuration))
			}
			_, _ = app.db.Batch(r.Context(),
				d1.Statement{SQL: `UPDATE customer_credentials SET failed_attempts=?, locked_until=?, updated_at=?
          WHERE customer_id=?`, Params: []any{failedAttempts, lockedUntil, databaseTimestamp(now), customerID}},
				d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
          (id, customer_id, event_type, actor, metadata_json, created_at) VALUES (?, ?, 'auth.login_failed', ?, '{}', ?)`, Params: []any{
					randomID("audit"), customerID, email, databaseTimestamp(now),
				}},
			)
		}
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "invalid_email_or_password"}})
		return
	}
	challengeToken := randomToken(32)
	nowText := databaseTimestamp(now)
	_, err = app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_credentials SET failed_attempts=0, locked_until=NULL, updated_at=?
      WHERE customer_id=?`, Params: []any{nowText, customerID}},
		d1.Statement{SQL: `INSERT INTO customer_login_challenges
      (id, customer_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`, Params: []any{
			randomID("challenge"), customerID, tokenHash(challengeToken), databaseTimestamp(now.Add(customerChallengeDuration)), nowText,
		}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"next_step": "totp_required", "challenge_id": challengeToken})
}

func (app *application) verifyCustomerTOTP(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Code            string `json:"code"`
		RecoveryCode    string `json:"recovery_code"`
		ChallengeID     string `json:"challenge_id"`
		EnrollmentToken string `json:"enrollment_token"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	var rows []map[string]any
	var err error
	enrollment := input.EnrollmentToken != ""
	if enrollment {
		rows, err = app.db.Query(r.Context(), `SELECT c.id, c.email, c.display_name, cc.totp_secret_ciphertext, cc.credential_version
      FROM customers c JOIN customer_credentials cc ON cc.customer_id=c.id
		      WHERE c.tenant_id=? AND c.status='pending_setup' AND c.kyc_status='approved' AND c.operations_status='active' AND cc.enrollment_token_hash=?
        AND cc.enrollment_expires_at>?`, app.tenantID, tokenHash(input.EnrollmentToken), nowText)
	} else {
		rows, err = app.db.Query(r.Context(), `SELECT c.id, c.email, c.display_name, cc.totp_secret_ciphertext, cc.credential_version,
        lc.id AS challenge_row_id
      FROM customer_login_challenges lc JOIN customers c ON c.id=lc.customer_id
      JOIN customer_credentials cc ON cc.customer_id=c.id
	      WHERE c.tenant_id=? AND c.status='active' AND c.kyc_status='approved' AND c.operations_status='active'
	        AND lc.token_hash=? AND lc.consumed_at IS NULL AND lc.expires_at>?`,
			app.tenantID, tokenHash(input.ChallengeID), nowText)
	}
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "invalid_challenge"}})
		return
	}
	secret, err := app.decryptCustomerTOTP(text(rows[0]["totp_secret_ciphertext"]))
	recoveryID := ""
	validAuthentication := err == nil && verifyTOTPCode(secret, input.Code, now)
	if !enrollment && input.RecoveryCode != "" {
		recoveryRows, recoveryErr := app.db.Query(r.Context(), `SELECT id FROM customer_recovery_codes
      WHERE customer_id=? AND code_hash=? AND used_at IS NULL`, text(rows[0]["id"]), app.recoveryCodeHash(input.RecoveryCode))
		if recoveryErr != nil {
			databaseError(app, w, recoveryErr)
			return
		}
		validAuthentication = len(recoveryRows) == 1
		if validAuthentication {
			recoveryID = text(recoveryRows[0]["id"])
		}
	}
	if !validAuthentication {
		code := "invalid_totp_code"
		if input.RecoveryCode != "" {
			code = "invalid_recovery_code"
		}
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": code}})
		return
	}
	customerID := text(rows[0]["id"])
	credentialVersion := integer(rows[0]["credential_version"])
	sessionID, sessionToken, csrfToken, sessionStatement := newCustomerSession(customerID, credentialVersion, now)
	statements := []d1.Statement{}
	recoveryCodes := []string{}
	if enrollment {
		statements = append(statements,
			d1.Statement{SQL: `UPDATE customers SET status='active', updated_at=?
	        WHERE id=? AND tenant_id=? AND status='pending_setup' AND kyc_status='approved' AND operations_status='active'`, Params: []any{nowText, customerID, app.tenantID}},
			d1.Statement{SQL: `UPDATE customer_credentials
        SET setup_token_hash=NULL, setup_expires_at=NULL, enrollment_token_hash=NULL, enrollment_expires_at=NULL, updated_at=?
        WHERE customer_id=? AND enrollment_token_hash=?`, Params: []any{nowText, customerID, tokenHash(input.EnrollmentToken)}},
		)
		for index := 0; index < 10; index++ {
			code := strings.ToUpper(randomToken(8))
			recoveryCodes = append(recoveryCodes, code)
			statements = append(statements, d1.Statement{SQL: `INSERT INTO customer_recovery_codes
        (id, customer_id, code_hash, created_at) VALUES (?, ?, ?, ?)`, Params: []any{
				randomID("recovery"), customerID, app.recoveryCodeHash(code), nowText,
			}})
		}
	} else {
		statements = append(statements, d1.Statement{SQL: `UPDATE customer_login_challenges SET consumed_at=?
      WHERE id=? AND consumed_at IS NULL`, Params: []any{nowText, text(rows[0]["challenge_row_id"])}})
		if recoveryID != "" {
			statements = append(statements, d1.Statement{SQL: `UPDATE customer_recovery_codes SET used_at=?
      WHERE id=? AND customer_id=? AND used_at IS NULL`, Params: []any{nowText, recoveryID, customerID}})
			sessionStatement.SQL = recoveryCustomerSessionSQL
			sessionStatement.Params = append(sessionStatement.Params, recoveryID, customerID, nowText)
		}
	}
	sessionIndex := len(statements)
	statements = append(statements, sessionStatement, d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
    (id, customer_id, event_type, actor, metadata_json, created_at)
    SELECT ?, ?, 'auth.login_succeeded', ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM customer_sessions WHERE id=? AND customer_id=?)`, Params: []any{
		randomID("audit"), customerID, customerID, mustJSON(map[string]string{"session_id": sessionID}), nowText, sessionID, customerID,
	}})
	results, err := app.db.Batch(r.Context(), statements...)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) <= sessionIndex || resultChanges(results[:1]) != 1 || resultChanges(results[sessionIndex:sessionIndex+1]) != 1 {
		conflict(w, "authentication_state_changed")
		return
	}
	app.setCustomerSessionCookies(w, sessionToken, csrfToken, now.Add(customerSessionDuration))
	writeJSON(w, http.StatusOK, map[string]any{
		"next_step": "authenticated", "csrf_token": csrfToken, "recovery_codes": recoveryCodes,
		"user": customerUser(rows[0]),
	})
}

func (app *application) customerSessionInfo(w http.ResponseWriter, r *http.Request) {
	session, csrfToken, err := app.loadCustomerSession(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"csrf_token": csrfToken, "user": map[string]any{
		"id": session.CustomerID, "email": session.Email, "display_name": session.DisplayName, "role": "customer",
		"permissions": []string{"customers.read", "balances.read", "transactions.read"},
	}})
}

func (app *application) customerLogout(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	nowText := databaseTimestamp(time.Now())
	_, err = app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_sessions SET revoked_at=?, last_seen_at=?
      WHERE id=? AND revoked_at IS NULL`, Params: []any{nowText, nowText, session.ID}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
      (id, customer_id, event_type, actor, metadata_json, created_at) VALUES (?, ?, 'auth.logout', ?, '{}', ?)`, Params: []any{
			randomID("audit"), session.CustomerID, session.CustomerID, nowText,
		}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	app.clearCustomerSessionCookies(w)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (app *application) getCustomerProfile(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.loadCustomerSession(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": session.CustomerID, "email": session.Email, "display_name": session.DisplayName, "status": session.Status})
}

func (app *application) listCustomerWallets(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.loadCustomerSession(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT id, customer_id, chain_id, token_id, currency,
    CASE WHEN status='active' AND custody_provider='cregis' AND ownership_verified_at IS NOT NULL
      THEN address ELSE NULL END AS address,
    alias, status, custody_provider, ownership_verified_at,
    CASE WHEN status='active' AND custody_provider='cregis' AND ownership_verified_at IS NOT NULL
      AND address IS NOT NULL THEN 1 ELSE 0 END AS deposit_enabled,
    created_at
    FROM cregis_wallets WHERE tenant_id=? AND customer_id=? ORDER BY created_at DESC`, app.tenantID, session.CustomerID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	for _, row := range rows {
		available, frozen, balanceErr := app.customerWalletBalances(r, text(row["id"]), session.CustomerID)
		if balanceErr != nil {
			databaseError(app, w, balanceErr)
			return
		}
		row["available_balance"] = available
		row["frozen_balance"] = frozen
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}

func (app *application) listCustomerHistory(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.loadCustomerSession(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	withdrawals, err := app.db.Query(r.Context(), `SELECT id, customer_id, wallet_id, 'withdrawal' AS direction, currency, amount_text AS amount,
    status, to_address AS address, txid, cregis_cid, created_at
    FROM cregis_withdrawals WHERE tenant_id=? AND customer_id=? ORDER BY created_at DESC LIMIT 200`, app.tenantID, session.CustomerID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	deposits, err := app.db.Query(r.Context(), `SELECT d.id, w.customer_id, d.wallet_id, 'deposit' AS direction, d.currency, d.amount_text AS amount,
    d.status, d.address, d.txid, d.cregis_cid, d.received_at AS created_at
    FROM cregis_deposits d JOIN cregis_wallets w ON w.id=d.wallet_id
    WHERE d.tenant_id=? AND w.customer_id=? AND w.status='active' AND w.custody_provider='cregis'
      AND w.ownership_verified_at IS NOT NULL ORDER BY d.received_at DESC LIMIT 200`, app.tenantID, session.CustomerID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"withdrawals": withdrawals, "deposits": deposits})
}

func (app *application) customerWalletBalances(r *http.Request, walletID, customerID string) (string, string, error) {
	rows, err := app.db.Query(r.Context(), walletBalancesSQL,
		app.tenantID, walletID, app.tenantID, walletID, customerID,
		app.tenantID, walletID, customerID)
	if err != nil || len(rows) != 1 {
		if err == nil {
			err = errors.New("wallet balance query returned no row")
		}
		return "", "", err
	}
	available, availableErr := strconv.ParseInt(text(rows[0]["available_minor"]), 10, 64)
	frozen, frozenErr := strconv.ParseInt(text(rows[0]["frozen_minor"]), 10, 64)
	if availableErr != nil || frozenErr != nil || available < 0 || frozen < 0 {
		return "", "", errors.New("invalid stored wallet balance")
	}
	return formatUSDTMicroUnits(available), formatUSDTMicroUnits(frozen), nil
}

func (app *application) createCustomerWithdrawal(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": map[string]string{"code": "csrf_or_session_invalid"}})
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 128*1024+1))
	if err != nil || len(body) > 128*1024 {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": map[string]string{"code": "payload_too_large"}})
		return
	}
	var input map[string]any
	if err := json.Unmarshal(body, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]string{"code": "invalid_json"}})
		return
	}
	walletID, _ := input["wallet_id"].(string)
	amountText, _ := input["amount"].(string)
	if !safeIdentifier.MatchString(walletID) {
		validationError(w)
		return
	}
	if _, ok := parseUSDTMicroUnits(amountText); !ok {
		validationError(w)
		return
	}
	input["customer_id"] = session.CustomerID
	body, err = json.Marshal(input)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]string{"code": "invalid_json"}})
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	r.Header.Set("X-Neobank-User", session.CustomerID)
	app.createCregisWithdrawal(w, r)
}

func (app *application) loadCustomerSession(r *http.Request) (*customerSession, string, error) {
	cookie, err := r.Cookie(app.customerCookieName())
	if err != nil || len(cookie.Value) < 32 {
		return nil, "", errors.New("session cookie missing")
	}
	now := time.Now().UTC()
	rows, err := app.db.Query(r.Context(), `SELECT s.id, s.customer_id, s.csrf_hash, s.credential_version, s.expires_at,
      c.email, c.display_name, c.status, cc.credential_version AS current_credential_version
    FROM customer_sessions s JOIN customers c ON c.id=s.customer_id
    JOIN customer_credentials cc ON cc.customer_id=c.id
	    WHERE c.tenant_id=? AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND c.status='active'
	      AND c.kyc_status='approved' AND c.operations_status='active'`,
		app.tenantID, tokenHash(cookie.Value), databaseTimestamp(now))
	if err != nil || len(rows) != 1 {
		return nil, "", errors.New("session invalid")
	}
	if integer(rows[0]["credential_version"]) != integer(rows[0]["current_credential_version"]) {
		return nil, "", errors.New("credential version changed")
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, text(rows[0]["expires_at"]))
	if err != nil {
		return nil, "", err
	}
	csrfCookie, err := r.Cookie(app.customerCSRFCookieName())
	if err != nil || csrfCookie.Value == "" || subtle.ConstantTimeCompare([]byte(tokenHash(csrfCookie.Value)), []byte(text(rows[0]["csrf_hash"]))) != 1 {
		return nil, "", errors.New("csrf cookie invalid")
	}
	return &customerSession{
		ID: text(rows[0]["id"]), CustomerID: text(rows[0]["customer_id"]), Email: text(rows[0]["email"]),
		DisplayName: text(rows[0]["display_name"]), Status: text(rows[0]["status"]), CSRFHash: text(rows[0]["csrf_hash"]),
		CredentialVersion: integer(rows[0]["credential_version"]), ExpiresAt: expiresAt,
	}, csrfCookie.Value, nil
}

func (app *application) requireCustomerMutation(r *http.Request) (*customerSession, string, error) {
	session, _, err := app.loadCustomerSession(r)
	if err != nil {
		return nil, "", err
	}
	csrfToken := strings.TrimSpace(r.Header.Get("X-CSRF-Token"))
	if csrfToken == "" || subtle.ConstantTimeCompare([]byte(tokenHash(csrfToken)), []byte(session.CSRFHash)) != 1 {
		return nil, "", errors.New("csrf mismatch")
	}
	if !app.validCustomerOrigin(r.Header.Get("Origin")) {
		return nil, "", errors.New("origin mismatch")
	}
	return session, csrfToken, nil
}

func (app *application) validCustomerOrigin(raw string) bool {
	expected, err := url.Parse(app.portalURL)
	if err != nil {
		return false
	}
	actual, err := url.Parse(raw)
	return err == nil && actual.Scheme == expected.Scheme && actual.Host == expected.Host
}

func (app *application) deriveCustomerPassword(password string, salt []byte) ([]byte, error) {
	mac := hmac.New(sha256.New, app.customerPasswordPepper)
	_, _ = mac.Write([]byte("neobank-customer-password-v1\x00" + password))
	return pbkdf2.Key(sha256.New, hex.EncodeToString(mac.Sum(nil)), salt, customerPasswordIterations, 32)
}

func validCustomerPassword(password string) bool {
	if !customerPasswordPattern.MatchString(password) {
		return false
	}
	var lower, upper, digit, symbol bool
	for _, character := range password {
		switch {
		case character >= 'a' && character <= 'z':
			lower = true
		case character >= 'A' && character <= 'Z':
			upper = true
		case character >= '0' && character <= '9':
			digit = true
		default:
			symbol = true
		}
	}
	return lower && upper && digit && symbol
}

func (app *application) encryptCustomerTOTP(secret string) (string, error) {
	block, err := aes.NewCipher(app.customerTOTPKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := randomBytes(gcm.NonceSize())
	ciphertext := gcm.Seal(nil, nonce, []byte(secret), []byte(app.tenantID))
	return base64.RawURLEncoding.EncodeToString(append(nonce, ciphertext...)), nil
}

func (app *application) decryptCustomerTOTP(encoded string) (string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(app.customerTOTPKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || len(raw) < gcm.NonceSize() {
		return "", errors.New("invalid TOTP ciphertext")
	}
	plaintext, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], []byte(app.tenantID))
	return string(plaintext), err
}

func verifyTOTPCode(secret, code string, now time.Time) bool {
	if len(code) != 6 {
		return false
	}
	decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(secret))
	if err != nil {
		return false
	}
	for offset := int64(-1); offset <= 1; offset++ {
		counter := uint64(now.Unix()/30 + offset)
		message := make([]byte, 8)
		for index := 7; index >= 0; index-- {
			message[index] = byte(counter)
			counter >>= 8
		}
		mac := hmac.New(sha1.New, decoded)
		_, _ = mac.Write(message)
		digest := mac.Sum(nil)
		position := digest[len(digest)-1] & 0x0f
		value := (uint32(digest[position])&0x7f)<<24 | uint32(digest[position+1])<<16 | uint32(digest[position+2])<<8 | uint32(digest[position+3])
		expected := fmt.Sprintf("%06d", value%1_000_000)
		if subtle.ConstantTimeCompare([]byte(expected), []byte(code)) == 1 {
			return true
		}
	}
	return false
}

func newCustomerSession(customerID string, credentialVersion int64, now time.Time) (string, string, string, d1.Statement) {
	sessionID := randomID("session")
	sessionToken := randomToken(32)
	csrfToken := randomToken(32)
	return sessionID, sessionToken, csrfToken, d1.Statement{SQL: `INSERT INTO customer_sessions
    (id, customer_id, token_hash, csrf_hash, credential_version, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, Params: []any{
		sessionID, customerID, tokenHash(sessionToken), tokenHash(csrfToken), credentialVersion,
		databaseTimestamp(now.Add(customerSessionDuration)), databaseTimestamp(now), databaseTimestamp(now),
	}}
}

func databaseTimestamp(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05.000000000Z")
}

func (app *application) setCustomerSessionCookies(w http.ResponseWriter, token, csrfToken string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{Name: app.customerCookieName(), Value: token, Path: "/", Expires: expires,
		MaxAge: int(time.Until(expires).Seconds()), HttpOnly: true, Secure: strings.HasPrefix(app.portalURL, "https://"), SameSite: http.SameSiteLaxMode})
	http.SetCookie(w, &http.Cookie{Name: app.customerCSRFCookieName(), Value: csrfToken, Path: "/", Expires: expires,
		MaxAge: int(time.Until(expires).Seconds()), HttpOnly: false, Secure: strings.HasPrefix(app.portalURL, "https://"), SameSite: http.SameSiteLaxMode})
}

func (app *application) clearCustomerSessionCookies(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: app.customerCookieName(), Value: "", Path: "/", MaxAge: -1, HttpOnly: true,
		Secure: strings.HasPrefix(app.portalURL, "https://"), SameSite: http.SameSiteLaxMode})
	http.SetCookie(w, &http.Cookie{Name: app.customerCSRFCookieName(), Value: "", Path: "/", MaxAge: -1, HttpOnly: false,
		Secure: strings.HasPrefix(app.portalURL, "https://"), SameSite: http.SameSiteLaxMode})
}

func (app *application) customerCSRFCookieName() string {
	if strings.HasPrefix(app.portalURL, "https://") {
		return customerCSRFCookie
	}
	return "neobank_csrf"
}

func requiredSecret(name string, minimumLength int) ([]byte, error) {
	value := []byte(os.Getenv(name))
	if len(value) < minimumLength {
		return nil, fmt.Errorf("%s must contain at least %d bytes", name, minimumLength)
	}
	return value, nil
}

func requiredKey32(name string) ([]byte, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if decoded, err := hex.DecodeString(value); err == nil && len(decoded) == 32 {
		return decoded, nil
	}
	for _, encoding := range []*base64.Encoding{base64.RawURLEncoding, base64.StdEncoding, base64.RawStdEncoding} {
		if decoded, err := encoding.DecodeString(value); err == nil && len(decoded) == 32 {
			return decoded, nil
		}
	}
	return nil, fmt.Errorf("%s must be a 32-byte key encoded as hex or base64", name)
}

func (app *application) customerCookieName() string {
	if strings.HasPrefix(app.portalURL, "https://") {
		return customerSessionCookie
	}
	return "neobank_customer"
}

func (app *application) recoveryCodeHash(code string) string {
	mac := hmac.New(sha256.New, app.customerRecoveryPepper)
	_, _ = mac.Write([]byte("neobank-customer-recovery-v1\x00" + strings.ToUpper(strings.TrimSpace(code))))
	return hex.EncodeToString(mac.Sum(nil))
}

func normalizeCustomerEmail(raw string) string {
	email := strings.ToLower(strings.TrimSpace(raw))
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email || len(email) > 254 {
		return ""
	}
	return email
}

func randomTOTPSecret() string {
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(randomBytes(20))
}

func randomToken(length int) string {
	return base64.RawURLEncoding.EncodeToString(randomBytes(length))
}

func randomBytes(length int) []byte {
	value := make([]byte, length)
	if _, err := cryptorand.Read(value); err != nil {
		panic("crypto/rand unavailable")
	}
	return value
}

func tokenHash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func integer(value any) int64 {
	switch typed := value.(type) {
	case float64:
		return int64(typed)
	case int64:
		return typed
	case json.Number:
		parsed, _ := typed.Int64()
		return parsed
	case string:
		parsed, _ := strconv.ParseInt(typed, 10, 64)
		return parsed
	default:
		return 0
	}
}

func customerUser(row map[string]any) map[string]any {
	return map[string]any{
		"id": text(row["id"]), "email": text(row["email"]), "display_name": text(row["display_name"]),
		"role": "customer", "permissions": []string{"customers.read", "balances.read", "transactions.read"},
	}
}

func mustJSON(value any) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
