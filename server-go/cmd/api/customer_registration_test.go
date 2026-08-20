package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ediya204/neobank/server-go/internal/d1"
)

type registrationDatabase struct {
	rows       []map[string]any
	statements []d1.Statement
	results    []d1.Result
}

func (db *registrationDatabase) Query(context.Context, string, ...any) ([]map[string]any, error) {
	return db.rows, nil
}

func (db *registrationDatabase) Batch(_ context.Context, statements ...d1.Statement) ([]d1.Result, error) {
	db.statements = statements
	return db.results, nil
}

func registrationRequest(body string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, "/api/auth/customer/register", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", "registration-test-key-0001")
	return request
}

func validIndividualRegistration() string {
	return `{
		"account_type":"individual",
		"email":"Applicant@Example.test",
		"password":"Correct-Horse-7-Battery!",
		"phone_country_code":"+852",
		"phone":"6123 4567",
		"residence_country":"hk",
		"full_name":"Test Applicant",
		"date_of_birth":"1990-01-02",
		"nationality":"hk",
		"legal_name":"",
		"registration_number":"",
		"incorporation_country":"",
		"contact_name":"",
		"contact_role":"",
		"beneficial_owner_name":"",
		"beneficial_owner_ownership":"",
		"kyc_consent":true,
		"terms_accepted":true
	}`
}

func TestCustomerRegistrationPersistsPendingApplicationAndPasswordCredential(t *testing.T) {
	db := &registrationDatabase{results: []d1.Result{
		{Meta: map[string]any{"changes": float64(1)}},
		{Meta: map[string]any{"changes": float64(1)}},
		{Meta: map[string]any{"changes": float64(1)}},
		{Meta: map[string]any{"changes": float64(1)}},
		{Meta: map[string]any{"changes": float64(1)}},
		{Meta: map[string]any{"changes": float64(1)}},
		{Meta: map[string]any{"changes": float64(1)}},
	}}
	app := &application{
		db: db, tenantID: "tenant_test", emailNotifications: true,
		customerPasswordPepper:      []byte("0123456789abcdef0123456789abcdef"),
		customerPasswordResetSecret: []byte("abcdef0123456789abcdef0123456789"),
		logger:                      slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	response := httptest.NewRecorder()
	app.registerCustomer(response, registrationRequest(validIndividualRegistration()))
	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body=%q", response.Code, response.Body.String())
	}
	if len(db.statements) != 7 {
		t.Fatalf("statements = %d; want 7", len(db.statements))
	}
	combined := ""
	for _, statement := range db.statements {
		combined += strings.ToLower(statement.SQL)
	}
	if !strings.Contains(combined, "customer_credentials") || strings.Contains(combined, "cregis_") {
		t.Fatal("public registration must create only the pending password credential and no wallet data")
	}
	if !strings.Contains(combined, "customer_email_verification_requests") ||
		!strings.Contains(combined, `"emailoutbox"`) ||
		!strings.Contains(strings.Join(anyStrings(db.statements[5].Params), " "), "CUSTOMER_EMAIL_VERIFICATION") {
		t.Fatal("public registration must queue email verification before activation")
	}
	credentialParams := db.statements[1].Params
	if strings.Contains(strings.Join(anyStrings(credentialParams), " "), "Correct-Horse") {
		t.Fatal("plaintext registration password must never be sent to storage")
	}
	if !strings.Contains(response.Body.String(), `"status":"pending_review"`) {
		t.Fatalf("response did not preserve pending state: %q", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"email_verification_required":true`) {
		t.Fatalf("response did not disclose email verification gate: %q", response.Body.String())
	}
}

func TestCustomerRegistrationFailsClosedWithoutEmailVerificationDelivery(t *testing.T) {
	app := &application{
		db: &registrationDatabase{}, tenantID: "tenant_test",
		customerPasswordPepper: []byte("0123456789abcdef0123456789abcdef"),
		logger:                 slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	response := httptest.NewRecorder()
	app.registerCustomer(response, registrationRequest(validIndividualRegistration()))
	if response.Code != http.StatusServiceUnavailable ||
		!strings.Contains(response.Body.String(), "customer_email_verification_unavailable") {
		t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
	}
}

func TestCustomerRegistrationIsIdempotent(t *testing.T) {
	input := customerRegistrationInput{
		AccountType: "individual", Email: "applicant@example.test", PhoneCountryCode: "+852",
		Phone: "61234567", ResidenceCountry: "HK", FullName: "Test Applicant",
		DateOfBirth: "1990-01-02", Nationality: "HK", Password: "Correct-Horse-7-Battery!",
		KYCConsent: true, TermsAccepted: true,
	}
	app := &application{
		tenantID:               "tenant_test",
		customerPasswordPepper: []byte("0123456789abcdef0123456789abcdef"),
		logger:                 slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	db := &registrationDatabase{rows: []map[string]any{{
		"application_reference": "SSC-20260815-ABC123",
		"request_fingerprint":   app.registrationFingerprint(input),
	}}}
	app.db = db
	response := httptest.NewRecorder()
	app.registerCustomer(response, registrationRequest(validIndividualRegistration()))
	if response.Code != http.StatusAccepted || len(db.statements) != 0 {
		t.Fatalf("status=%d statements=%d body=%q", response.Code, len(db.statements), response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "SSC-20260815-ABC123") {
		t.Fatalf("idempotent response lost application reference: %q", response.Body.String())
	}
}

func TestCustomerRegistrationRejectsUnderageApplicant(t *testing.T) {
	db := &registrationDatabase{}
	app := &application{
		db: db, tenantID: "tenant_test",
		customerPasswordPepper: []byte("0123456789abcdef0123456789abcdef"),
		logger:                 slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	response := httptest.NewRecorder()
	body := strings.Replace(validIndividualRegistration(), "1990-01-02", "2020-01-02", 1)
	app.registerCustomer(response, registrationRequest(body))
	if response.Code != http.StatusUnprocessableEntity || len(db.statements) != 0 {
		t.Fatalf("status=%d statements=%d body=%q", response.Code, len(db.statements), response.Body.String())
	}
}

func anyStrings(values []any) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, fmt.Sprint(value))
	}
	return result
}
