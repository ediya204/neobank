package main

import (
	"crypto/hmac"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
)

const (
	customerEmailChangeDuration = 48 * time.Hour
	customerEmailChangeCooling  = 24 * time.Hour
	customerUnlockCooling       = 24 * time.Hour
)

type customerSecurityStepUp struct {
	CredentialVersion int64
	TOTPCounter       int64
}

func (app *application) verifyCustomerSecurityStepUp(
	r *http.Request,
	session *customerSession,
	currentPassword string,
	totpCode string,
) (customerSecurityStepUp, string) {
	if currentPassword == "" || len(currentPassword) > 128 || len(totpCode) != 6 {
		return customerSecurityStepUp{}, "validation_error"
	}
	rows, err := app.db.Query(r.Context(), `SELECT password_salt, password_hash, password_algorithm,
	    password_iterations, password_memory_kib, password_time_cost, password_parallelism,
	    totp_secret_ciphertext, totp_last_counter, credential_version
	  FROM customer_credentials WHERE customer_id=?`, session.CustomerID)
	if err != nil || len(rows) != 1 {
		return customerSecurityStepUp{}, "security_step_up_unavailable"
	}
	validPassword, _ := app.verifyCustomerPassword(currentPassword, rows[0])
	if !validPassword {
		return customerSecurityStepUp{}, "invalid_current_password"
	}
	if text(rows[0]["totp_secret_ciphertext"]) == "" {
		return customerSecurityStepUp{}, "totp_required"
	}
	secret, err := app.decryptCustomerTOTP(text(rows[0]["totp_secret_ciphertext"]))
	if err != nil {
		return customerSecurityStepUp{}, "security_step_up_unavailable"
	}
	counter, valid := verifyTOTPCode(secret, totpCode, time.Now().UTC(), integer(rows[0]["totp_last_counter"]))
	if !valid {
		return customerSecurityStepUp{}, "invalid_totp_code"
	}
	version := integer(rows[0]["credential_version"])
	if version != session.CredentialVersion {
		return customerSecurityStepUp{}, "authentication_state_changed"
	}
	return customerSecurityStepUp{CredentialVersion: version, TOTPCounter: counter}, ""
}

func (app *application) verifyCustomerTOTPOnly(
	r *http.Request,
	session *customerSession,
	totpCode string,
) (customerSecurityStepUp, string) {
	if len(totpCode) != 6 {
		return customerSecurityStepUp{}, "validation_error"
	}
	rows, err := app.db.Query(r.Context(), `SELECT totp_secret_ciphertext, totp_last_counter,
	    credential_version FROM customer_credentials WHERE customer_id=?`, session.CustomerID)
	if err != nil || len(rows) != 1 {
		return customerSecurityStepUp{}, "security_step_up_unavailable"
	}
	if text(rows[0]["totp_secret_ciphertext"]) == "" {
		return customerSecurityStepUp{}, "totp_required"
	}
	secret, err := app.decryptCustomerTOTP(text(rows[0]["totp_secret_ciphertext"]))
	if err != nil {
		return customerSecurityStepUp{}, "security_step_up_unavailable"
	}
	counter, valid := verifyTOTPCode(secret, totpCode, time.Now().UTC(), integer(rows[0]["totp_last_counter"]))
	if !valid {
		return customerSecurityStepUp{}, "invalid_totp_code"
	}
	version := integer(rows[0]["credential_version"])
	if version != session.CredentialVersion {
		return customerSecurityStepUp{}, "authentication_state_changed"
	}
	return customerSecurityStepUp{CredentialVersion: version, TOTPCounter: counter}, ""
}

func writeCustomerSecurityError(w http.ResponseWriter, code string) {
	status := http.StatusConflict
	switch code {
	case "validation_error":
		status = http.StatusUnprocessableEntity
	case "invalid_current_password", "invalid_totp_code":
		status = http.StatusUnauthorized
	case "totp_required":
		status = http.StatusPreconditionRequired
	}
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code}})
}

func (app *application) customerSecuritySummary(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.loadCustomerSession(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	nowText := databaseTimestamp(time.Now().UTC())
	profileRows, err := app.db.Query(r.Context(), `SELECT c.email_verified_at, c.withdrawals_locked,
	    c.withdrawals_locked_at, c.withdrawal_unlock_requested_at, c.withdrawal_unlock_available_at,
	    cc.password_changed_at, (cc.totp_secret_ciphertext IS NOT NULL) AS totp_enabled,
	    (SELECT COUNT(*) FROM customer_recovery_codes rc
	      WHERE rc.customer_id=c.id AND rc.used_at IS NULL) AS recovery_codes_remaining
	  FROM customers c JOIN customer_credentials cc ON cc.customer_id=c.id
	  WHERE c.id=? AND c.tenant_id=?`, session.CustomerID, app.tenantID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(profileRows) != 1 {
		writeCustomerSecurityError(w, "security_profile_unavailable")
		return
	}
	passkeys, err := app.db.Query(r.Context(), `SELECT id, display_name, created_at, last_used_at
	  FROM customer_passkeys WHERE customer_id=? ORDER BY created_at DESC`, session.CustomerID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	sessions, err := app.db.Query(r.Context(), `SELECT id, device_label, created_at, last_seen_at,
	    expires_at, idle_expires_at
	  FROM customer_sessions
	  WHERE customer_id=? AND revoked_at IS NULL AND expires_at>? AND idle_expires_at>?
	  ORDER BY last_seen_at DESC LIMIT 20`, session.CustomerID, nowText, nowText)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	for _, row := range sessions {
		row["current"] = text(row["id"]) == session.ID
	}
	events, err := app.db.Query(r.Context(), `SELECT event_type, created_at
	  FROM customer_auth_audit_events WHERE customer_id=?
	    AND event_type IN (
	      'auth.login_succeeded', 'auth.login_failed', 'auth.logout', 'auth.password_changed',
	      'auth.password_reset_completed', 'auth.totp_enrolled', 'auth.totp_replaced',
	      'auth.recovery_codes_regenerated', 'auth.session_revoked', 'auth.passkey_added',
	      'auth.passkey_removed', 'auth.passkey_login_succeeded', 'auth.email_change_requested',
	      'auth.email_change_verified', 'auth.email_changed', 'security.withdrawals_locked',
	      'security.withdrawal_unlock_requested', 'security.withdrawals_unlocked',
	      'privacy.data_exported', 'privacy.account_closure_requested',
	      'privacy.account_closure_cancelled'
	    )
	  ORDER BY created_at DESC LIMIT 30`, session.CustomerID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	emailChanges, err := app.db.Query(r.Context(), `SELECT id, new_email, expires_at, verified_at,
	    apply_after, created_at
	  FROM customer_email_change_requests
	  WHERE customer_id=? AND applied_at IS NULL AND cancelled_at IS NULL
	  ORDER BY created_at DESC LIMIT 1`, session.CustomerID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	closures, err := app.db.Query(r.Context(), `SELECT id, status, customer_reason, requested_at
	  FROM customer_account_closure_requests
	  WHERE customer_id=? AND status='pending' ORDER BY requested_at DESC LIMIT 1`, session.CustomerID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"email_verified":           text(profileRows[0]["email_verified_at"]) != "",
		"email_verified_at":        text(profileRows[0]["email_verified_at"]),
		"password_changed_at":      text(profileRows[0]["password_changed_at"]),
		"totp_enabled":             strings.EqualFold(text(profileRows[0]["totp_enabled"]), "true"),
		"recovery_codes_remaining": integer(profileRows[0]["recovery_codes_remaining"]),
		"passkeys":                 passkeys,
		"sessions":                 sessions,
		"events":                   events,
		"withdrawal_lock": map[string]any{
			"enabled":             strings.EqualFold(text(profileRows[0]["withdrawals_locked"]), "true"),
			"locked_at":           text(profileRows[0]["withdrawals_locked_at"]),
			"unlock_requested_at": text(profileRows[0]["withdrawal_unlock_requested_at"]),
			"unlock_available_at": text(profileRows[0]["withdrawal_unlock_available_at"]),
		},
		"pending_email_change": firstOrNil(emailChanges),
		"pending_closure":      firstOrNil(closures),
	})
}

func firstOrNil(rows []map[string]any) any {
	if len(rows) == 0 {
		return nil
	}
	return rows[0]
}

func (app *application) revokeCustomerSecuritySession(w http.ResponseWriter, r *http.Request, targetID string) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	if targetID == "" || targetID == session.ID {
		writeCustomerSecurityError(w, "cannot_revoke_current_session")
		return
	}
	nowText := databaseTimestamp(time.Now().UTC())
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_sessions SET revoked_at=?, last_seen_at=?
		  WHERE id=? AND customer_id=? AND revoked_at IS NULL`, Params: []any{nowText, nowText, targetID, session.CustomerID}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  SELECT ?, ?, 'auth.session_revoked', ?, '{}', ?
		  WHERE EXISTS (SELECT 1 FROM customer_sessions WHERE id=? AND customer_id=? AND revoked_at=?)`, Params: []any{
			randomID("audit"), session.CustomerID, session.CustomerID, nowText, targetID, session.CustomerID, nowText,
		}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 2 || resultChanges(results[:1]) != 1 || resultChanges(results[1:]) != 1 {
		writeCustomerSecurityError(w, "session_not_found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"revoked": true})
}

func (app *application) revokeOtherCustomerSessions(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	nowText := databaseTimestamp(time.Now().UTC())
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_sessions SET revoked_at=?, last_seen_at=?
		  WHERE customer_id=? AND id<>? AND revoked_at IS NULL`, Params: []any{nowText, nowText, session.CustomerID, session.ID}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  VALUES (?, ?, 'auth.session_revoked', ?, '{"scope":"other_sessions"}', ?)`, Params: []any{
			randomID("audit"), session.CustomerID, session.CustomerID, nowText,
		}},
	)
	if err != nil || len(results) != 2 || resultChanges(results[1:]) != 1 {
		databaseError(app, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revoked": true, "revoked_count": resultChanges(results[:1])})
}

func (app *application) regenerateCustomerRecoveryCodes(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	var input struct {
		CurrentPassword string `json:"current_password"`
		TOTPCode        string `json:"totp_code"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	stepUp, code := app.verifyCustomerSecurityStepUp(r, session, input.CurrentPassword, input.TOTPCode)
	if code != "" {
		writeCustomerSecurityError(w, code)
		return
	}
	nowText := databaseTimestamp(time.Now().UTC())
	codes := make([]string, 0, 10)
	statements := []d1.Statement{
		{SQL: `UPDATE customer_credentials SET totp_last_counter=?, updated_at=?
		  WHERE customer_id=? AND credential_version=? AND totp_last_counter<?`, Params: []any{
			stepUp.TOTPCounter, nowText, session.CustomerID, stepUp.CredentialVersion, stepUp.TOTPCounter,
		}},
		{SQL: `DELETE FROM customer_recovery_codes WHERE customer_id=?`, Params: []any{session.CustomerID}},
	}
	for index := 0; index < 10; index++ {
		recoveryCode := strings.ToUpper(randomToken(8))
		codes = append(codes, recoveryCode)
		statements = append(statements, d1.Statement{SQL: `INSERT INTO customer_recovery_codes
		  (id, customer_id, code_hash, created_at) VALUES (?, ?, ?, ?)`, Params: []any{
			randomID("recovery"), session.CustomerID, app.recoveryCodeHash(recoveryCode), nowText,
		}})
	}
	statements = append(statements, d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
	  (id, customer_id, event_type, actor, metadata_json, created_at)
	  VALUES (?, ?, 'auth.recovery_codes_regenerated', ?, '{}', ?)`, Params: []any{
		randomID("audit"), session.CustomerID, session.CustomerID, nowText,
	}})
	auditIndex := len(statements) - 1
	if app.emailNotifications {
		alertPayload, _ := json.Marshal(map[string]string{"displayName": session.DisplayName, "securityEvent": "recovery_codes_regenerated"})
		statements = append(statements, app.customerEmailOutboxStatement(
			randomID("security_alert"), session.CustomerID, "CUSTOMER_SECURITY_ALERT", session.Email, string(alertPayload),
		))
	}
	results, err := app.db.Batch(r.Context(), statements...)
	if err != nil || len(results) != len(statements) || resultChanges(results[:1]) != 1 ||
		resultChanges(results[auditIndex:auditIndex+1]) != 1 ||
		(app.emailNotifications && resultChanges(results[len(results)-1:]) != 1) {
		writeCustomerSecurityError(w, "recovery_code_regeneration_conflict")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"recovery_codes": codes})
}

func (app *application) startCustomerTOTPReplacement(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	var input struct {
		CurrentPassword string `json:"current_password"`
		TOTPCode        string `json:"totp_code"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	stepUp, code := app.verifyCustomerSecurityStepUp(r, session, input.CurrentPassword, input.TOTPCode)
	if code != "" {
		writeCustomerSecurityError(w, code)
		return
	}
	now := time.Now().UTC()
	secret := randomTOTPSecret()
	token, err := app.encryptCustomerTOTPEnrollment(customerTOTPEnrollment{
		CustomerID: session.CustomerID, Secret: secret, CredentialVersion: stepUp.CredentialVersion,
		ExpiresAt: now.Add(customerEnrollmentDuration).Unix(), Replace: true,
	})
	if err != nil {
		writeCustomerSecurityError(w, "totp_replacement_unavailable")
		return
	}
	nowText := databaseTimestamp(now)
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_credentials SET totp_last_counter=?, updated_at=?
		  WHERE customer_id=? AND credential_version=? AND totp_last_counter<?`, Params: []any{
			stepUp.TOTPCounter, nowText, session.CustomerID, stepUp.CredentialVersion, stepUp.TOTPCounter,
		}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  VALUES (?, ?, 'auth.totp_replacement_started', ?, '{}', ?)`, Params: []any{
			randomID("audit"), session.CustomerID, session.CustomerID, nowText,
		}},
	)
	if err != nil || len(results) != 2 || resultChanges(results[:1]) != 1 || resultChanges(results[1:]) != 1 {
		writeCustomerSecurityError(w, "totp_replacement_conflict")
		return
	}
	issuer := "SSC Digital Bank"
	otpauth := "otpauth://totp/" + url.PathEscape(issuer+":"+session.Email) + "?secret=" + url.QueryEscape(secret) + "&issuer=" + url.QueryEscape(issuer) + "&algorithm=SHA1&digits=6&period=30"
	writeJSON(w, http.StatusOK, map[string]any{
		"secret": secret, "otpauth_uri": otpauth, "issuer": issuer, "account_name": session.Email,
		"enrollment_token": token, "expires_at": databaseTimestamp(now.Add(customerEnrollmentDuration)),
	})
}

func (app *application) verifyCustomerTOTPReplacement(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	var input struct {
		EnrollmentToken string `json:"enrollment_token"`
		Code            string `json:"code"`
	}
	if !decodeJSON(w, r, &input) || input.EnrollmentToken == "" || len(input.Code) != 6 {
		validationError(w)
		return
	}
	enrollment, err := app.decryptCustomerTOTPEnrollment(input.EnrollmentToken)
	now := time.Now().UTC()
	if err != nil || !enrollment.Replace || enrollment.CustomerID != session.CustomerID ||
		enrollment.CredentialVersion != session.CredentialVersion || enrollment.ExpiresAt < now.Unix() {
		writeCustomerSecurityError(w, "invalid_enrollment_token")
		return
	}
	newCounter, valid := verifyTOTPCode(enrollment.Secret, input.Code, now, -1)
	if !valid {
		writeCustomerSecurityError(w, "invalid_totp_code")
		return
	}
	encryptedSecret, err := app.encryptCustomerTOTP(enrollment.Secret)
	if err != nil {
		writeCustomerSecurityError(w, "totp_replacement_unavailable")
		return
	}
	nowText := databaseTimestamp(now)
	newVersion := session.CredentialVersion + 1
	nextIdleExpiry := now.Add(customerSessionIdleDuration)
	if nextIdleExpiry.After(session.ExpiresAt) {
		nextIdleExpiry = session.ExpiresAt
	}
	codes := make([]string, 0, 10)
	statements := []d1.Statement{
		{SQL: `UPDATE customer_credentials SET totp_secret_ciphertext=?, totp_last_counter=?,
		  credential_version=?, updated_at=? WHERE customer_id=? AND credential_version=?`, Params: []any{
			encryptedSecret, newCounter, newVersion, nowText, session.CustomerID, session.CredentialVersion,
		}},
		{SQL: `UPDATE customer_sessions SET revoked_at=?, last_seen_at=?
		  WHERE customer_id=? AND id<>? AND revoked_at IS NULL`, Params: []any{nowText, nowText, session.CustomerID, session.ID}},
		{SQL: `UPDATE customer_sessions SET credential_version=?, last_seen_at=?, idle_expires_at=?
		  WHERE id=? AND customer_id=? AND revoked_at IS NULL AND credential_version=?`, Params: []any{
			newVersion, nowText, databaseTimestamp(nextIdleExpiry), session.ID, session.CustomerID, session.CredentialVersion,
		}},
		{SQL: `UPDATE customer_login_challenges SET consumed_at=? WHERE customer_id=? AND consumed_at IS NULL`, Params: []any{nowText, session.CustomerID}},
		{SQL: `DELETE FROM customer_recovery_codes WHERE customer_id=?`, Params: []any{session.CustomerID}},
	}
	for index := 0; index < 10; index++ {
		recoveryCode := strings.ToUpper(randomToken(8))
		codes = append(codes, recoveryCode)
		statements = append(statements, d1.Statement{SQL: `INSERT INTO customer_recovery_codes
		  (id, customer_id, code_hash, created_at) VALUES (?, ?, ?, ?)`, Params: []any{
			randomID("recovery"), session.CustomerID, app.recoveryCodeHash(recoveryCode), nowText,
		}})
	}
	statements = append(statements, d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
	  (id, customer_id, event_type, actor, metadata_json, created_at)
	  SELECT ?, ?, 'auth.totp_replaced', ?, '{}', ? WHERE EXISTS (
	    SELECT 1 FROM customer_sessions WHERE id=? AND customer_id=? AND credential_version=?)`, Params: []any{
		randomID("audit"), session.CustomerID, session.CustomerID, nowText, session.ID, session.CustomerID, newVersion,
	}})
	auditIndex := len(statements) - 1
	if app.emailNotifications {
		alertPayload, _ := json.Marshal(map[string]string{"displayName": session.DisplayName, "securityEvent": "totp_replaced"})
		statements = append(statements, app.customerEmailOutboxStatement(
			randomID("security_alert"), session.CustomerID, "CUSTOMER_SECURITY_ALERT", session.Email, string(alertPayload),
		))
	}
	results, err := app.db.Batch(r.Context(), statements...)
	if err != nil || len(results) != len(statements) || resultChanges(results[:1]) != 1 ||
		resultChanges(results[2:3]) != 1 || resultChanges(results[auditIndex:auditIndex+1]) != 1 ||
		(app.emailNotifications && resultChanges(results[len(results)-1:]) != 1) {
		writeCustomerSecurityError(w, "totp_replacement_conflict")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"totp_enabled": true, "recovery_codes": codes, "other_sessions_revoked": true,
	})
}

func normalizeCustomerNewEmail(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	parsed, err := mail.ParseAddress(value)
	if err != nil || parsed.Address != value || len(value) > 254 {
		return ""
	}
	return value
}

func (app *application) requestCustomerEmailChange(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	var input struct {
		NewEmail        string `json:"new_email"`
		CurrentPassword string `json:"current_password"`
		TOTPCode        string `json:"totp_code"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	newEmail := normalizeCustomerNewEmail(input.NewEmail)
	if newEmail == "" || strings.EqualFold(newEmail, session.Email) {
		writeCustomerSecurityError(w, "invalid_new_email")
		return
	}
	if !app.emailNotifications || len(app.customerPasswordResetSecret) < 32 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": map[string]string{"code": "email_notifications_unavailable"}})
		return
	}
	stepUp, code := app.verifyCustomerSecurityStepUp(r, session, input.CurrentPassword, input.TOTPCode)
	if code != "" {
		writeCustomerSecurityError(w, code)
		return
	}
	conflicts, err := app.db.Query(r.Context(), `SELECT id FROM customers WHERE tenant_id=? AND LOWER(email)=?`, app.tenantID, newEmail)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(conflicts) != 0 {
		writeCustomerSecurityError(w, "email_already_in_use")
		return
	}
	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	requestID := randomID("email_change")
	payload, _ := json.Marshal(map[string]string{"displayName": session.DisplayName, "emailChangeRequestId": requestID})
	alertPayload, _ := json.Marshal(map[string]string{"displayName": session.DisplayName, "securityEvent": "email_change_requested"})
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_credentials SET totp_last_counter=?, updated_at=?
		  WHERE customer_id=? AND credential_version=? AND totp_last_counter<?`, Params: []any{
			stepUp.TOTPCounter, nowText, session.CustomerID, stepUp.CredentialVersion, stepUp.TOTPCounter,
		}},
		d1.Statement{SQL: `UPDATE customer_email_change_requests SET cancelled_at=?
		  WHERE customer_id=? AND applied_at IS NULL AND cancelled_at IS NULL`, Params: []any{nowText, session.CustomerID}},
		d1.Statement{SQL: `INSERT INTO customer_email_change_requests
		  (id, customer_id, old_email, new_email, credential_version, expires_at, created_at)
		  VALUES (?, ?, ?, ?, ?, ?, ?)`, Params: []any{
			requestID, session.CustomerID, session.Email, newEmail, stepUp.CredentialVersion,
			databaseTimestamp(now.Add(customerEmailChangeDuration)), nowText,
		}},
		app.customerEmailOutboxStatement(requestID+":verify", session.CustomerID,
			"CUSTOMER_EMAIL_CHANGE_VERIFICATION", newEmail, string(payload)),
		app.customerEmailOutboxStatement(requestID+":old-alert", session.CustomerID,
			"CUSTOMER_SECURITY_ALERT", session.Email, string(alertPayload)),
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  VALUES (?, ?, 'auth.email_change_requested', ?, '{}', ?)`, Params: []any{
			randomID("audit"), session.CustomerID, session.CustomerID, nowText,
		}},
	)
	if err != nil || len(results) != 6 || resultChanges(results[:1]) != 1 ||
		resultChanges(results[2:3]) != 1 || resultChanges(results[3:4]) != 1 ||
		resultChanges(results[4:5]) != 1 || resultChanges(results[5:]) != 1 {
		writeCustomerSecurityError(w, "email_change_conflict")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"verification_sent": true,
		"expires_at":        databaseTimestamp(now.Add(customerEmailChangeDuration)),
		"cooling_hours":     int(customerEmailChangeCooling / time.Hour),
	})
}

func (app *application) completeCustomerEmailChangeVerification(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Token string `json:"email_change_token"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	requestID, valid := app.verifyCustomerRecoveryToken("email-change-v1", input.Token)
	if !valid {
		invalidCustomerEmailChangeToken(w)
		return
	}
	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	applyAfter := databaseTimestamp(now.Add(customerEmailChangeCooling))
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_email_change_requests SET verified_at=?, apply_after=?
		  WHERE id=? AND verified_at IS NULL AND applied_at IS NULL AND cancelled_at IS NULL
		    AND expires_at>?`, Params: []any{nowText, applyAfter, requestID, nowText}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  SELECT ?, customer_id, 'auth.email_change_verified', customer_id, '{}', ?
		  FROM customer_email_change_requests WHERE id=? AND verified_at=?`, Params: []any{
			randomID("audit"), nowText, requestID, nowText,
		}},
	)
	if err != nil || len(results) != 2 || resultChanges(results[:1]) != 1 || resultChanges(results[1:]) != 1 {
		invalidCustomerEmailChangeToken(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"verified": true, "apply_after": applyAfter})
}

func invalidCustomerEmailChangeToken(w http.ResponseWriter) {
	writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "invalid_email_change_token"}})
}

func (app *application) applyCustomerEmailChange(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	var input struct {
		CurrentPassword string `json:"current_password"`
		TOTPCode        string `json:"totp_code"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	stepUp, code := app.verifyCustomerSecurityStepUp(r, session, input.CurrentPassword, input.TOTPCode)
	if code != "" {
		writeCustomerSecurityError(w, code)
		return
	}
	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	requests, err := app.db.Query(r.Context(), `SELECT id, old_email, new_email
	  FROM customer_email_change_requests WHERE customer_id=? AND verified_at IS NOT NULL
	    AND apply_after<=? AND applied_at IS NULL AND cancelled_at IS NULL
	    AND credential_version=? ORDER BY created_at DESC LIMIT 1`,
		session.CustomerID, nowText, stepUp.CredentialVersion)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(requests) != 1 {
		writeCustomerSecurityError(w, "email_change_not_ready")
		return
	}
	requestID := text(requests[0]["id"])
	oldEmail := text(requests[0]["old_email"])
	newEmail := text(requests[0]["new_email"])
	newVersion := stepUp.CredentialVersion + 1
	nextIdleExpiry := now.Add(customerSessionIdleDuration)
	if nextIdleExpiry.After(session.ExpiresAt) {
		nextIdleExpiry = session.ExpiresAt
	}
	oldPayload, _ := json.Marshal(map[string]string{"displayName": session.DisplayName, "securityEvent": "email_changed_old"})
	newPayload, _ := json.Marshal(map[string]string{"displayName": session.DisplayName, "securityEvent": "email_changed_new"})
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customers SET email=?, email_verified_at=?, updated_at=?
		  WHERE id=? AND tenant_id=? AND LOWER(email)=?`, Params: []any{
			newEmail, nowText, nowText, session.CustomerID, app.tenantID, strings.ToLower(oldEmail),
		}},
		d1.Statement{SQL: `UPDATE customer_credentials SET credential_version=?, totp_last_counter=?, updated_at=?
		  WHERE customer_id=? AND credential_version=? AND totp_last_counter<?`, Params: []any{
			newVersion, stepUp.TOTPCounter, nowText, session.CustomerID, stepUp.CredentialVersion, stepUp.TOTPCounter,
		}},
		d1.Statement{SQL: `UPDATE customer_sessions SET revoked_at=?, last_seen_at=?
		  WHERE customer_id=? AND id<>? AND revoked_at IS NULL`, Params: []any{nowText, nowText, session.CustomerID, session.ID}},
		d1.Statement{SQL: `UPDATE customer_sessions SET credential_version=?, last_seen_at=?, idle_expires_at=?
		  WHERE id=? AND customer_id=? AND revoked_at IS NULL AND credential_version=?`, Params: []any{
			newVersion, nowText, databaseTimestamp(nextIdleExpiry), session.ID, session.CustomerID, stepUp.CredentialVersion,
		}},
		d1.Statement{SQL: `UPDATE customer_login_challenges SET consumed_at=?
		  WHERE customer_id=? AND consumed_at IS NULL`, Params: []any{nowText, session.CustomerID}},
		d1.Statement{SQL: `UPDATE customer_password_reset_requests SET cancelled_at=?
		  WHERE customer_id=? AND consumed_at IS NULL AND cancelled_at IS NULL`, Params: []any{nowText, session.CustomerID}},
		d1.Statement{SQL: `UPDATE customer_email_verification_requests SET cancelled_at=?
		  WHERE customer_id=? AND consumed_at IS NULL AND cancelled_at IS NULL`, Params: []any{nowText, session.CustomerID}},
		d1.Statement{SQL: `UPDATE customer_email_change_requests SET applied_at=?
		  WHERE id=? AND customer_id=? AND applied_at IS NULL AND cancelled_at IS NULL`, Params: []any{nowText, requestID, session.CustomerID}},
		app.customerEmailOutboxStatement(requestID+":changed-old", session.CustomerID,
			"CUSTOMER_SECURITY_ALERT", oldEmail, string(oldPayload)),
		app.customerEmailOutboxStatement(requestID+":changed-new", session.CustomerID,
			"CUSTOMER_SECURITY_ALERT", newEmail, string(newPayload)),
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  SELECT ?, ?, 'auth.email_changed', ?, '{}', ?
		  WHERE EXISTS (SELECT 1 FROM customer_sessions WHERE id=? AND credential_version=?)`, Params: []any{
			randomID("audit"), session.CustomerID, session.CustomerID, nowText, session.ID, newVersion,
		}},
	)
	if err != nil || len(results) != 11 || resultChanges(results[:1]) != 1 ||
		resultChanges(results[1:2]) != 1 || resultChanges(results[3:4]) != 1 ||
		resultChanges(results[7:8]) != 1 || resultChanges(results[8:9]) != 1 ||
		resultChanges(results[9:10]) != 1 || resultChanges(results[10:]) != 1 {
		writeCustomerSecurityError(w, "email_change_conflict")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"email_changed": true, "other_sessions_revoked": true})
}

func (app *application) changeCustomerWithdrawalLock(w http.ResponseWriter, r *http.Request, action string) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	var input struct {
		CurrentPassword string `json:"current_password"`
		TOTPCode        string `json:"totp_code"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	stepUp, code := app.verifyCustomerSecurityStepUp(r, session, input.CurrentPassword, input.TOTPCode)
	if code != "" {
		writeCustomerSecurityError(w, code)
		return
	}
	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	updateSQL := ""
	eventType := ""
	response := map[string]any{}
	switch action {
	case "enable":
		updateSQL = `UPDATE customers SET withdrawals_locked=TRUE, withdrawals_locked_at=?,
		  withdrawal_unlock_requested_at=NULL, withdrawal_unlock_available_at=NULL, updated_at=?
		  WHERE id=? AND tenant_id=? AND withdrawals_locked=FALSE`
		eventType = "security.withdrawals_locked"
		response["enabled"] = true
	case "request-unlock":
		updateSQL = `UPDATE customers SET withdrawal_unlock_requested_at=?,
		  withdrawal_unlock_available_at=?, updated_at=?
		  WHERE id=? AND tenant_id=? AND withdrawals_locked=TRUE`
		eventType = "security.withdrawal_unlock_requested"
		response["enabled"] = true
		response["unlock_available_at"] = databaseTimestamp(now.Add(customerUnlockCooling))
	case "confirm-unlock":
		updateSQL = `UPDATE customers SET withdrawals_locked=FALSE, withdrawals_locked_at=NULL,
		  withdrawal_unlock_requested_at=NULL, withdrawal_unlock_available_at=NULL, updated_at=?
		  WHERE id=? AND tenant_id=? AND withdrawals_locked=TRUE
		    AND withdrawal_unlock_available_at IS NOT NULL AND withdrawal_unlock_available_at<=?`
		eventType = "security.withdrawals_unlocked"
		response["enabled"] = false
	default:
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]string{"code": "not_found"}})
		return
	}
	params := []any{}
	if action == "enable" {
		params = []any{nowText, nowText, session.CustomerID, app.tenantID}
	} else if action == "request-unlock" {
		params = []any{nowText, databaseTimestamp(now.Add(customerUnlockCooling)), nowText, session.CustomerID, app.tenantID}
	} else {
		params = []any{nowText, session.CustomerID, app.tenantID, nowText}
	}
	alertPayload, _ := json.Marshal(map[string]string{"displayName": session.DisplayName, "securityEvent": eventType})
	statements := []d1.Statement{
		{SQL: `UPDATE customer_credentials SET totp_last_counter=?, updated_at=?
		  WHERE customer_id=? AND credential_version=? AND totp_last_counter<?`, Params: []any{
			stepUp.TOTPCounter, nowText, session.CustomerID, stepUp.CredentialVersion, stepUp.TOTPCounter,
		}},
		{SQL: updateSQL, Params: params},
		{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  SELECT ?, ?, ?, ?, '{}', ? WHERE EXISTS (
		    SELECT 1 FROM customers WHERE id=? AND tenant_id=?)`, Params: []any{
			randomID("audit"), session.CustomerID, eventType, session.CustomerID, nowText,
			session.CustomerID, app.tenantID,
		}},
	}
	if app.emailNotifications {
		statements = append(statements, app.customerEmailOutboxStatement(
			randomID("security_alert"), session.CustomerID, "CUSTOMER_SECURITY_ALERT", session.Email, string(alertPayload),
		))
	}
	results, err := app.db.Batch(r.Context(), statements...)
	if err != nil || len(results) != len(statements) || resultChanges(results[:1]) != 1 ||
		resultChanges(results[1:2]) != 1 || resultChanges(results[2:3]) != 1 {
		writeCustomerSecurityError(w, "withdrawal_lock_state_conflict")
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (app *application) exportCustomerData(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	var input struct {
		CurrentPassword string `json:"current_password"`
		TOTPCode        string `json:"totp_code"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	stepUp, code := app.verifyCustomerSecurityStepUp(r, session, input.CurrentPassword, input.TOTPCode)
	if code != "" {
		writeCustomerSecurityError(w, code)
		return
	}
	nowText := databaseTimestamp(time.Now().UTC())
	profile, err := app.db.Query(r.Context(), `SELECT id, email, display_name, status, kyc_status,
	    operations_status, email_verified_at, created_at, updated_at
	  FROM customers WHERE id=? AND tenant_id=?`, session.CustomerID, app.tenantID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	applicationRows, _ := app.db.Query(r.Context(), `SELECT account_type, phone_country_code, phone,
	    residence_country, full_name, date_of_birth, nationality, legal_name, registration_number,
	    incorporation_country, contact_name, contact_role, beneficial_owner_name,
	    beneficial_owner_ownership, submitted_at, updated_at
	  FROM customer_applications WHERE customer_id=? AND tenant_id=?`, session.CustomerID, app.tenantID)
	wallets, _ := app.db.Query(r.Context(), `SELECT id, chain_id, token_id, currency, address, alias,
	    status, custody_provider, ownership_verified_at, created_at
	  FROM cregis_wallets WHERE customer_id=? AND tenant_id=? ORDER BY created_at DESC`, session.CustomerID, app.tenantID)
	withdrawals, _ := app.db.Query(r.Context(), `SELECT id, currency, amount_text, to_address, status,
	    txid, created_at, completed_at, updated_at
	  FROM cregis_withdrawals WHERE customer_id=? AND tenant_id=? ORDER BY created_at DESC`, session.CustomerID, app.tenantID)
	events, _ := app.db.Query(r.Context(), `SELECT event_type, created_at
	  FROM customer_auth_audit_events WHERE customer_id=? ORDER BY created_at DESC LIMIT 500`, session.CustomerID)
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_credentials SET totp_last_counter=?, updated_at=?
		  WHERE customer_id=? AND credential_version=? AND totp_last_counter<?`, Params: []any{
			stepUp.TOTPCounter, nowText, session.CustomerID, stepUp.CredentialVersion, stepUp.TOTPCounter,
		}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  VALUES (?, ?, 'privacy.data_exported', ?, '{}', ?)`, Params: []any{
			randomID("audit"), session.CustomerID, session.CustomerID, nowText,
		}},
	)
	if err != nil || len(results) != 2 || resultChanges(results[:1]) != 1 || resultChanges(results[1:]) != 1 {
		writeCustomerSecurityError(w, "data_export_conflict")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"generated_at":    nowText,
		"profile":         firstOrNil(profile),
		"application":     firstOrNil(applicationRows),
		"wallets":         wallets,
		"withdrawals":     withdrawals,
		"security_events": events,
	})
}

func (app *application) requestCustomerAccountClosure(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	var input struct {
		Reason          string `json:"reason"`
		CurrentPassword string `json:"current_password"`
		TOTPCode        string `json:"totp_code"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	reason := strings.TrimSpace(input.Reason)
	if len(reason) < 10 || len(reason) > 500 {
		writeCustomerSecurityError(w, "invalid_closure_reason")
		return
	}
	stepUp, code := app.verifyCustomerSecurityStepUp(r, session, input.CurrentPassword, input.TOTPCode)
	if code != "" {
		writeCustomerSecurityError(w, code)
		return
	}
	nowText := databaseTimestamp(time.Now().UTC())
	requestID := randomID("closure")
	alertPayload, _ := json.Marshal(map[string]string{"displayName": session.DisplayName, "securityEvent": "account_closure_requested"})
	statements := []d1.Statement{
		{SQL: `UPDATE customer_credentials SET totp_last_counter=?, updated_at=?
		  WHERE customer_id=? AND credential_version=? AND totp_last_counter<?`, Params: []any{
			stepUp.TOTPCounter, nowText, session.CustomerID, stepUp.CredentialVersion, stepUp.TOTPCounter,
		}},
		{SQL: `INSERT INTO customer_account_closure_requests
		  (id, customer_id, status, customer_reason, requested_at)
		  VALUES (?, ?, 'pending', ?, ?)`, Params: []any{requestID, session.CustomerID, reason, nowText}},
		{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  VALUES (?, ?, 'privacy.account_closure_requested', ?, '{}', ?)`, Params: []any{
			randomID("audit"), session.CustomerID, session.CustomerID, nowText,
		}},
	}
	if app.emailNotifications {
		statements = append(statements, app.customerEmailOutboxStatement(requestID+":alert", session.CustomerID,
			"CUSTOMER_SECURITY_ALERT", session.Email, string(alertPayload)))
	}
	results, err := app.db.Batch(r.Context(), statements...)
	if err != nil || len(results) != len(statements) || resultChanges(results[:1]) != 1 ||
		resultChanges(results[1:2]) != 1 || resultChanges(results[2:3]) != 1 {
		writeCustomerSecurityError(w, "account_closure_request_conflict")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"request_id": requestID, "status": "pending"})
}

func (app *application) cancelCustomerAccountClosure(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	nowText := databaseTimestamp(time.Now().UTC())
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_account_closure_requests
		  SET status='cancelled', cancelled_at=? WHERE customer_id=? AND status='pending'`, Params: []any{nowText, session.CustomerID}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  SELECT ?, ?, 'privacy.account_closure_cancelled', ?, '{}', ?
		  WHERE NOT EXISTS (SELECT 1 FROM customer_account_closure_requests
		    WHERE customer_id=? AND status='pending')`, Params: []any{
			randomID("audit"), session.CustomerID, session.CustomerID, nowText, session.CustomerID,
		}},
	)
	if err != nil || len(results) != 2 || resultChanges(results[:1]) != 1 || resultChanges(results[1:]) != 1 {
		writeCustomerSecurityError(w, "account_closure_not_pending")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"cancelled": true})
}

func validSHA256Hex(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) != 64 {
		return ""
	}
	if _, err := hex.DecodeString(value); err != nil {
		return ""
	}
	return value
}

func constantTimeStringEqual(left, right string) bool {
	return hmac.Equal([]byte(left), []byte(right))
}
