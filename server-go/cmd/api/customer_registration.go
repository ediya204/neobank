package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	insertCustomerApplicationSQL = `INSERT OR IGNORE INTO customer_applications
	    (id, tenant_id, customer_id, application_reference, idempotency_key, request_fingerprint,
	     account_type, phone_country_code, phone, residence_country, full_name, date_of_birth,
	     nationality, legal_name, registration_number, incorporation_country, contact_name,
	     contact_role, beneficial_owner_name, beneficial_owner_ownership, kyc_consent_at,
	     terms_accepted_at, submitted_at, updated_at)
	    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
	    WHERE EXISTS (SELECT 1 FROM customers
	      WHERE id=? AND tenant_id=? AND status='pending_setup' AND kyc_status='pending'
	        AND operations_status='pending')`
	auditCustomerRegistrationSQL = `INSERT INTO customer_auth_audit_events
	    (id, customer_id, event_type, actor, metadata_json, created_at)
	    SELECT ?, ?, 'customer.registration_submitted', 'public_registration', ?, ?
	    WHERE EXISTS (SELECT 1 FROM customer_applications
	      WHERE id=? AND customer_id=? AND tenant_id=?)`
)

var (
	customerCountryPattern     = regexp.MustCompile(`^[A-Z]{2}$`)
	customerPhoneCodePattern   = regexp.MustCompile(`^\+[1-9][0-9]{0,3}$`)
	customerPhonePattern       = regexp.MustCompile(`^[0-9]{6,20}$`)
	customerIdempotencyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$`)
	englishLegalNamePattern    = regexp.MustCompile(`^[A-Za-z]+(?:[ '-][A-Za-z]+)*$`)
)

type customerRegistrationInput struct {
	AccountType              string `json:"account_type"`
	Email                    string `json:"email"`
	Password                 string `json:"password"`
	PhoneCountryCode         string `json:"phone_country_code"`
	Phone                    string `json:"phone"`
	ResidenceCountry         string `json:"residence_country"`
	FamilyName               string `json:"family_name"`
	GivenName                string `json:"given_name"`
	FullName                 string `json:"full_name"`
	DateOfBirth              string `json:"date_of_birth"`
	Nationality              string `json:"nationality"`
	LegalName                string `json:"legal_name"`
	RegistrationNumber       string `json:"registration_number"`
	IncorporationCountry     string `json:"incorporation_country"`
	ContactName              string `json:"contact_name"`
	ContactRole              string `json:"contact_role"`
	BeneficialOwnerName      string `json:"beneficial_owner_name"`
	BeneficialOwnerOwnership string `json:"beneficial_owner_ownership"`
	KYCConsent               bool   `json:"kyc_consent"`
	TermsAccepted            bool   `json:"terms_accepted"`
}

func normalizeRegistrationInput(input *customerRegistrationInput) bool {
	return normalizeRegistrationInputMode(input, true)
}

func normalizeRegistrationInputMode(input *customerRegistrationInput, requirePassword bool) bool {
	input.AccountType = strings.ToLower(strings.TrimSpace(input.AccountType))
	input.Email = normalizeCustomerEmail(input.Email)
	input.PhoneCountryCode = strings.TrimSpace(input.PhoneCountryCode)
	input.Phone = strings.Map(func(value rune) rune {
		if value >= '0' && value <= '9' {
			return value
		}
		return -1
	}, input.Phone)
	input.ResidenceCountry = strings.ToUpper(strings.TrimSpace(input.ResidenceCountry))
	input.FamilyName = strings.TrimSpace(input.FamilyName)
	input.GivenName = strings.TrimSpace(input.GivenName)
	input.FullName = strings.TrimSpace(input.FullName)
	input.DateOfBirth = strings.TrimSpace(input.DateOfBirth)
	input.Nationality = strings.ToUpper(strings.TrimSpace(input.Nationality))
	input.LegalName = strings.TrimSpace(input.LegalName)
	input.RegistrationNumber = strings.TrimSpace(input.RegistrationNumber)
	input.IncorporationCountry = strings.ToUpper(strings.TrimSpace(input.IncorporationCountry))
	input.ContactName = strings.TrimSpace(input.ContactName)
	input.ContactRole = strings.TrimSpace(input.ContactRole)
	input.BeneficialOwnerName = strings.TrimSpace(input.BeneficialOwnerName)
	input.BeneficialOwnerOwnership = strings.TrimSpace(input.BeneficialOwnerOwnership)

	fields := registrationValidationFields(input, requirePassword)
	if len(fields) == 0 && input.AccountType == "individual" &&
		(input.FamilyName != "" || input.GivenName != "") {
		input.FullName = input.GivenName + " " + input.FamilyName
	}
	return len(fields) == 0
}

func registrationValidationFields(input *customerRegistrationInput, requirePassword bool) []string {
	fields := make([]string, 0, 8)
	add := func(field string) {
		for _, existing := range fields {
			if existing == field {
				return
			}
		}
		fields = append(fields, field)
	}

	if input.AccountType != "individual" && input.AccountType != "business" {
		add("account_type")
	}
	if input.Email == "" {
		add("email")
	}
	if requirePassword && !validCustomerPassword(input.Password) {
		add("password")
	}
	if !customerPhoneCodePattern.MatchString(input.PhoneCountryCode) {
		add("phone_country_code")
	}
	if !customerPhonePattern.MatchString(input.Phone) {
		add("phone")
	}
	if !customerCountryPattern.MatchString(input.ResidenceCountry) {
		add("residence_country")
	}
	if !input.KYCConsent {
		add("kyc_consent")
	}
	if !input.TermsAccepted {
		add("terms_accepted")
	}

	if input.AccountType == "individual" {
		if input.FamilyName != "" || input.GivenName != "" {
			if input.FullName != "" || !validEnglishLegalName(input.FamilyName, 50) {
				add("family_name")
			}
			if input.FullName != "" || !validEnglishLegalName(input.GivenName, 50) {
				add("given_name")
			}
		} else if !validEnglishLegalName(input.FullName, 100) {
			add("family_name")
			add("given_name")
		}
		birthDate, err := time.Parse("2006-01-02", input.DateOfBirth)
		adultCutoff := time.Now().UTC().AddDate(-18, 0, 0)
		if err != nil || birthDate.After(adultCutoff) {
			add("date_of_birth")
		}
		if !customerCountryPattern.MatchString(input.Nationality) {
			add("nationality")
		}
		if input.LegalName != "" || input.RegistrationNumber != "" ||
			input.IncorporationCountry != "" || input.ContactName != "" ||
			input.ContactRole != "" || input.BeneficialOwnerName != "" ||
			input.BeneficialOwnerOwnership != "" {
			add("account_type")
		}
	}
	if input.AccountType == "business" {
		ownership, err := strconv.ParseFloat(input.BeneficialOwnerOwnership, 64)
		if err != nil || ownership <= 0 || ownership > 100 {
			add("beneficial_owner_ownership")
		}
		if !validRegistrationText(input.LegalName, 160) {
			add("legal_name")
		}
		if !validRegistrationText(input.RegistrationNumber, 100) {
			add("registration_number")
		}
		if !customerCountryPattern.MatchString(input.IncorporationCountry) {
			add("incorporation_country")
		}
		if !validRegistrationText(input.ContactName, 100) {
			add("contact_name")
		}
		if !validRegistrationText(input.ContactRole, 100) {
			add("contact_role")
		}
		if !validRegistrationText(input.BeneficialOwnerName, 100) {
			add("beneficial_owner_name")
		}
		if input.FamilyName != "" || input.GivenName != "" || input.FullName != "" ||
			input.DateOfBirth != "" || input.Nationality != "" {
			add("account_type")
		}
	}
	return fields
}

func customerRegistrationValidationError(w http.ResponseWriter, fields []string) {
	writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
		"error": map[string]any{
			"code":    "validation_error",
			"details": map[string]any{"fields": fields},
		},
	})
}

func validEnglishLegalName(value string, maximum int) bool {
	return value != "" && len(value) <= maximum && englishLegalNamePattern.MatchString(value)
}

func validRegistrationText(value string, maximum int) bool {
	return value != "" && len([]rune(value)) <= maximum
}

func (app *application) registrationFingerprint(input customerRegistrationInput) string {
	encoded, _ := json.Marshal(input)
	mac := hmac.New(sha256.New, app.customerPasswordPepper)
	_, _ = mac.Write([]byte("neobank-customer-registration-v1\x00"))
	_, _ = mac.Write(encoded)
	return hex.EncodeToString(mac.Sum(nil))
}

func registrationReference(now time.Time) string {
	return "SSC-" + now.UTC().Format("20060102") + "-" + strings.ToUpper(hex.EncodeToString(randomBytes(6)))
}

func isExistingCustomerEmailViolation(err error) bool {
	var postgresErr *pgconn.PgError
	return errors.As(err, &postgresErr) && postgresErr.Code == "23505" &&
		postgresErr.TableName == "customers" &&
		postgresErr.ConstraintName == "customers_tenant_id_email_key"
}

func (app *application) registerCustomer(w http.ResponseWriter, r *http.Request) {
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if !customerIdempotencyPattern.MatchString(idempotencyKey) {
		validationError(w)
		return
	}
	var input customerRegistrationInput
	if !decodeJSON(w, r, &input) {
		return
	}
	if !normalizeRegistrationInput(&input) {
		customerRegistrationValidationError(w, registrationValidationFields(&input, true))
		return
	}
	fingerprint := app.registrationFingerprint(input)
	existingSQL := `SELECT ca.application_reference, ca.request_fingerprint, ca.customer_id, ca.account_type,
	    c.email_verified_at,
	    0 AS has_sumsub_verification, '' AS sumsub_status
	    FROM customer_applications ca JOIN customers c ON c.id=ca.customer_id AND c.tenant_id=ca.tenant_id
	    WHERE ca.tenant_id=? AND ca.idempotency_key=?`
	if app.sumsubSchemaReady {
		existingSQL = `SELECT ca.application_reference, ca.request_fingerprint, ca.customer_id, ca.account_type,
	      c.email_verified_at,
	      CASE WHEN v.id IS NOT NULL AND c.kyc_status='pending' AND c.operations_status='pending' THEN 1 ELSE 0 END AS has_sumsub_verification,
	      COALESCE(v.status, '') AS sumsub_status
	      FROM customer_applications ca
	      JOIN customers c ON c.id=ca.customer_id AND c.tenant_id=ca.tenant_id
	      LEFT JOIN customer_kyc_verifications v ON v.tenant_id=ca.tenant_id AND v.customer_id=ca.customer_id
	      WHERE ca.tenant_id=? AND ca.idempotency_key=?`
	}
	existing, err := app.db.Query(r.Context(), existingSQL, app.tenantID, idempotencyKey)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(existing) != 0 {
		if text(existing[0]["request_fingerprint"]) != fingerprint {
			conflict(w, "idempotency_payload_mismatch")
			return
		}
		response := map[string]any{
			"application_reference":       text(existing[0]["application_reference"]),
			"status":                      "pending_review",
			"email_verification_required": text(existing[0]["email_verified_at"]) == "",
		}
		if app.sumsub != nil && text(existing[0]["account_type"]) == "individual" && integer(existing[0]["has_sumsub_verification"]) == 1 {
			now := time.Now().UTC()
			_, token, csrfToken, sessionStatement := newCustomerOnboardingSession(text(existing[0]["customer_id"]), now)
			results, sessionErr := app.db.Batch(r.Context(), sessionStatement)
			if sessionErr != nil || len(results) != 1 || resultChanges(results) != 1 {
				if sessionErr == nil {
					sessionErr = fmt.Errorf("unexpected onboarding session result")
				}
				databaseError(app, w, sessionErr)
				return
			}
			app.setOnboardingSessionCookies(w, token, csrfToken, now.Add(onboardingSessionDuration))
			response["csrf_token"] = csrfToken
			response["kyc_provider"] = "sumsub"
			response["kyc_status"] = text(existing[0]["sumsub_status"])
		}
		writeJSON(w, http.StatusAccepted, response)
		return
	}
	existingCustomer, err := app.db.Query(r.Context(), `SELECT id FROM customers
	    WHERE tenant_id=? AND email=? LIMIT 1`, app.tenantID, input.Email)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(existingCustomer) != 0 {
		conflict(w, "application_already_exists")
		return
	}
	if !app.emailNotifications || len(app.customerPasswordResetSecret) < 32 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": map[string]string{"code": "customer_email_verification_unavailable"}})
		return
	}

	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	customerID := randomID("customer")
	applicationID := randomID("application")
	reference := registrationReference(now)
	displayName := input.FullName
	if input.AccountType == "business" {
		displayName = input.LegalName
	}
	passwordSalt := randomBytes(16)
	passwordHash := app.deriveCustomerArgon2id(input.Password, passwordSalt)
	emailVerificationID := randomID("email_verify")
	emailVerificationPayload := mustJSON(map[string]string{
		"displayName": displayName, "verificationRequestId": emailVerificationID,
	})
	statements := []d1.Statement{
		d1.Statement{SQL: `INSERT INTO customers
	      (id, tenant_id, email, display_name, status, kyc_status, operations_status, created_by, created_at, updated_at)
	      VALUES (?, ?, ?, ?, 'pending_setup', 'pending', 'pending', ?, ?, ?)`, Params: []any{
			customerID, app.tenantID, input.Email, displayName, "public_registration", nowText, nowText,
		}},
		d1.Statement{SQL: `INSERT INTO customer_credentials
	      (customer_id, password_salt, password_hash, password_algorithm, password_iterations,
	       password_memory_kib, password_time_cost, password_parallelism, password_changed_at,
	       credential_version, updated_at)
	      SELECT ?, ?, ?, ?, 0, ?, ?, ?, ?, 1, ?
	      WHERE EXISTS (SELECT 1 FROM customers
	        WHERE id=? AND tenant_id=? AND status='pending_setup' AND kyc_status='pending'
	          AND operations_status='pending')`, Params: []any{
			customerID, hex.EncodeToString(passwordSalt), hex.EncodeToString(passwordHash),
			customerPasswordAlgorithm, customerArgonMemoryKiB, customerArgonTimeCost,
			customerArgonParallelism, nowText, nowText, customerID, app.tenantID,
		}},
		d1.Statement{SQL: insertCustomerApplicationSQL, Params: []any{
			applicationID, app.tenantID, customerID, reference, idempotencyKey, fingerprint,
			input.AccountType, input.PhoneCountryCode, input.Phone, input.ResidenceCountry,
			nullIfEmpty(input.FullName), nullIfEmpty(input.DateOfBirth), nullIfEmpty(input.Nationality),
			nullIfEmpty(input.LegalName), nullIfEmpty(input.RegistrationNumber), nullIfEmpty(input.IncorporationCountry),
			nullIfEmpty(input.ContactName), nullIfEmpty(input.ContactRole), nullIfEmpty(input.BeneficialOwnerName),
			nullIfEmpty(input.BeneficialOwnerOwnership), nowText, nowText, nowText, nowText,
			customerID, app.tenantID,
		}},
		d1.Statement{SQL: auditCustomerRegistrationSQL, Params: []any{
			randomID("audit"), customerID,
			mustJSON(map[string]string{"application_reference": reference, "account_type": input.AccountType}),
			nowText, applicationID, customerID, app.tenantID,
		}},
		d1.Statement{SQL: `INSERT INTO customer_email_verification_requests
	      (id, customer_id, email_snapshot, credential_version, expires_at, request_ip_hash,
	       user_agent_hash, created_at)
	      SELECT ?, ?, ?, 1, ?, ?, ?, ?
	      WHERE EXISTS (SELECT 1 FROM customers WHERE id=? AND tenant_id=? AND created_by='public_registration')`, Params: []any{
			emailVerificationID, customerID, input.Email, databaseTimestamp(now.Add(customerEmailVerifyDuration)),
			recoveryContextHash(r.Header.Get("X-Neobank-Source-IP-SHA256")),
			recoveryContextHash(r.Header.Get("X-Neobank-User-Agent-SHA256")), nowText, customerID, app.tenantID,
		}},
		app.customerEmailOutboxStatement(emailVerificationID, customerID, "CUSTOMER_EMAIL_VERIFICATION", input.Email, emailVerificationPayload),
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
	      (id, customer_id, event_type, actor, metadata_json, created_at)
	      SELECT ?, ?, 'auth.email_verification_requested', 'public_registration', '{}', ?
	      WHERE EXISTS (SELECT 1 FROM customer_email_verification_requests WHERE id=?)`, Params: []any{
			randomID("audit"), customerID, nowText, emailVerificationID,
		}},
	}
	var onboardingToken string
	var onboardingCSRFToken string
	if input.AccountType == "individual" && app.sumsub != nil {
		verificationID := randomID("verification")
		statements = append(statements, newSumsubVerificationStatement(app, verificationID, customerID, nowText))
		var sessionStatement d1.Statement
		_, onboardingToken, onboardingCSRFToken, sessionStatement = newCustomerOnboardingSession(customerID, now)
		statements = append(statements, sessionStatement)
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
		conflict(w, "application_already_exists")
		return
	}
	for _, result := range results {
		if resultChanges([]d1.Result{result}) != 1 {
			conflict(w, "application_already_exists")
			return
		}
	}
	response := map[string]any{
		"application_reference":       reference,
		"status":                      "pending_review",
		"email_verification_required": true,
	}
	if onboardingToken != "" {
		app.setOnboardingSessionCookies(w, onboardingToken, onboardingCSRFToken, now.Add(onboardingSessionDuration))
		response["csrf_token"] = onboardingCSRFToken
		response["kyc_provider"] = "sumsub"
		response["kyc_status"] = "initializing"
	}
	writeJSON(w, http.StatusAccepted, response)
}
