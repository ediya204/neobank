package main

import (
	"bytes"
	"context"
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

func TestCustomerRegistrationPersistsOnlyPendingApplication(t *testing.T) {
	db := &registrationDatabase{results: []d1.Result{
		{Meta: map[string]any{"changes": float64(1)}},
		{Meta: map[string]any{"changes": float64(1)}},
		{Meta: map[string]any{"changes": float64(1)}},
	}}
	app := &application{
		db: db, tenantID: "tenant_test",
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	response := httptest.NewRecorder()
	app.registerCustomer(response, registrationRequest(validIndividualRegistration()))
	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body=%q", response.Code, response.Body.String())
	}
	if len(db.statements) != 3 {
		t.Fatalf("statements = %d; want 3", len(db.statements))
	}
	combined := strings.ToLower(db.statements[0].SQL + db.statements[1].SQL + db.statements[2].SQL)
	if strings.Contains(combined, "customer_credentials") || strings.Contains(combined, "cregis_") {
		t.Fatal("public registration must not create credentials or invoke wallet settlement tables")
	}
	if !strings.Contains(response.Body.String(), `"status":"pending_review"`) {
		t.Fatalf("response did not preserve pending state: %q", response.Body.String())
	}
}

func TestCustomerRegistrationIsIdempotent(t *testing.T) {
	input := customerRegistrationInput{
		AccountType: "individual", Email: "applicant@example.test", PhoneCountryCode: "+852",
		Phone: "61234567", ResidenceCountry: "HK", FullName: "Test Applicant",
		DateOfBirth: "1990-01-02", Nationality: "HK", KYCConsent: true, TermsAccepted: true,
	}
	db := &registrationDatabase{rows: []map[string]any{{
		"application_reference": "SCC-20260815-ABC123",
		"request_fingerprint":   registrationFingerprint(input),
	}}}
	app := &application{
		db: db, tenantID: "tenant_test",
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	response := httptest.NewRecorder()
	app.registerCustomer(response, registrationRequest(validIndividualRegistration()))
	if response.Code != http.StatusAccepted || len(db.statements) != 0 {
		t.Fatalf("status=%d statements=%d body=%q", response.Code, len(db.statements), response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "SCC-20260815-ABC123") {
		t.Fatalf("idempotent response lost application reference: %q", response.Body.String())
	}
}

func TestCustomerRegistrationRejectsUnderageApplicant(t *testing.T) {
	db := &registrationDatabase{}
	app := &application{
		db: db, tenantID: "tenant_test",
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	response := httptest.NewRecorder()
	body := strings.Replace(validIndividualRegistration(), "1990-01-02", "2020-01-02", 1)
	app.registerCustomer(response, registrationRequest(body))
	if response.Code != http.StatusUnprocessableEntity || len(db.statements) != 0 {
		t.Fatalf("status=%d statements=%d body=%q", response.Code, len(db.statements), response.Body.String())
	}
}
