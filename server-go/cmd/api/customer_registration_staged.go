package main

import (
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
)

const customerEmailResendCooldown = 60 * time.Second

var errRegistrationStateChanged = errors.New("customer registration state changed")

func (app *application) startCustomerRegistration(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email string `json:"email"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Email = normalizeCustomerEmail(input.Email)
	if input.Email == "" {
		fields := []string{}
		if input.Email == "" {
			fields = append(fields, "email")
		}
		customerRegistrationValidationError(w, fields)
		return
	}
	if !app.emailNotifications || len(app.customerPasswordResetSecret) < 32 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": map[string]string{"code": "customer_email_verification_unavailable"}})
		return
	}

	existing, err := app.db.Query(r.Context(), `SELECT c.id, c.email_verified_at, c.created_by,
	    cc.password_hash,
	    ca.application_reference,
	    (SELECT v.created_at FROM customer_email_verification_requests v
	      WHERE v.customer_id=c.id AND v.consumed_at IS NULL AND v.cancelled_at IS NULL
	      ORDER BY v.created_at DESC LIMIT 1) AS latest_verification_created_at
	  FROM customers c
	  JOIN customer_credentials cc ON cc.customer_id=c.id
	  LEFT JOIN customer_applications ca ON ca.customer_id=c.id AND ca.tenant_id=c.tenant_id
	  WHERE c.tenant_id=? AND c.email=? AND c.kyc_status='pending' AND c.operations_status='pending'`, app.tenantID, input.Email)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(existing) == 1 {
		if text(existing[0]["created_by"]) != "public_registration" ||
			text(existing[0]["password_hash"]) != "" || text(existing[0]["application_reference"]) != "" {
			conflict(w, "application_already_exists")
			return
		}
		// Do not issue a registration session from an email address alone. The new
		// verification link is the proof that may resume this draft on any device.
		latest, parseErr := time.Parse(time.RFC3339Nano, text(existing[0]["latest_verification_created_at"]))
		if parseErr != nil || time.Since(latest) >= customerEmailResendCooldown {
			if err := app.queueDraftEmailVerification(r, text(existing[0]["id"]), input.Email); err != nil {
				if errors.Is(err, errRegistrationStateChanged) {
					conflict(w, "email_verification_state_changed")
					return
				}
				databaseError(app, w, err)
				return
			}
		}
		writeJSON(w, http.StatusAccepted, map[string]any{
			"email_verified": false, "email_verification_required": true,
			"application_completed": false,
		})
		return
	}
	if len(existing) != 0 {
		conflict(w, "application_already_exists")
		return
	}

	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	customerID := randomID("customer")
	verificationID := randomID("email_verify")
	_, token, csrfToken, sessionStatement := newCustomerOnboardingSession(customerID, now)
	payload := mustJSON(map[string]string{
		"displayName": "Applicant", "verificationRequestId": verificationID,
	})
	statements := []d1.Statement{
		{SQL: `INSERT INTO customers
		  (id, tenant_id, email, display_name, status, kyc_status, operations_status, created_by, created_at, updated_at)
		  VALUES (?, ?, ?, 'Applicant', 'pending_setup', 'pending', 'pending', 'public_registration', ?, ?)`, Params: []any{
			customerID, app.tenantID, input.Email, nowText, nowText,
		}},
		{SQL: `INSERT INTO customer_credentials
		  (customer_id, password_algorithm, password_iterations, password_memory_kib,
		   password_time_cost, password_parallelism, credential_version, updated_at)
		  VALUES (?, ?, 0, 0, 0, 0, 1, ?)`, Params: []any{
			customerID, customerPasswordAlgorithm, nowText,
		}},
		{SQL: `INSERT INTO customer_email_verification_requests
		  (id, customer_id, email_snapshot, credential_version, expires_at, request_ip_hash,
		   user_agent_hash, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)`, Params: []any{
			verificationID, customerID, input.Email, databaseTimestamp(now.Add(customerEmailVerifyDuration)),
			recoveryContextHash(r.Header.Get("X-Neobank-Source-IP-SHA256")),
			recoveryContextHash(r.Header.Get("X-Neobank-User-Agent-SHA256")), nowText,
		}},
		app.customerEmailOutboxStatement(verificationID, customerID, "CUSTOMER_EMAIL_VERIFICATION", input.Email, payload),
		{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  VALUES (?, ?, 'auth.email_verification_requested', 'public_registration', '{}', ?)`, Params: []any{
			randomID("audit"), customerID, nowText,
		}},
		sessionStatement,
	}
	results, err := app.db.Batch(r.Context(), statements...)
	if err != nil {
		if isExistingCustomerEmailViolation(err) {
			conflict(w, "application_already_exists")
			return
		}
		databaseError(app, w, err)
		return
	}
	if len(results) != len(statements) {
		conflict(w, "registration_start_conflict")
		return
	}
	for _, result := range results {
		if resultChanges([]d1.Result{result}) != 1 {
			conflict(w, "registration_start_conflict")
			return
		}
	}
	app.setOnboardingSessionCookies(w, token, csrfToken, now.Add(onboardingSessionDuration))
	writeJSON(w, http.StatusAccepted, map[string]any{
		"csrf_token": csrfToken, "email_verified": false, "email_verification_required": true,
		"password_ready": false, "application_completed": false,
	})
}

func (app *application) queueDraftEmailVerification(r *http.Request, customerID, email string) error {
	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	verificationID := randomID("email_verify")
	payload := mustJSON(map[string]string{"displayName": "Applicant", "verificationRequestId": verificationID})
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_email_verification_requests SET cancelled_at=?
		  WHERE customer_id=? AND consumed_at IS NULL AND cancelled_at IS NULL`, Params: []any{nowText, customerID}},
		d1.Statement{SQL: `INSERT INTO customer_email_verification_requests
		  (id, customer_id, email_snapshot, credential_version, expires_at, request_ip_hash,
		   user_agent_hash, created_at)
		  SELECT ?, ?, ?, cc.credential_version, ?, ?, ?, ? FROM customer_credentials cc WHERE cc.customer_id=?`, Params: []any{
			verificationID, customerID, email, databaseTimestamp(now.Add(customerEmailVerifyDuration)),
			recoveryContextHash(r.Header.Get("X-Neobank-Source-IP-SHA256")),
			recoveryContextHash(r.Header.Get("X-Neobank-User-Agent-SHA256")), nowText, customerID,
		}},
		app.customerEmailOutboxStatement(verificationID, customerID, "CUSTOMER_EMAIL_VERIFICATION", email, payload),
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  VALUES (?, ?, 'auth.email_verification_requested', 'public_registration', '{}', ?)`, Params: []any{
			randomID("audit"), customerID, nowText,
		}},
	)
	if err != nil {
		return err
	}
	if len(results) != 4 || resultChanges(results[1:2]) != 1 || resultChanges(results[2:3]) != 1 || resultChanges(results[3:4]) != 1 {
		return errRegistrationStateChanged
	}
	return nil
}

func (app *application) setCustomerRegistrationPassword(w http.ResponseWriter, r *http.Request) {
	session, err := app.requireOnboardingMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "onboarding_session_expired"}})
		return
	}
	if !session.EmailVerified {
		conflict(w, "customer_email_verification_required")
		return
	}
	if session.PasswordReady {
		conflict(w, "customer_registration_password_already_set")
		return
	}
	var input struct {
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if !validCustomerPassword(input.Password) {
		customerRegistrationValidationError(w, []string{"password"})
		return
	}
	nowText := databaseTimestamp(time.Now().UTC())
	salt := randomBytes(16)
	hash := app.deriveCustomerArgon2id(input.Password, salt)
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_credentials SET password_salt=?, password_hash=?, password_algorithm=?,
		  password_iterations=0, password_memory_kib=?, password_time_cost=?, password_parallelism=?,
		  password_changed_at=?, updated_at=?
		  WHERE customer_id=? AND password_hash IS NULL
		    AND EXISTS (SELECT 1 FROM customers WHERE id=? AND tenant_id=? AND email_verified_at IS NOT NULL
		      AND kyc_status='pending' AND operations_status='pending')`, Params: []any{
			hex.EncodeToString(salt), hex.EncodeToString(hash), customerPasswordAlgorithm,
			customerArgonMemoryKiB, customerArgonTimeCost, customerArgonParallelism,
			nowText, nowText, session.CustomerID, session.CustomerID, app.tenantID,
		}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  SELECT ?, ?, 'customer.registration_password_set', 'customer', '{}', ?
		  WHERE EXISTS (SELECT 1 FROM customer_credentials WHERE customer_id=? AND password_changed_at=?)`, Params: []any{
			randomID("audit"), session.CustomerID, nowText, session.CustomerID, nowText,
		}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 2 || resultChanges(results[:1]) != 1 || resultChanges(results[1:]) != 1 {
		conflict(w, "registration_password_state_changed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"password_ready": true})
}

func (app *application) completeCustomerRegistration(w http.ResponseWriter, r *http.Request) {
	session, err := app.requireOnboardingMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "onboarding_session_expired"}})
		return
	}
	if !session.EmailVerified {
		conflict(w, "customer_email_verification_required")
		return
	}
	if !session.PasswordReady {
		conflict(w, "customer_registration_password_required")
		return
	}
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if !customerIdempotencyPattern.MatchString(idempotencyKey) {
		validationError(w)
		return
	}
	var input customerRegistrationInput
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Email = session.Email
	input.Password = ""
	if !normalizeRegistrationInputMode(&input, false) {
		customerRegistrationValidationError(w, registrationValidationFields(&input, false))
		return
	}
	fingerprint := app.registrationFingerprint(input)
	existing, err := app.db.Query(r.Context(), `SELECT application_reference, idempotency_key, request_fingerprint
	  FROM customer_applications WHERE customer_id=? AND tenant_id=?`, session.CustomerID, app.tenantID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(existing) == 1 {
		if text(existing[0]["idempotency_key"]) != idempotencyKey || text(existing[0]["request_fingerprint"]) != fingerprint {
			conflict(w, "application_already_exists")
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]any{
			"application_reference": text(existing[0]["application_reference"]), "status": "pending_review",
		})
		return
	}
	if len(existing) != 0 {
		conflict(w, "application_already_exists")
		return
	}

	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	applicationID := randomID("application")
	reference := registrationReference(now)
	displayName := input.FullName
	if input.AccountType == "business" {
		displayName = input.LegalName
	}
	statements := []d1.Statement{
		{SQL: `UPDATE customers SET display_name=?, updated_at=?
		  WHERE id=? AND tenant_id=? AND created_by='public_registration' AND email_verified_at IS NOT NULL
		    AND EXISTS (SELECT 1 FROM customer_credentials cc
		      WHERE cc.customer_id=customers.id AND cc.password_hash IS NOT NULL)
		    AND NOT EXISTS (SELECT 1 FROM customer_applications WHERE customer_id=?)`, Params: []any{
			displayName, nowText, session.CustomerID, app.tenantID, session.CustomerID,
		}},
		{SQL: insertCustomerApplicationSQL, Params: []any{
			applicationID, app.tenantID, session.CustomerID, reference, idempotencyKey, fingerprint,
			input.AccountType, input.PhoneCountryCode, input.Phone, input.ResidenceCountry,
			nullIfEmpty(input.FullName), nullIfEmpty(input.DateOfBirth), nullIfEmpty(input.Nationality),
			nullIfEmpty(input.LegalName), nullIfEmpty(input.RegistrationNumber), nullIfEmpty(input.IncorporationCountry),
			nullIfEmpty(input.ContactName), nullIfEmpty(input.ContactRole), nullIfEmpty(input.BeneficialOwnerName),
			nullIfEmpty(input.BeneficialOwnerOwnership), nowText, nowText, nowText, nowText,
			session.CustomerID, app.tenantID,
		}},
		{SQL: auditCustomerRegistrationSQL, Params: []any{
			randomID("audit"), session.CustomerID,
			mustJSON(map[string]string{"application_reference": reference, "account_type": input.AccountType}),
			nowText, applicationID, session.CustomerID, app.tenantID,
		}},
	}
	if input.AccountType == "individual" && app.sumsub != nil {
		statements = append(statements, newSumsubVerificationStatement(app, randomID("verification"), session.CustomerID, nowText))
	}
	results, err := app.db.Batch(r.Context(), statements...)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != len(statements) {
		conflict(w, "registration_completion_conflict")
		return
	}
	for _, result := range results {
		if resultChanges([]d1.Result{result}) != 1 {
			conflict(w, "registration_completion_conflict")
			return
		}
	}
	response := map[string]any{
		"application_reference": reference, "status": "pending_review", "email_verified": true,
	}
	if input.AccountType == "individual" && app.sumsub != nil {
		response["kyc_provider"] = "sumsub"
		response["kyc_status"] = "initializing"
	}
	writeJSON(w, http.StatusAccepted, response)
}

func (app *application) resendOnboardingEmailVerification(w http.ResponseWriter, r *http.Request) {
	session, err := app.requireOnboardingMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "onboarding_session_expired"}})
		return
	}
	if session.EmailVerified {
		writeJSON(w, http.StatusOK, map[string]any{"email_verified": true})
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT created_at FROM customer_email_verification_requests
	  WHERE customer_id=? AND consumed_at IS NULL AND cancelled_at IS NULL
	  ORDER BY created_at DESC LIMIT 1`, session.CustomerID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	now := time.Now().UTC()
	if len(rows) == 1 {
		createdAt, parseErr := time.Parse(time.RFC3339Nano, text(rows[0]["created_at"]))
		if parseErr == nil && now.Sub(createdAt) < customerEmailResendCooldown {
			retryAfter := int(customerEmailResendCooldown.Seconds() - now.Sub(createdAt).Seconds())
			if retryAfter < 1 {
				retryAfter = 1
			}
			w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
			writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": map[string]string{"code": "email_verification_rate_limited"}})
			return
		}
	}
	nowText := databaseTimestamp(now)
	verificationID := randomID("email_verify")
	payload := mustJSON(map[string]string{"displayName": "Applicant", "verificationRequestId": verificationID})
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_email_verification_requests SET cancelled_at=?
		  WHERE customer_id=? AND consumed_at IS NULL AND cancelled_at IS NULL`, Params: []any{nowText, session.CustomerID}},
		d1.Statement{SQL: `INSERT INTO customer_email_verification_requests
		  (id, customer_id, email_snapshot, credential_version, expires_at, request_ip_hash,
		   user_agent_hash, created_at)
		  SELECT ?, ?, ?, cc.credential_version, ?, ?, ?, ? FROM customer_credentials cc WHERE cc.customer_id=?`, Params: []any{
			verificationID, session.CustomerID, session.Email, databaseTimestamp(now.Add(customerEmailVerifyDuration)),
			recoveryContextHash(r.Header.Get("X-Neobank-Source-IP-SHA256")),
			recoveryContextHash(r.Header.Get("X-Neobank-User-Agent-SHA256")), nowText, session.CustomerID,
		}},
		app.customerEmailOutboxStatement(verificationID, session.CustomerID, "CUSTOMER_EMAIL_VERIFICATION", session.Email, payload),
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  VALUES (?, ?, 'auth.email_verification_requested', 'customer_onboarding', '{}', ?)`, Params: []any{
			randomID("audit"), session.CustomerID, nowText,
		}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 4 || resultChanges(results[1:2]) != 1 || resultChanges(results[2:3]) != 1 || resultChanges(results[3:4]) != 1 {
		conflict(w, "email_verification_state_changed")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"email_verification_sent": true})
}
