package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	postgresdb "github.com/ediya204/neobank/server-go/internal/postgres"
)

type adminOpeningDB struct {
	databaseClient
	params  []any
	queries int
}

func (db *adminOpeningDB) Query(_ context.Context, sql string, params ...any) ([]map[string]any, error) {
	db.queries++
	if sql == adminOpeningSQL {
		db.params = params
		return []map[string]any{{"id": params[0]}}, nil
	}
	if strings.Contains(sql, "SELECT ca.customer_id") {
		if db.params == nil {
			return nil, nil
		}
		return []map[string]any{{"customer_id": db.params[0], "request_fingerprint": db.params[15],
			"status": "active", "kyc_status": "approved", "operations_status": "active", "created_by": adminOpeningSource}}, nil
	}
	return []map[string]any{{"id": db.params[0], "email": db.params[2], "status": "active",
		"kyc_status": "approved", "operations_status": "active", "created_by": adminOpeningSource}}, nil
}

func TestAdminOpeningCreatesPasswordAndAllowsLoginWithoutKYC(t *testing.T) {
	for _, accountType := range []string{"individual", "business"} {
		t.Run(accountType, func(t *testing.T) {
			db := &adminOpeningDB{}
			app := &application{db: db, tenantID: "tenant_test", customerPasswordPepper: []byte("test-pepper")}
			input := customerRegistrationInput{AccountType: accountType, Email: "CLIENT@example.test",
				Password: "Test-Password-12345", PhoneCountryCode: "+852", Phone: "5123 4567", ResidenceCountry: "HK"}
			if accountType == "individual" {
				input.FullName, input.DateOfBirth, input.Nationality = "Test Customer", "1990-01-01", "HK"
			} else {
				input.LegalName, input.RegistrationNumber, input.IncorporationCountry = "Test Company", "TEST-123", "HK"
				input.ContactName, input.ContactRole = "Test Contact", "Director"
				input.BeneficialOwnerName, input.BeneficialOwnerOwnership = "Test Owner", "100"
			}
			payload, _ := json.Marshal(input)
			submit := func() *httptest.ResponseRecorder {
				r := httptest.NewRequest(http.MethodPost, "/api/v1/admin/customers", strings.NewReader(string(payload)))
				r.Header.Set("Content-Type", "application/json")
				r.Header.Set("Idempotency-Key", "admin-opening-test-1234")
				r.Header.Set("X-Neobank-User", "admin_test")
				w := httptest.NewRecorder()
				app.openAdminCustomer(w, r)
				return w
			}
			w := submit()
			if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"login_ready":true`) {
				t.Fatalf("opening response: %d %s", w.Code, w.Body.String())
			}
			if strings.Contains(w.Body.String(), input.Password) {
				t.Fatal("password leaked")
			}
			if len(db.params) != 31 || db.params[1] != app.tenantID || db.params[4] != "admin_test" {
				t.Fatal("missing scoped atomic opening")
			}
			credentials := map[string]any{"password_salt": db.params[6], "password_hash": db.params[7],
				"password_algorithm": db.params[8], "password_memory_kib": db.params[9],
				"password_time_cost": db.params[10], "password_parallelism": db.params[11]}
			if valid, _ := app.verifyCustomerPassword(input.Password, credentials); !valid {
				t.Fatal("password cannot authenticate")
			}
			if valid, _ := app.verifyCustomerPassword("incorrect", credentials); valid {
				t.Fatal("wrong password accepted")
			}
			if code := customerLoginStateCode(map[string]any{"created_by": adminOpeningSource,
				"status": "active", "kyc_status": "approved", "operations_status": "active"}); code != "" {
				t.Fatal(code)
			}
			id := db.params[0]
			w = submit()
			if w.Code != http.StatusOK || db.params[0] != id {
				t.Fatal("retry did not reuse customer")
			}
			input.Password = "Changed-Password-12345"
			payload, _ = json.Marshal(input)
			if w = submit(); w.Code != http.StatusConflict {
				t.Fatal("changed retry accepted")
			}
		})
	}
}

func TestAdminOpeningPermissionAndValidation(t *testing.T) {
	for _, role := range []string{adminRoleSuperAdmin, adminRoleCompliance, adminRoleOperations, adminRoleReadOnly} {
		allowed := adminRequestPermitted(&adminSession{AccessRole: role}, http.MethodPost, "/api/v1/admin/customers")
		if allowed != (role == adminRoleSuperAdmin) {
			t.Fatalf("unexpected opening permission: %s", role)
		}
	}
	input := customerRegistrationInput{AccountType: "individual", Password: "weak"}
	if normalizeAdminOpening(&input) || input.KYCConsent || input.TermsAccepted {
		t.Fatal("invalid input or fabricated consent")
	}
	if customerLoginStateCode(map[string]any{"created_by": "public_registration", "status": "active",
		"kyc_status": "approved", "operations_status": "active"}) != "customer_email_verification_required" {
		t.Fatal("public registration gate was weakened")
	}
}

func TestAdminOpeningPostgresLogin(t *testing.T) {
	url := os.Getenv("ADMIN_OPENING_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("ADMIN_OPENING_TEST_DATABASE_URL is not set")
	}
	if !strings.Contains(url, "@127.0.0.1:") {
		t.Fatal("requires isolated loopback PostgreSQL")
	}
	db, err := postgresdb.New(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	app := &application{db: db, tenantID: randomID("test_tenant"),
		customerPasswordPepper: []byte("test-password-pepper"), logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	payload := `{"account_type":"individual","email":"opening@example.test","password":"Opening-Password-12345","phone_country_code":"+852","phone":"51234567","residence_country":"HK","full_name":"Test Customer","date_of_birth":"1990-01-01","nationality":"HK"}`
	r := httptest.NewRequest(http.MethodPost, "/api/v1/admin/customers", strings.NewReader(payload))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Idempotency-Key", randomID("test_opening_request"))
	r.Header.Set("X-Neobank-User", "test_admin")
	w := httptest.NewRecorder()
	app.openAdminCustomer(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("create status %d: %s", w.Code, w.Body.String())
	}
	rows, err := db.Query(context.Background(), `SELECT c.email_verified_at,c.kyc_reviewed_at,
      ca.kyc_consent_at,ca.terms_accepted_at,cc.password_hash,
      (SELECT COUNT(*) FROM customer_auth_audit_events e WHERE e.customer_id=c.id AND e.event_type='customer.admin_opened') AS audit_count
      FROM customers c JOIN customer_credentials cc ON cc.customer_id=c.id
      JOIN customer_applications ca ON ca.customer_id=c.id WHERE c.tenant_id=?`, app.tenantID)
	if err != nil || len(rows) != 1 {
		t.Fatalf("atomic record: %v", err)
	}
	row := rows[0]
	if text(row["email_verified_at"]) != "" || text(row["kyc_reviewed_at"]) != "" || text(row["kyc_consent_at"]) != "" || text(row["terms_accepted_at"]) != "" || integer(row["audit_count"]) != 1 {
		t.Fatal("fabricated verification/consent or missing audit")
	}
	login := httptest.NewRequest(http.MethodPost, "/api/auth/customer/login", strings.NewReader(`{"email":"opening@example.test","password":"Opening-Password-12345"}`))
	login.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	app.customerLogin(w, login)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"next_step":"authenticated"`) || len(w.Result().Cookies()) == 0 {
		t.Fatalf("login status %d: %s", w.Code, w.Body.String())
	}
	// Force a later application constraint failure and prove the customer and
	// credentials from the same PostgreSQL statement cannot survive it.
	capture := &adminOpeningDB{}
	mock := *app
	mock.db = capture
	r = httptest.NewRequest(http.MethodPost, "/api/v1/admin/customers", strings.NewReader(payload))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Idempotency-Key", randomID("test_rollback_request"))
	mock.openAdminCustomer(httptest.NewRecorder(), r)
	capture.params[2] = "rollback@example.test"
	capture.params[16] = "invalid_account_type"
	if _, err = db.Query(context.Background(), adminOpeningSQL, capture.params...); err == nil {
		t.Fatal("invalid application accepted")
	}
	remaining, err := db.Query(context.Background(), "SELECT id FROM customers WHERE id=?", capture.params[0])
	if err != nil || len(remaining) != 0 {
		t.Fatal("failed opening left a partial customer")
	}
}
