package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
)

const (
	customerPasswordResetDuration = 30 * time.Minute
	customerEmailVerifyDuration   = 30 * time.Minute
	customerRecoveryMinimumDelay  = 250 * time.Millisecond
)

var recoveryRequestIDPattern = regexp.MustCompile(`^(password_reset|email_verify)_[a-f0-9]{32}$`)

func (app *application) requestCustomerPasswordReset(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	defer func() {
		if remaining := customerRecoveryMinimumDelay - time.Since(started); remaining > 0 {
			time.Sleep(remaining)
		}
	}()

	var input struct {
		Email string `json:"email"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	email := normalizeCustomerEmail(input.Email)
	if email == "" {
		validationError(w)
		return
	}
	if !app.emailNotifications || len(app.customerPasswordResetSecret) < 32 {
		writePasswordResetAccepted(w)
		return
	}

	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	rows, err := app.db.Query(r.Context(), `SELECT c.id, c.email, c.display_name, c.email_verified_at,
	    cc.credential_version
	  FROM customers c JOIN customer_credentials cc ON cc.customer_id=c.id
	  WHERE c.tenant_id=? AND LOWER(c.email)=? AND c.status='active'
	    AND c.kyc_status='approved' AND c.operations_status='active'
	    AND cc.password_hash IS NOT NULL`, app.tenantID, email)
	if err != nil {
		app.logPasswordRecoveryError("password reset lookup failed", err)
		writePasswordResetAccepted(w)
		return
	}
	if len(rows) != 1 {
		_ = app.deriveCustomerRecoveryToken("password-reset-v1", "password_reset_00000000000000000000000000000000")
		writePasswordResetAccepted(w)
		return
	}

	row := rows[0]
	customerID := text(row["id"])
	displayName := text(row["display_name"])
	credentialVersion := integer(row["credential_version"])
	requestIPHash := recoveryContextHash(r.Header.Get("X-Neobank-Source-IP-SHA256"))
	userAgentHash := recoveryContextHash(r.Header.Get("X-Neobank-User-Agent-SHA256"))
	if text(row["email_verified_at"]) == "" {
		verificationID := randomID("email_verify")
		payload := mustJSON(map[string]string{
			"displayName":           displayName,
			"verificationRequestId": verificationID,
		})
		results, batchErr := app.db.Batch(r.Context(),
			d1.Statement{SQL: `UPDATE customer_email_verification_requests SET cancelled_at=?
			  WHERE customer_id=? AND consumed_at IS NULL AND cancelled_at IS NULL`, Params: []any{nowText, customerID}},
			d1.Statement{SQL: `INSERT INTO customer_email_verification_requests
			  (id, customer_id, email_snapshot, credential_version, expires_at, request_ip_hash,
			   user_agent_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, Params: []any{
				verificationID, customerID, email, credentialVersion,
				databaseTimestamp(now.Add(customerEmailVerifyDuration)), requestIPHash, userAgentHash, nowText,
			}},
			app.customerEmailOutboxStatement(
				verificationID,
				customerID,
				"CUSTOMER_EMAIL_VERIFICATION",
				email,
				payload,
			),
			d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
			  (id, customer_id, event_type, actor, metadata_json, created_at)
			  SELECT ?, ?, 'auth.email_verification_requested', 'customer_recovery', '{}', ?
			  WHERE EXISTS (SELECT 1 FROM customer_email_verification_requests WHERE id=?)`, Params: []any{
				randomID("audit"), customerID, nowText, verificationID,
			}},
		)
		if batchErr != nil || len(results) != 4 || resultChanges(results[1:2]) != 1 || resultChanges(results[3:4]) != 1 {
			app.logPasswordRecoveryError("email verification request failed", batchErr)
		}
		writePasswordResetAccepted(w)
		return
	}

	resetID := randomID("password_reset")
	payload := mustJSON(map[string]string{
		"displayName":    displayName,
		"resetRequestId": resetID,
	})
	results, batchErr := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_password_reset_requests SET cancelled_at=?
		  WHERE customer_id=? AND consumed_at IS NULL AND cancelled_at IS NULL`, Params: []any{nowText, customerID}},
		d1.Statement{SQL: `INSERT INTO customer_password_reset_requests
		  (id, customer_id, email_snapshot, credential_version, expires_at, request_ip_hash,
		   user_agent_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, Params: []any{
			resetID, customerID, email, credentialVersion,
			databaseTimestamp(now.Add(customerPasswordResetDuration)), requestIPHash, userAgentHash, nowText,
		}},
		app.customerEmailOutboxStatement(
			resetID,
			customerID,
			"CUSTOMER_PASSWORD_RESET_REQUESTED",
			email,
			payload,
		),
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  SELECT ?, ?, 'auth.password_reset_requested', 'customer_recovery', '{}', ?
		  WHERE EXISTS (SELECT 1 FROM customer_password_reset_requests WHERE id=?)`, Params: []any{
			randomID("audit"), customerID, nowText, resetID,
		}},
	)
	if batchErr != nil || len(results) != 4 || resultChanges(results[1:2]) != 1 || resultChanges(results[3:4]) != 1 {
		app.logPasswordRecoveryError("password reset request failed", batchErr)
	}
	writePasswordResetAccepted(w)
}

func writePasswordResetAccepted(w http.ResponseWriter) {
	writeJSON(w, http.StatusAccepted, map[string]bool{"accepted": true})
}

func (app *application) inspectCustomerPasswordReset(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ResetToken string `json:"reset_token"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	requestID, ok := app.verifyCustomerRecoveryToken("password-reset-v1", input.ResetToken)
	if !ok {
		invalidPasswordResetToken(w)
		return
	}
	rows, err := app.loadActivePasswordReset(r, requestID, false)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		invalidPasswordResetToken(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"valid":         true,
		"totp_required": false,
		"expires_at":    text(rows[0]["expires_at"]),
	})
}

func (app *application) completeCustomerPasswordReset(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ResetToken  string `json:"reset_token"`
		NewPassword string `json:"new_password"`
		// Accepted for compatibility with clients deployed before password recovery
		// became email-link only. These fields are intentionally not verified or used.
		TOTPCode     string `json:"totp_code"`
		RecoveryCode string `json:"recovery_code"`
	}
	if !decodeJSON(w, r, &input) || !validCustomerPassword(input.NewPassword) {
		validationError(w)
		return
	}
	requestID, ok := app.verifyCustomerRecoveryToken("password-reset-v1", input.ResetToken)
	if !ok {
		invalidPasswordResetToken(w)
		return
	}
	rows, err := app.loadActivePasswordReset(r, requestID, true)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		invalidPasswordResetToken(w)
		return
	}
	row := rows[0]
	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	customerID := text(row["customer_id"])
	credentialVersion := integer(row["credential_version"])
	newCredentialVersion := credentialVersion + 1
	method := "email"
	validExisting, _ := app.verifyCustomerPassword(input.NewPassword, row)
	if validExisting {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": map[string]string{"code": "password_unchanged"}})
		return
	}

	salt := randomBytes(16)
	passwordHash := app.deriveCustomerArgon2id(input.NewPassword, salt)
	consumeSQL := `UPDATE customer_password_reset_requests SET consumed_at=?
		  WHERE id=? AND customer_id=? AND credential_version=? AND consumed_at IS NULL
		    AND cancelled_at IS NULL AND expires_at>? AND attempts BETWEEN 1 AND 8`
	consumeParams := []any{nowText, requestID, customerID, credentialVersion, nowText}
	statements := []d1.Statement{
		{SQL: consumeSQL, Params: consumeParams},
	}
	credentialSQL := `UPDATE customer_credentials
	  SET password_salt=?, password_hash=?, password_algorithm=?, password_iterations=0,
	      password_memory_kib=?, password_time_cost=?, password_parallelism=?, password_changed_at=?,
	      credential_version=?, failed_attempts=0, locked_until=NULL, updated_at=?
	  WHERE customer_id=? AND credential_version=?
	    AND EXISTS (SELECT 1 FROM customer_password_reset_requests
	      WHERE id=? AND customer_id=? AND consumed_at=?)`
	credentialParams := []any{
		hex.EncodeToString(salt), hex.EncodeToString(passwordHash), customerPasswordAlgorithm,
		customerArgonMemoryKiB, customerArgonTimeCost, customerArgonParallelism, nowText,
		newCredentialVersion, nowText, customerID, credentialVersion, requestID, customerID, nowText,
	}
	credentialStatementIndex := len(statements)
	statements = append(statements,
		d1.Statement{SQL: credentialSQL, Params: credentialParams},
		d1.Statement{SQL: `UPDATE customer_sessions SET revoked_at=?, last_seen_at=?
		  WHERE customer_id=? AND revoked_at IS NULL`, Params: []any{nowText, nowText, customerID}},
		d1.Statement{SQL: `UPDATE customer_login_challenges SET consumed_at=?
		  WHERE customer_id=? AND consumed_at IS NULL`, Params: []any{nowText, customerID}},
		d1.Statement{SQL: `UPDATE customer_password_reset_requests SET cancelled_at=?
		  WHERE customer_id=? AND id<>? AND consumed_at IS NULL AND cancelled_at IS NULL`, Params: []any{nowText, customerID, requestID}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  SELECT ?, ?, 'auth.password_reset_completed', ?, ?, ?
		  WHERE EXISTS (SELECT 1 FROM customer_credentials
		    WHERE customer_id=? AND credential_version=? AND password_changed_at=?)`, Params: []any{
			randomID("audit"), customerID, customerID, mustJSON(map[string]string{"method": method}), nowText,
			customerID, newCredentialVersion, nowText,
		}},
	)
	if app.emailNotifications {
		statements = append(statements, app.customerEmailOutboxStatement(
			requestID+":completed",
			customerID,
			"CUSTOMER_PASSWORD_RESET_COMPLETED",
			text(row["email"]),
			mustJSON(map[string]string{"displayName": text(row["display_name"])}),
		))
	}
	results, err := app.db.Batch(r.Context(), statements...)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	auditIndex := credentialStatementIndex + 4
	if len(results) != len(statements) || resultChanges(results[:1]) != 1 ||
		resultChanges(results[credentialStatementIndex:credentialStatementIndex+1]) != 1 ||
		resultChanges(results[auditIndex:auditIndex+1]) != 1 {
		conflict(w, "password_reset_state_changed")
		return
	}
	app.clearCustomerSessionCookies(w)
	writeJSON(w, http.StatusOK, map[string]any{
		"password_changed_at": nowText,
		"sessions_revoked":    true,
	})
}

func (app *application) completeCustomerEmailVerification(w http.ResponseWriter, r *http.Request) {
	var input struct {
		VerificationToken string `json:"verification_token"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	requestID, ok := app.verifyCustomerRecoveryToken("email-verification-v1", input.VerificationToken)
	if !ok {
		invalidEmailVerificationToken(w)
		return
	}
	nowText := databaseTimestamp(time.Now().UTC())
	rows, err := app.db.Query(r.Context(), `SELECT v.customer_id, v.email_snapshot, v.credential_version
	  FROM customer_email_verification_requests v
	  JOIN customers c ON c.id=v.customer_id
	  JOIN customer_credentials cc ON cc.customer_id=c.id
	  WHERE v.id=? AND c.tenant_id=? AND LOWER(c.email)=LOWER(v.email_snapshot)
	    AND v.credential_version=cc.credential_version AND v.consumed_at IS NULL
	    AND v.cancelled_at IS NULL AND v.expires_at>?`, requestID, app.tenantID, nowText)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		invalidEmailVerificationToken(w)
		return
	}
	customerID := text(rows[0]["customer_id"])
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_email_verification_requests SET consumed_at=?
		  WHERE id=? AND customer_id=? AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>?
		    AND EXISTS (SELECT 1 FROM customers c JOIN customer_credentials cc ON cc.customer_id=c.id
		      WHERE c.id=? AND c.tenant_id=? AND LOWER(c.email)=LOWER(?)
		        AND cc.credential_version=?)`, Params: []any{
			nowText, requestID, customerID, nowText, customerID, app.tenantID,
			text(rows[0]["email_snapshot"]), integer(rows[0]["credential_version"]),
		}},
		d1.Statement{SQL: `UPDATE customers SET email_verified_at=?, updated_at=?
		  WHERE id=? AND tenant_id=? AND LOWER(email)=LOWER(?)
		    AND EXISTS (SELECT 1 FROM customer_email_verification_requests
		      WHERE id=? AND customer_id=? AND consumed_at=?)`, Params: []any{
			nowText, nowText, customerID, app.tenantID, text(rows[0]["email_snapshot"]), requestID, customerID, nowText,
		}},
		d1.Statement{SQL: `UPDATE customer_email_verification_requests SET cancelled_at=?
		  WHERE customer_id=? AND id<>? AND consumed_at IS NULL AND cancelled_at IS NULL`, Params: []any{nowText, customerID, requestID}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  SELECT ?, ?, 'auth.email_verified', ?, '{}', ?
		  WHERE EXISTS (SELECT 1 FROM customers WHERE id=? AND email_verified_at=?)`, Params: []any{
			randomID("audit"), customerID, customerID, nowText, customerID, nowText,
		}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 4 || resultChanges(results[:1]) != 1 || resultChanges(results[1:2]) != 1 || resultChanges(results[3:4]) != 1 {
		conflict(w, "email_verification_state_changed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"email_verified": true})
}

func (app *application) loadActivePasswordReset(r *http.Request, requestID string, incrementAttempt bool) ([]map[string]any, error) {
	nowText := databaseTimestamp(time.Now().UTC())
	query := `SELECT pr.customer_id, pr.email_snapshot, pr.expires_at, c.email, c.display_name,
	    cc.password_salt, cc.password_hash, cc.password_algorithm, cc.password_iterations,
	    cc.password_memory_kib, cc.password_time_cost, cc.password_parallelism,
	    cc.credential_version
	  FROM customer_password_reset_requests pr
	  JOIN customers c ON c.id=pr.customer_id
	  JOIN customer_credentials cc ON cc.customer_id=c.id
	  WHERE pr.id=? AND c.tenant_id=? AND c.status='active' AND c.kyc_status='approved'
	    AND c.operations_status='active' AND c.email_verified_at IS NOT NULL
	    AND LOWER(c.email)=LOWER(pr.email_snapshot) AND pr.credential_version=cc.credential_version
	    AND pr.consumed_at IS NULL AND pr.cancelled_at IS NULL AND pr.expires_at>?
	    AND pr.attempts BETWEEN 0 AND 8`
	if !incrementAttempt {
		return app.db.Query(r.Context(), query, requestID, app.tenantID, nowText)
	}
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_password_reset_requests SET attempts=attempts+1
		  WHERE id=? AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>? AND attempts<8`, Params: []any{
			requestID, nowText,
		}},
		d1.Statement{SQL: strings.Replace(query, "pr.attempts BETWEEN 0 AND 8", "pr.attempts BETWEEN 1 AND 8", 1), Params: []any{
			requestID, app.tenantID, nowText,
		}},
	)
	if err != nil {
		return nil, err
	}
	if len(results) != 2 || resultChanges(results[:1]) != 1 || len(results[1].Results) != 1 {
		return nil, nil
	}
	return results[1].Results, nil
}

func (app *application) customerEmailOutboxStatement(
	dedupeSuffix string,
	customerID string,
	templateKey string,
	recipient string,
	payload string,
) d1.Statement {
	return d1.Statement{SQL: `INSERT INTO "EmailOutbox"
	  ("id", "organizationId", "customerId", "dedupeKey", "templateKey", "recipient", "payload",
	   "status", "attemptCount", "maxAttempts", "nextAttemptAt", "createdAt", "updatedAt")
	  SELECT ?, organization.id, core_customer.id, ?, ?::"EmailTemplateKey", ?, ?::jsonb,
	    'PENDING'::"EmailDeliveryStatus", 0, 5, NOW(), NOW(), NOW()
	  FROM "Organization" organization
	  LEFT JOIN "Customer" core_customer ON core_customer.id=? AND core_customer."organizationId"=organization.id
	  WHERE organization.id=?
	  ON CONFLICT ("dedupeKey") DO NOTHING`, Params: []any{
		randomID("email"), "customer-auth:" + dedupeSuffix, templateKey,
		strings.ToLower(strings.TrimSpace(recipient)), payload, customerID, app.coreOrganizationID,
	}}
}

func (app *application) deriveCustomerRecoveryToken(purpose, requestID string) string {
	mac := hmac.New(sha256.New, app.customerPasswordResetSecret)
	_, _ = mac.Write([]byte("neobank-customer-" + purpose + "\x00" + requestID))
	return requestID + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (app *application) verifyCustomerRecoveryToken(purpose, raw string) (string, bool) {
	if len(app.customerPasswordResetSecret) < 32 {
		return "", false
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 2 || !recoveryRequestIDPattern.MatchString(parts[0]) {
		return "", false
	}
	expected := app.deriveCustomerRecoveryToken(purpose, parts[0])
	if subtle.ConstantTimeCompare([]byte(expected), []byte(raw)) != 1 {
		return "", false
	}
	return parts[0], true
}

func recoveryContextHash(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) == sha256.Size*2 {
		if decoded, err := hex.DecodeString(value); err == nil && len(decoded) == sha256.Size {
			return value
		}
	}
	digest := sha256.Sum256([]byte("unknown"))
	return hex.EncodeToString(digest[:])
}

func invalidPasswordResetToken(w http.ResponseWriter) {
	writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "invalid_password_reset_token"}})
}

func invalidEmailVerificationToken(w http.ResponseWriter) {
	writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "invalid_email_verification_token"}})
}

func (app *application) logPasswordRecoveryError(message string, err error) {
	if app.logger == nil {
		return
	}
	if err == nil {
		app.logger.Error(message)
		return
	}
	app.logger.Error(message, "error", err)
}
