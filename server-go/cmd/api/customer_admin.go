package main

import (
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
)

var (
	errAuditWrite        = errors.New("customer audit write failed")
	errCustomerStateRead = errors.New("customer state read failed")
)

const (
	adminCustomerFields = `c.id AS id, c.email AS email, c.display_name AS display_name,
	    c.status AS status, c.kyc_status AS kyc_status, c.operations_status AS operations_status,
	    c.kyc_reviewed_by AS kyc_reviewed_by, c.kyc_reviewed_at AS kyc_reviewed_at,
	    c.kyc_review_note AS kyc_review_note, c.activated_by AS activated_by,
	    c.activated_at AS activated_at, c.created_at AS created_at,
	    ca.application_reference AS application_reference, ca.account_type AS account_type,
	    ca.phone_country_code AS phone_country_code, ca.phone AS phone,
	    ca.residence_country AS residence_country, ca.full_name AS full_name,
	    ca.date_of_birth AS date_of_birth, ca.nationality AS nationality,
	    ca.legal_name AS legal_name, ca.registration_number AS registration_number,
	    ca.incorporation_country AS incorporation_country, ca.contact_name AS contact_name,
	    ca.contact_role AS contact_role, ca.beneficial_owner_name AS beneficial_owner_name,
	    ca.beneficial_owner_ownership AS beneficial_owner_ownership,
	    ca.kyc_consent_at AS kyc_consent_at, ca.terms_accepted_at AS terms_accepted_at,
	    ca.submitted_at AS application_submitted_at,
	    (SELECT COUNT(*) FROM cregis_wallets cw
	      WHERE cw.tenant_id=c.tenant_id AND cw.customer_id=c.id) AS wallet_count,
	    (SELECT cw.status FROM cregis_wallets cw
	      WHERE cw.tenant_id=c.tenant_id AND cw.customer_id=c.id
	      ORDER BY cw.created_at DESC LIMIT 1) AS wallet_status`
	adminCustomerFrom = ` FROM customers c LEFT JOIN customer_applications ca
	    ON ca.customer_id=c.id AND ca.tenant_id=c.tenant_id`
	reviewCustomerKYCSQL = `UPDATE customers
    SET kyc_status=?, kyc_reviewed_by=?, kyc_reviewed_at=?, kyc_review_note=?, updated_at=?
    WHERE id=? AND tenant_id=? AND kyc_status='pending' AND operations_status='pending'`
	approveCustomerKYCAutomationSQL = `UPDATE customers
    SET kyc_status='approved', kyc_reviewed_by=?, kyc_reviewed_at=?, kyc_review_note=?,
	    operations_status='active',
	    status=CASE WHEN EXISTS (SELECT 1 FROM customer_credentials cc
	      WHERE cc.customer_id=customers.id AND cc.password_salt IS NOT NULL
	        AND cc.password_hash IS NOT NULL AND (
	          (cc.password_algorithm='argon2id-v1' AND cc.password_memory_kib=19456
	            AND cc.password_time_cost=2 AND cc.password_parallelism=1)
	          OR (cc.password_algorithm='pbkdf2-sha256-v1' AND cc.password_iterations=210000)
	        )) THEN 'active' ELSE status END,
	    activated_by=?, activated_at=?, updated_at=?
    WHERE id=? AND tenant_id=? AND kyc_status='pending' AND operations_status='pending'
	  AND status IN ('pending_setup', 'active')`
	auditCustomerKYCReviewSQL = `INSERT INTO customer_auth_audit_events
    (id, customer_id, event_type, actor, metadata_json, created_at)
    SELECT ?, ?, 'customer.kyc_reviewed', ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM customers
      WHERE id=? AND tenant_id=? AND kyc_reviewed_by=? AND kyc_reviewed_at=?)`
	activateCustomerOperationsSQL = `UPDATE customers
	SET operations_status='active',
	    status=CASE WHEN EXISTS (SELECT 1 FROM customer_credentials cc
	      WHERE cc.customer_id=customers.id AND cc.password_salt IS NOT NULL
	        AND cc.password_hash IS NOT NULL AND (
	          (cc.password_algorithm='argon2id-v1' AND cc.password_memory_kib=19456
	            AND cc.password_time_cost=2 AND cc.password_parallelism=1)
	          OR (cc.password_algorithm='pbkdf2-sha256-v1' AND cc.password_iterations=210000)
	        )) THEN 'active' ELSE status END,
	    activated_by=?, activated_at=?, updated_at=?
    WHERE id=? AND tenant_id=? AND kyc_status='approved' AND operations_status='pending'
      AND status IN ('pending_setup', 'active')`
	issueCustomerSetupCredentialSQL = `INSERT INTO customer_credentials
    (customer_id, password_iterations, setup_token_hash, setup_expires_at, updated_at)
    SELECT ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM customers
      WHERE id=? AND tenant_id=? AND status='pending_setup' AND kyc_status='approved'
        AND operations_status='active' AND activated_by=? AND activated_at=?)
    ON CONFLICT(customer_id) DO UPDATE SET
      password_iterations=excluded.password_iterations,
      setup_token_hash=excluded.setup_token_hash,
      setup_expires_at=excluded.setup_expires_at,
      setup_consumed_at=NULL,
      enrollment_token_hash=NULL,
      enrollment_expires_at=NULL,
      updated_at=excluded.updated_at`
	reissueCustomerSetupCredentialSQL = `UPDATE customer_credentials
    SET password_salt=NULL, password_hash=NULL, password_algorithm='pbkdf2-sha256-v1',
      password_iterations=?, password_memory_kib=0, password_time_cost=0,
      password_parallelism=0, password_changed_at=NULL, totp_secret_ciphertext=NULL,
      totp_last_counter=-1, setup_token_hash=?, setup_expires_at=?, setup_consumed_at=NULL,
      enrollment_token_hash=NULL, enrollment_expires_at=NULL, failed_attempts=0,
      locked_until=NULL, credential_version=credential_version+1, updated_at=?
    WHERE customer_id=? AND EXISTS (SELECT 1 FROM customers c
      WHERE c.id=customer_credentials.customer_id AND c.tenant_id=?
        AND c.status='pending_setup' AND c.kyc_status='approved'
        AND c.operations_status='active')`
	auditCustomerActivationSQL = `INSERT INTO customer_auth_audit_events
    (id, customer_id, event_type, actor, metadata_json, created_at)
    SELECT ?, ?, 'customer.operations_activated', ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM customers
      WHERE id=? AND tenant_id=? AND operations_status='active' AND activated_by=? AND activated_at=?)`
)

func adminCustomerRouteID(path, suffix string) string {
	return strings.TrimSuffix(strings.TrimPrefix(path, "/api/v1/admin/customers/"), suffix)
}

func (app *application) listAdminCustomers(w http.ResponseWriter, r *http.Request) {
	rows, err := app.db.Query(r.Context(), `SELECT `+adminCustomerFields+`
	    `+adminCustomerFrom+` WHERE c.tenant_id=? ORDER BY c.created_at DESC LIMIT 200`, app.tenantID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}

func (app *application) adminChangeCustomerPassword(w http.ResponseWriter, r *http.Request, id string) {
	var input struct {
		NewPassword string `json:"new_password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if !safeIdentifier.MatchString(id) || !validCustomerPassword(input.NewPassword) {
		validationError(w)
		return
	}

	rows, err := app.db.Query(r.Context(), `SELECT cc.password_salt, cc.password_hash,
	    cc.password_algorithm, cc.password_iterations, cc.password_memory_kib,
	    cc.password_time_cost, cc.password_parallelism, cc.credential_version
	  FROM customers c JOIN customer_credentials cc ON cc.customer_id=c.id
	  WHERE c.id=? AND c.tenant_id=? AND c.status='active' AND c.kyc_status='approved'
	    AND c.operations_status='active' AND cc.password_salt IS NOT NULL
	    AND cc.password_hash IS NOT NULL`, id, app.tenantID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		conflict(w, "customer_password_change_unavailable")
		return
	}
	if unchanged, _ := app.verifyCustomerPassword(input.NewPassword, rows[0]); unchanged {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error": map[string]string{"code": "password_unchanged"},
		})
		return
	}

	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	credentialVersion := integer(rows[0]["credential_version"])
	newCredentialVersion := credentialVersion + 1
	salt := randomBytes(16)
	passwordHash := app.deriveCustomerArgon2id(input.NewPassword, salt)
	encodedPasswordHash := hex.EncodeToString(passwordHash)
	actor := edgeUser(r)
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_credentials
	  SET password_salt=?, password_hash=?, password_algorithm=?, password_iterations=0,
	      password_memory_kib=?, password_time_cost=?, password_parallelism=?,
	      password_changed_at=?, credential_version=?, failed_attempts=0, locked_until=NULL,
	      updated_at=?
	  WHERE customer_id=? AND credential_version=? AND EXISTS (
	    SELECT 1 FROM customers c WHERE c.id=customer_credentials.customer_id
	      AND c.tenant_id=? AND c.status='active' AND c.kyc_status='approved'
	      AND c.operations_status='active')`, Params: []any{
			hex.EncodeToString(salt), encodedPasswordHash, customerPasswordAlgorithm,
			customerArgonMemoryKiB, customerArgonTimeCost, customerArgonParallelism,
			nowText, newCredentialVersion, nowText, id, credentialVersion, app.tenantID,
		}},
		d1.Statement{SQL: `UPDATE customer_sessions SET revoked_at=?, last_seen_at=?
	  WHERE customer_id=? AND revoked_at IS NULL AND EXISTS (
	    SELECT 1 FROM customer_credentials cc WHERE cc.customer_id=?
	      AND cc.credential_version=? AND cc.password_hash=? AND cc.password_changed_at=?)`, Params: []any{
			nowText, nowText, id, id, newCredentialVersion, encodedPasswordHash, nowText,
		}},
		d1.Statement{SQL: `UPDATE customer_login_challenges SET consumed_at=?
	  WHERE customer_id=? AND consumed_at IS NULL AND EXISTS (
	    SELECT 1 FROM customer_credentials cc WHERE cc.customer_id=?
	      AND cc.credential_version=? AND cc.password_hash=? AND cc.password_changed_at=?)`, Params: []any{
			nowText, id, id, newCredentialVersion, encodedPasswordHash, nowText,
		}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
	  (id, customer_id, event_type, actor, metadata_json, created_at)
	  SELECT ?, ?, 'auth.password_changed_by_admin', ?, ?, ?
	  WHERE EXISTS (SELECT 1 FROM customer_credentials
	    WHERE customer_id=? AND credential_version=? AND password_hash=?
	      AND password_changed_at=?)`, Params: []any{
			randomID("audit"), id, actor,
			mustJSON(map[string]string{"method": "admin_set_password"}), nowText,
			id, newCredentialVersion, encodedPasswordHash, nowText,
		}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 4 || resultChanges(results[:1]) != 1 || resultChanges(results[3:4]) != 1 {
		conflict(w, "customer_password_change_conflict")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"password_changed_at": nowText,
		"sessions_revoked":    resultChanges(results[1:2]),
	})
}

func (app *application) adminReissueCustomerSetupLink(w http.ResponseWriter, r *http.Request, id string) {
	var input struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	reason := strings.TrimSpace(input.Reason)
	if !safeIdentifier.MatchString(id) || reason == "" || len(reason) > 500 {
		validationError(w)
		return
	}

	rows, err := app.db.Query(r.Context(), `SELECT c.status, c.kyc_status, c.operations_status
	  FROM customers c WHERE c.id=? AND c.tenant_id=?`, id, app.tenantID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]string{"code": "customer_not_found"}})
		return
	}
	if text(rows[0]["status"]) != "pending_setup" || text(rows[0]["kyc_status"]) != "approved" ||
		text(rows[0]["operations_status"]) != "active" {
		conflict(w, "customer_setup_reissue_unavailable")
		return
	}

	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	expiresAt := databaseTimestamp(now.Add(customerSetupDuration))
	token := randomToken(32)
	setupHash := tokenHash(token)
	actor := edgeUser(r)
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: reissueCustomerSetupCredentialSQL, Params: []any{
			customerLegacyPasswordIterations, setupHash, expiresAt, nowText, id, app.tenantID,
		}},
		d1.Statement{SQL: `UPDATE customer_sessions SET revoked_at=?, last_seen_at=?
	  WHERE customer_id=? AND revoked_at IS NULL AND EXISTS (
	    SELECT 1 FROM customer_credentials WHERE customer_id=? AND setup_token_hash=?)`, Params: []any{
			nowText, nowText, id, id, setupHash,
		}},
		d1.Statement{SQL: `UPDATE customer_login_challenges SET consumed_at=?
	  WHERE customer_id=? AND consumed_at IS NULL AND EXISTS (
	    SELECT 1 FROM customer_credentials WHERE customer_id=? AND setup_token_hash=?)`, Params: []any{
			nowText, id, id, setupHash,
		}},
		d1.Statement{SQL: `DELETE FROM customer_recovery_codes WHERE customer_id=? AND EXISTS (
	    SELECT 1 FROM customer_credentials WHERE customer_id=? AND setup_token_hash=?)`, Params: []any{
			id, id, setupHash,
		}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
	  (id, customer_id, event_type, actor, metadata_json, created_at)
	  SELECT ?, ?, 'auth.setup_link_reissued', ?, ?, ?
	  WHERE EXISTS (SELECT 1 FROM customer_credentials
	    WHERE customer_id=? AND setup_token_hash=? AND setup_expires_at=?)`, Params: []any{
			randomID("audit"), id, actor,
			mustJSON(map[string]string{"reason": reason, "method": "admin_reissue"}), nowText,
			id, setupHash, expiresAt,
		}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 5 || resultChanges(results[:1]) != 1 || resultChanges(results[4:5]) != 1 {
		conflict(w, "customer_setup_reissue_conflict")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"setup_url":        app.portalURL + "/customer/setup#setup_token=" + url.QueryEscape(token),
		"setup_expires_at": expiresAt,
		"sessions_revoked": resultChanges(results[1:2]),
	})
}

func (app *application) reviewCustomerKYC(w http.ResponseWriter, r *http.Request, id string) {
	var input struct {
		Decision string `json:"decision"`
		Note     string `json:"note"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	note := strings.TrimSpace(input.Note)
	if !safeIdentifier.MatchString(id) || (input.Decision != "approve" && input.Decision != "reject") || len(note) > 1000 {
		validationError(w)
		return
	}
	if input.Decision == "reject" && note == "" {
		conflict(w, "kyc_rejection_reason_required")
		return
	}
	actor := edgeUser(r)
	now := databaseTimestamp(time.Now())
	metadata := mustJSON(map[string]string{"decision": input.Decision, "note": note})
	if input.Decision == "approve" {
		app.approveCustomerKYCAndProvisionWallet(w, r, id, actor, note, metadata, now)
		return
	}
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: reviewCustomerKYCSQL, Params: []any{"rejected", actor, now, nullIfEmpty(note), now, id, app.tenantID}},
		d1.Statement{SQL: auditCustomerKYCReviewSQL, Params: []any{randomID("audit"), id, actor, metadata, now, id, app.tenantID, actor, now}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 2 || resultChanges(results[:1]) != 1 {
		conflict(w, "kyc_not_pending")
		return
	}
	if resultChanges(results[1:2]) != 1 {
		databaseError(app, w, errAuditWrite)
		return
	}
	app.writeAdminCustomer(w, r, id, nil)
}

func automaticWalletIdempotency(customerID string) string {
	return "auto-kyc-" + customerID
}

func automaticWalletAlias(customerID string) string {
	return customerID
}

func walletProvisioningRetryMetadata(provisionErr *walletProvisionError) map[string]any {
	return map[string]any{
		"status":     "retry_required",
		"error_code": provisionErr.code,
	}
}

func sumsubApprovalBlockCode(accountType, verificationStatus, levelName, environment, expectedLevel, expectedEnvironment string, configured bool) string {
	if accountType != "individual" || verificationStatus == "" {
		return ""
	}
	if !configured || levelName != expectedLevel || environment != expectedEnvironment {
		return "sumsub_configuration_mismatch"
	}
	if verificationStatus != "ready_for_admin_review" {
		return "sumsub_verification_not_ready"
	}
	return ""
}

func (app *application) approveCustomerKYCAndProvisionWallet(w http.ResponseWriter, r *http.Request, id, actor, note, metadata, now string) {
	stateSQL := `SELECT c.status, c.kyc_status, c.operations_status,
	  ca.account_type, NULL::text AS sumsub_status, NULL::text AS sumsub_level_name,
	  NULL::text AS sumsub_environment,
	  CASE WHEN EXISTS (SELECT 1 FROM customer_credentials cc WHERE cc.customer_id=c.id
	    AND cc.password_salt IS NOT NULL AND cc.password_hash IS NOT NULL AND (
	      (cc.password_algorithm='argon2id-v1' AND cc.password_memory_kib=? AND cc.password_time_cost=?
	        AND cc.password_parallelism=?)
	      OR (cc.password_algorithm='pbkdf2-sha256-v1' AND cc.password_iterations=?)))
	  THEN 1 ELSE 0 END AS password_ready
	  FROM customers c
	  LEFT JOIN customer_applications ca ON ca.customer_id=c.id AND ca.tenant_id=c.tenant_id
	  WHERE c.id=? AND c.tenant_id=?`
	if app.sumsubSchemaReady {
		stateSQL = `SELECT c.status, c.kyc_status, c.operations_status,
	    ca.account_type, v.status AS sumsub_status, v.level_name AS sumsub_level_name,
	    v.environment AS sumsub_environment,
	    CASE WHEN EXISTS (SELECT 1 FROM customer_credentials cc WHERE cc.customer_id=c.id
	      AND cc.password_salt IS NOT NULL AND cc.password_hash IS NOT NULL AND (
	        (cc.password_algorithm='argon2id-v1' AND cc.password_memory_kib=? AND cc.password_time_cost=?
	          AND cc.password_parallelism=?)
	        OR (cc.password_algorithm='pbkdf2-sha256-v1' AND cc.password_iterations=?)))
	    THEN 1 ELSE 0 END AS password_ready
	    FROM customers c
	    LEFT JOIN customer_applications ca ON ca.customer_id=c.id AND ca.tenant_id=c.tenant_id
	    LEFT JOIN customer_kyc_verifications v ON v.customer_id=c.id AND v.tenant_id=c.tenant_id
	    WHERE c.id=? AND c.tenant_id=?`
	}
	stateRows, err := app.db.Query(r.Context(), stateSQL, customerArgonMemoryKiB,
		customerArgonTimeCost, customerArgonParallelism, customerLegacyPasswordIterations, id, app.tenantID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(stateRows) != 1 {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]string{"code": "customer_not_found"}})
		return
	}
	state := stateRows[0]
	expectedLevel := ""
	if app.sumsub != nil {
		expectedLevel = app.sumsub.LevelName()
	}
	if blockCode := sumsubApprovalBlockCode(text(state["account_type"]), text(state["sumsub_status"]),
		text(state["sumsub_level_name"]), text(state["sumsub_environment"]), expectedLevel,
		app.sumsubEnvironment, app.sumsub != nil); blockCode != "" {
		conflict(w, blockCode)
		return
	}
	kycStatus := text(state["kyc_status"])
	operationsStatus := text(state["operations_status"])
	extra := map[string]any{}
	if kycStatus == "pending" && operationsStatus == "pending" {
		passwordReady := text(state["password_ready"]) == "1" || text(state["password_ready"]) == "true"
		statements := []d1.Statement{
			{SQL: approveCustomerKYCAutomationSQL, Params: []any{actor, now, nullIfEmpty(note), actor, now, now, id, app.tenantID}},
			{SQL: auditCustomerKYCReviewSQL, Params: []any{randomID("audit"), id, actor, metadata, now, id, app.tenantID, actor, now}},
			{SQL: auditCustomerActivationSQL, Params: []any{randomID("audit"), id, actor,
				mustJSON(map[string]string{"trigger": "kyc_approved", "mode": "automatic"}), now,
				id, app.tenantID, actor, now}},
		}
		if text(state["status"]) == "pending_setup" && !passwordReady {
			token := randomToken(32)
			expiresAt := databaseTimestamp(time.Now().Add(customerSetupDuration))
			statements = append(statements, d1.Statement{SQL: issueCustomerSetupCredentialSQL, Params: []any{
				id, customerLegacyPasswordIterations, tokenHash(token), expiresAt, now,
				id, app.tenantID, actor, now,
			}})
			extra["setup_url"] = app.portalURL + "/customer/setup#setup_token=" + url.QueryEscape(token)
			extra["setup_expires_at"] = expiresAt
		} else if text(state["status"]) == "pending_setup" {
			extra["login_ready"] = true
		}
		results, batchErr := app.db.Batch(r.Context(), statements...)
		if batchErr != nil {
			databaseError(app, w, batchErr)
			return
		}
		if len(results) != len(statements) {
			databaseError(app, w, errCustomerStateRead)
			return
		}
		for _, result := range results {
			if resultChanges([]d1.Result{result}) != 1 {
				conflict(w, "kyc_not_pending")
				return
			}
		}
	} else if kycStatus != "approved" || operationsStatus != "active" {
		conflict(w, "kyc_not_pending")
		return
	}

	wallet, _, provisionErr := app.provisionCregisWallet(r.Context(), id,
		automaticWalletAlias(id), automaticWalletIdempotency(id), actor)
	if provisionErr != nil {
		if provisionErr.cause != nil {
			app.logger.Error("automatic wallet provisioning failed after KYC approval",
				"code", provisionErr.code, "error", provisionErr.cause)
		}
		extra["wallet_provisioning"] = walletProvisioningRetryMetadata(provisionErr)
		app.writeAdminCustomer(w, r, id, extra)
		return
	}
	extra["wallet"] = wallet
	app.writeAdminCustomer(w, r, id, extra)
}

func (app *application) activateCustomerOperations(w http.ResponseWriter, r *http.Request, id string) {
	if !safeIdentifier.MatchString(id) {
		validationError(w)
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT `+adminCustomerFields+`
	    `+adminCustomerFrom+` WHERE c.id=? AND c.tenant_id=?`, id, app.tenantID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]string{"code": "customer_not_found"}})
		return
	}
	if text(rows[0]["kyc_status"]) != "approved" {
		conflict(w, "kyc_approval_required")
		return
	}
	status := text(rows[0]["status"])
	if text(rows[0]["operations_status"]) != "pending" || (status != "pending_setup" && status != "active") {
		conflict(w, "customer_not_activatable")
		return
	}
	actor := edgeUser(r)
	now := databaseTimestamp(time.Now())
	credentialRows, err := app.db.Query(r.Context(), `SELECT customer_id FROM customer_credentials
	    WHERE customer_id=? AND password_salt IS NOT NULL AND password_hash IS NOT NULL AND (
	      (password_algorithm='argon2id-v1' AND password_memory_kib=? AND password_time_cost=?
	        AND password_parallelism=?)
	      OR (password_algorithm='pbkdf2-sha256-v1' AND password_iterations=?)
	    )`, id, customerArgonMemoryKiB, customerArgonTimeCost, customerArgonParallelism,
		customerLegacyPasswordIterations)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	passwordReady := len(credentialRows) == 1
	statements := []d1.Statement{
		{SQL: activateCustomerOperationsSQL, Params: []any{actor, now, now, id, app.tenantID}},
	}
	var setup map[string]any
	if status == "pending_setup" && !passwordReady {
		token := randomToken(32)
		expiresAt := databaseTimestamp(time.Now().Add(customerSetupDuration))
		statements = append(statements, d1.Statement{SQL: issueCustomerSetupCredentialSQL, Params: []any{
			id, customerLegacyPasswordIterations, tokenHash(token), expiresAt, now,
			id, app.tenantID, actor, now,
		}})
		setup = map[string]any{
			"setup_url":        app.portalURL + "/customer/setup#setup_token=" + url.QueryEscape(token),
			"setup_expires_at": expiresAt,
		}
	} else if status == "pending_setup" {
		setup = map[string]any{"login_ready": true}
	}
	statements = append(statements, d1.Statement{SQL: auditCustomerActivationSQL, Params: []any{
		randomID("audit"), id, actor, mustJSON(map[string]string{"customer_status": status}), now,
		id, app.tenantID, actor, now,
	}})
	results, err := app.db.Batch(r.Context(), statements...)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != len(statements) || resultChanges(results[:1]) != 1 {
		conflict(w, "customer_not_activatable")
		return
	}
	for _, result := range results[1:] {
		if resultChanges([]d1.Result{result}) != 1 {
			databaseError(app, w, errAuditWrite)
			return
		}
	}
	app.writeAdminCustomer(w, r, id, setup)
}

func (app *application) writeAdminCustomer(w http.ResponseWriter, r *http.Request, id string, extra map[string]any) {
	rows, err := app.db.Query(r.Context(), `SELECT `+adminCustomerFields+`
	    `+adminCustomerFrom+` WHERE c.id=? AND c.tenant_id=?`, id, app.tenantID)
	if err != nil || len(rows) != 1 {
		if err == nil {
			err = errCustomerStateRead
		}
		databaseError(app, w, err)
		return
	}
	for key, value := range extra {
		rows[0][key] = value
	}
	writeJSON(w, http.StatusOK, rows[0])
}
