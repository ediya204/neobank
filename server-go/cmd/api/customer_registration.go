package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
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
)

type customerRegistrationInput struct {
	AccountType              string `json:"account_type"`
	Email                    string `json:"email"`
	Password                 string `json:"password"`
	PhoneCountryCode         string `json:"phone_country_code"`
	Phone                    string `json:"phone"`
	ResidenceCountry         string `json:"residence_country"`
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

	if input.Email == "" || !validCustomerPassword(input.Password) ||
		!customerPhoneCodePattern.MatchString(input.PhoneCountryCode) ||
		!customerPhonePattern.MatchString(input.Phone) ||
		!customerCountryPattern.MatchString(input.ResidenceCountry) ||
		!input.KYCConsent || !input.TermsAccepted {
		return false
	}
	if input.AccountType == "individual" {
		birthDate, err := time.Parse("2006-01-02", input.DateOfBirth)
		adultCutoff := time.Now().UTC().AddDate(-18, 0, 0)
		return err == nil && !birthDate.After(adultCutoff) &&
			validRegistrationText(input.FullName, 100) &&
			customerCountryPattern.MatchString(input.Nationality) &&
			input.LegalName == "" && input.RegistrationNumber == "" &&
			input.IncorporationCountry == "" && input.ContactName == "" &&
			input.ContactRole == "" && input.BeneficialOwnerName == "" &&
			input.BeneficialOwnerOwnership == ""
	}
	if input.AccountType == "business" {
		ownership, err := strconv.ParseFloat(input.BeneficialOwnerOwnership, 64)
		return err == nil && ownership > 0 && ownership <= 100 &&
			validRegistrationText(input.LegalName, 160) &&
			validRegistrationText(input.RegistrationNumber, 100) &&
			customerCountryPattern.MatchString(input.IncorporationCountry) &&
			validRegistrationText(input.ContactName, 100) &&
			validRegistrationText(input.ContactRole, 100) &&
			validRegistrationText(input.BeneficialOwnerName, 100) &&
			input.FullName == "" && input.DateOfBirth == "" && input.Nationality == ""
	}
	return false
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
	return "SCC-" + now.UTC().Format("20060102") + "-" + strings.ToUpper(hex.EncodeToString(randomBytes(6)))
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
		validationError(w)
		return
	}
	fingerprint := app.registrationFingerprint(input)
	existing, err := app.db.Query(r.Context(), `SELECT application_reference, request_fingerprint
	    FROM customer_applications WHERE tenant_id=? AND idempotency_key=?`, app.tenantID, idempotencyKey)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(existing) != 0 {
		if text(existing[0]["request_fingerprint"]) != fingerprint {
			conflict(w, "idempotency_payload_mismatch")
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]any{
			"application_reference": text(existing[0]["application_reference"]),
			"status":                "pending_review",
		})
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
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `INSERT OR IGNORE INTO customers
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
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 4 || resultChanges(results[:1]) != 1 ||
		resultChanges(results[1:2]) != 1 || resultChanges(results[2:3]) != 1 ||
		resultChanges(results[3:4]) != 1 {
		conflict(w, "application_already_exists")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"application_reference": reference,
		"status":                "pending_review",
	})
}
