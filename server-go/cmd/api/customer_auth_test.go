package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
)

type customerLoginDatabase struct {
	rows       []map[string]any
	statements []d1.Statement
	queries    []string
}

type sessionTouchDatabase struct {
	rows         []map[string]any
	batchChanges float64
	queryCalls   int
	batchCalls   int
	statements   []d1.Statement
}

func (db *sessionTouchDatabase) Query(context.Context, string, ...any) ([]map[string]any, error) {
	db.queryCalls++
	return db.rows, nil
}

func (db *sessionTouchDatabase) Batch(_ context.Context, statements ...d1.Statement) ([]d1.Result, error) {
	db.batchCalls++
	db.statements = append(db.statements, statements...)
	results := make([]d1.Result, len(statements))
	for index := range results {
		results[index] = d1.Result{Meta: map[string]any{"changes": db.batchChanges}}
	}
	return results, nil
}

func (db *customerLoginDatabase) Query(_ context.Context, query string, _ ...any) ([]map[string]any, error) {
	db.queries = append(db.queries, query)
	return db.rows, nil
}

func (db *customerLoginDatabase) Batch(_ context.Context, statements ...d1.Statement) ([]d1.Result, error) {
	db.statements = append(db.statements, statements...)
	results := make([]d1.Result, len(statements))
	for index := range results {
		results[index] = d1.Result{Meta: map[string]any{"changes": float64(1)}}
	}
	return results, nil
}

func TestRecoverySessionRequiresFreshlyConsumedCode(t *testing.T) {
	for _, required := range []string{
		"SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?",
		"customer_recovery_codes",
		"customer_login_challenges",
		"credential_version=?",
		"used_at=?",
	} {
		if !strings.Contains(recoveryCustomerSessionSQL, required) {
			t.Fatalf("recovery session SQL must contain %q", required)
		}
	}
}

func TestDatabaseTimestampSortsLexically(t *testing.T) {
	first := time.Date(2026, 8, 13, 10, 0, 0, 100_000_000, time.UTC)
	second := first.Add(20 * time.Millisecond)
	if databaseTimestamp(first) >= databaseTimestamp(second) {
		t.Fatal("database timestamps must preserve chronological text ordering")
	}
}

func TestCustomerSessionConcurrentTouchRemainsAuthenticated(t *testing.T) {
	now := time.Now().UTC()
	token := strings.Repeat("t", 32)
	csrf := strings.Repeat("c", 32)
	db := &sessionTouchDatabase{batchChanges: 0, rows: []map[string]any{{
		"id": "session_test", "customer_id": "customer_test", "csrf_hash": tokenHash(csrf),
		"credential_version": int64(1), "current_credential_version": int64(1),
		"expires_at":      databaseTimestamp(now.Add(time.Hour)),
		"idle_expires_at": databaseTimestamp(now.Add(30 * time.Minute)),
		"last_seen_at":    databaseTimestamp(now.Add(-time.Minute)),
		"email":           "customer@example.test", "display_name": "Customer", "status": "active",
	}}}
	app := &application{db: db, portalURL: "http://localhost:3000", tenantID: "neobank"}
	request := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	request.AddCookie(&http.Cookie{Name: app.customerCookieName(), Value: token})
	request.AddCookie(&http.Cookie{Name: app.customerCSRFCookieName(), Value: csrf})
	session, _, err := app.loadCustomerSession(request)
	if err != nil || session == nil {
		t.Fatalf("concurrent customer session touch must remain valid: %v", err)
	}
	if db.batchCalls != 1 || db.queryCalls != 2 || !strings.Contains(db.statements[0].SQL, "last_seen_at<?") {
		t.Fatalf("expected conditional touch plus validity recheck, batch=%d query=%d", db.batchCalls, db.queryCalls)
	}
}

func TestRoleScopedSessionReadsSelectRequestedIdentity(t *testing.T) {
	now := time.Now().UTC()
	adminToken := strings.Repeat("a", 32)
	adminCSRF := strings.Repeat("b", 32)
	customerToken := strings.Repeat("c", 32)
	customerCSRF := strings.Repeat("d", 32)

	t.Run("customer", func(t *testing.T) {
		db := &sessionTouchDatabase{rows: []map[string]any{{
			"id": "customer_session", "customer_id": "customer_test", "csrf_hash": tokenHash(customerCSRF),
			"credential_version": int64(1), "current_credential_version": int64(1),
			"expires_at": databaseTimestamp(now.Add(time.Hour)), "idle_expires_at": databaseTimestamp(now.Add(time.Hour)),
			"last_seen_at": databaseTimestamp(now), "email": "customer@example.test", "display_name": "Customer",
			"status": "active", "totp_enabled": false,
		}}}
		app := &application{db: db, portalURL: "http://localhost:3000", tenantID: "neobank"}
		request := httptest.NewRequest(http.MethodGet, "/api/auth/customer/me", nil)
		request.AddCookie(&http.Cookie{Name: app.adminCookieName(), Value: adminToken})
		request.AddCookie(&http.Cookie{Name: app.adminCSRFCookieName(), Value: adminCSRF})
		request.AddCookie(&http.Cookie{Name: app.customerCookieName(), Value: customerToken})
		request.AddCookie(&http.Cookie{Name: app.customerCSRFCookieName(), Value: customerCSRF})
		response := httptest.NewRecorder()

		app.auth(response, request)

		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"role":"customer"`) {
			t.Fatalf("customer scoped me status=%d body=%q", response.Code, response.Body.String())
		}
	})

	t.Run("admin", func(t *testing.T) {
		db := &sessionTouchDatabase{rows: []map[string]any{{
			"id": "admin_session", "user_id": "admin_test", "csrf_hash": tokenHash(adminCSRF),
			"credential_version": int64(1), "current_credential_version": int64(1),
			"expires_at": databaseTimestamp(now.Add(time.Hour)), "last_seen_at": databaseTimestamp(now),
			"email": "admin@example.test", "display_name": "Admin", "access_role": adminRoleSuperAdmin,
		}}}
		app := &application{db: db, portalURL: "http://localhost:3000"}
		request := httptest.NewRequest(http.MethodGet, "/api/auth/admin/me", nil)
		request.AddCookie(&http.Cookie{Name: app.adminCookieName(), Value: adminToken})
		request.AddCookie(&http.Cookie{Name: app.adminCSRFCookieName(), Value: adminCSRF})
		request.AddCookie(&http.Cookie{Name: app.customerCookieName(), Value: customerToken})
		request.AddCookie(&http.Cookie{Name: app.customerCSRFCookieName(), Value: customerCSRF})
		response := httptest.NewRecorder()

		app.auth(response, request)

		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"role":"admin"`) {
			t.Fatalf("admin scoped me status=%d body=%q", response.Code, response.Body.String())
		}
	})
}

func TestRoleScopedLogoutPreservesOtherRoleCookies(t *testing.T) {
	now := time.Now().UTC()
	adminToken := strings.Repeat("a", 32)
	adminCSRF := strings.Repeat("b", 32)
	customerToken := strings.Repeat("c", 32)
	customerCSRF := strings.Repeat("d", 32)
	db := &sessionTouchDatabase{batchChanges: 1, rows: []map[string]any{{
		"id": "customer_session", "customer_id": "customer_test", "csrf_hash": tokenHash(customerCSRF),
		"credential_version": int64(1), "current_credential_version": int64(1),
		"expires_at": databaseTimestamp(now.Add(time.Hour)), "idle_expires_at": databaseTimestamp(now.Add(time.Hour)),
		"last_seen_at": databaseTimestamp(now), "email": "customer@example.test", "display_name": "Customer",
		"status": "active", "totp_enabled": false,
	}}}
	app := &application{db: db, portalURL: "http://localhost:3000", tenantID: "neobank"}
	request := httptest.NewRequest(http.MethodPost, "/api/auth/customer/logout", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", app.portalURL)
	request.Header.Set("X-CSRF-Token", customerCSRF)
	request.AddCookie(&http.Cookie{Name: app.adminCookieName(), Value: adminToken})
	request.AddCookie(&http.Cookie{Name: app.adminCSRFCookieName(), Value: adminCSRF})
	request.AddCookie(&http.Cookie{Name: app.customerCookieName(), Value: customerToken})
	request.AddCookie(&http.Cookie{Name: app.customerCSRFCookieName(), Value: customerCSRF})
	response := httptest.NewRecorder()

	app.auth(response, request)

	setCookies := strings.Join(response.Header().Values("Set-Cookie"), "\n")
	if response.Code != http.StatusOK {
		t.Fatalf("customer scoped logout status=%d body=%q", response.Code, response.Body.String())
	}
	if !strings.Contains(setCookies, "neobank_customer=") || !strings.Contains(setCookies, "neobank_csrf=") {
		t.Fatalf("customer cookies were not cleared: %q", setCookies)
	}
	if strings.Contains(setCookies, "neobank_admin=") || strings.Contains(setCookies, "neobank_admin_csrf=") {
		t.Fatalf("customer logout must preserve admin cookies: %q", setCookies)
	}
}

func TestConfiguredOriginValidation(t *testing.T) {
	if !validConfiguredOrigin("https://customer.example.com", false) {
		t.Fatal("expected HTTPS origin to pass")
	}
	if !validConfiguredOrigin("http://localhost:3000", true) {
		t.Fatal("expected explicitly allowed local HTTP origin to pass")
	}
	for _, value := range []string{"http://example.com", "https://user@example.com", "https://example.com/path", "https://example.com?token=x"} {
		if validConfiguredOrigin(value, false) {
			t.Fatalf("expected unsafe origin to fail: %s", value)
		}
	}
}

func TestCustomerPasswordPolicy(t *testing.T) {
	if !validCustomerPassword("Correct-Horse-7-Battery") {
		t.Fatal("expected strong password to pass")
	}
	for _, password := range []string{"short-A1!", "alllowercase-password-7!", "ALLUPPERCASE-PASSWORD-7!", "NoDigits-In-Password!"} {
		if validCustomerPassword(password) {
			t.Fatalf("expected password to fail policy: %q", password)
		}
	}
}

func TestCustomerArgonPasswordDerivationUsesPepperAndSalt(t *testing.T) {
	app := &application{customerPasswordPepper: []byte("0123456789abcdef0123456789abcdef")}
	first := app.deriveCustomerArgon2id("Correct-Horse-7-Battery", []byte("0123456789abcdef"))
	second := app.deriveCustomerArgon2id("Correct-Horse-7-Battery", []byte("fedcba9876543210"))
	if hmac.Equal(first, second) {
		t.Fatal("different salts must produce different hashes")
	}
}

func TestApprovedRegistrationCanLoginDirectlyWithPassword(t *testing.T) {
	pepper := []byte("0123456789abcdef0123456789abcdef")
	password := "Correct-Horse-7-Battery!"
	salt := []byte("0123456789abcdef")
	app := &application{customerPasswordPepper: pepper, tenantID: "tenant_test", portalURL: "http://localhost:3000"}
	hash := app.deriveCustomerArgon2id(password, salt)
	db := &customerLoginDatabase{rows: []map[string]any{{
		"id": "customer_test", "email": "applicant@example.test", "display_name": "Test Applicant",
		"status": "active", "kyc_status": "approved", "operations_status": "active",
		"created_by": "public_registration", "email_verified_at": databaseTimestamp(time.Now().UTC()),
		"password_salt": hex.EncodeToString(salt),
		"password_hash": hex.EncodeToString(hash), "password_algorithm": customerPasswordAlgorithm,
		"password_iterations": int64(0), "password_memory_kib": int64(customerArgonMemoryKiB),
		"password_time_cost": int64(customerArgonTimeCost), "password_parallelism": int64(customerArgonParallelism),
		"credential_version": int64(1), "failed_attempts": int64(0), "locked_until": "",
		"totp_secret_ciphertext": nil,
	}}}
	app.db = db
	request := httptest.NewRequest(http.MethodPost, "/api/auth/customer/login", bytes.NewBufferString(
		`{"email":"applicant@example.test","password":"Correct-Horse-7-Battery!"}`,
	))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	app.customerLogin(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"next_step":"authenticated"`) {
		t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
	}
	if len(response.Result().Cookies()) != 2 {
		t.Fatalf("expected session and CSRF cookies, got %d", len(response.Result().Cookies()))
	}
	if len(db.queries) == 0 || strings.Contains(db.queries[0], "c.kyc_status='approved'") {
		t.Fatal("login must load the password credential before returning an eligible account state")
	}
	combined := ""
	for _, statement := range db.statements {
		combined += statement.SQL
	}
	if strings.Contains(combined, "customer_login_challenges") {
		t.Fatal("password-only registration login must not create a TOTP challenge")
	}
}

func TestPendingApprovalStatusRequiresCorrectPassword(t *testing.T) {
	pepper := []byte("0123456789abcdef0123456789abcdef")
	password := "Correct-Horse-7-Battery!"
	salt := []byte("0123456789abcdef")
	app := &application{
		customerPasswordPepper: pepper, tenantID: "tenant_test", portalURL: "http://localhost:3000",
		sumsubSchemaReady: true, logger: slog.Default(),
	}
	hash := app.deriveCustomerArgon2id(password, salt)
	pendingRow := map[string]any{
		"id": "customer_pending", "email": "pending@example.test", "display_name": "Pending Customer",
		"status": "pending_setup", "kyc_status": "pending", "operations_status": "pending",
		"created_by": "public_registration", "email_verified_at": databaseTimestamp(time.Now().UTC()),
		"sumsub_status": "ready_for_admin_review", "password_salt": hex.EncodeToString(salt),
		"password_hash": hex.EncodeToString(hash), "password_algorithm": customerPasswordAlgorithm,
		"password_iterations": int64(0), "password_memory_kib": int64(customerArgonMemoryKiB),
		"password_time_cost": int64(customerArgonTimeCost), "password_parallelism": int64(customerArgonParallelism),
		"credential_version": int64(1), "failed_attempts": int64(0), "locked_until": "",
	}

	t.Run("correct password returns pending approval", func(t *testing.T) {
		db := &customerLoginDatabase{rows: []map[string]any{pendingRow}}
		app.db = db
		request := httptest.NewRequest(http.MethodPost, "/api/auth/customer/login", bytes.NewBufferString(
			`{"email":"pending@example.test","password":"Correct-Horse-7-Battery!"}`,
		))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		app.customerLogin(response, request)
		if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "customer_approval_pending") {
			t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
		}
		if len(db.statements) != 0 {
			t.Fatal("pending status response must not create a login session or failed-attempt audit")
		}
	})

	t.Run("wrong password remains generic", func(t *testing.T) {
		db := &customerLoginDatabase{rows: []map[string]any{pendingRow}}
		app.db = db
		request := httptest.NewRequest(http.MethodPost, "/api/auth/customer/login", bytes.NewBufferString(
			`{"email":"pending@example.test","password":"Wrong-Horse-7-Battery!"}`,
		))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		app.customerLogin(response, request)
		if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "invalid_email_or_password") ||
			strings.Contains(response.Body.String(), "customer_approval_pending") {
			t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
		}
		if len(db.statements) != 2 {
			t.Fatalf("wrong pending password should record one failed attempt and audit; statements=%d", len(db.statements))
		}
	})
}

func TestCustomerLoginStateCodes(t *testing.T) {
	tests := []struct {
		name string
		row  map[string]any
		want string
	}{
		{name: "email verification", row: map[string]any{"created_by": "public_registration"}, want: "customer_email_verification_required"},
		{name: "sumsub pending", row: map[string]any{"email_verified_at": "verified", "kyc_status": "pending", "sumsub_status": "provider_reviewing"}, want: "customer_verification_pending"},
		{name: "resubmission", row: map[string]any{"email_verified_at": "verified", "kyc_status": "pending", "sumsub_status": "resubmission_required"}, want: "customer_verification_resubmission_required"},
		{name: "rejected", row: map[string]any{"email_verified_at": "verified", "kyc_status": "pending", "sumsub_status": "provider_rejected"}, want: "customer_verification_rejected"},
		{name: "admin approval", row: map[string]any{"email_verified_at": "verified", "kyc_status": "pending", "sumsub_status": "ready_for_admin_review"}, want: "customer_approval_pending"},
		{name: "activation", row: map[string]any{"email_verified_at": "verified", "kyc_status": "approved", "operations_status": "pending", "status": "pending_setup"}, want: "customer_activation_pending"},
		{name: "active", row: map[string]any{"email_verified_at": "verified", "kyc_status": "approved", "operations_status": "active", "status": "active"}, want: ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := customerLoginStateCode(test.row); got != test.want {
				t.Fatalf("customerLoginStateCode()=%q want=%q", got, test.want)
			}
		})
	}
}

func TestActiveCustomerCanEnrollTOTPWithoutStoringPendingSecret(t *testing.T) {
	pepper := []byte("0123456789abcdef0123456789abcdef")
	password := "Correct-Horse-7-Battery!"
	salt := []byte("0123456789abcdef")
	token := strings.Repeat("t", 32)
	csrf := strings.Repeat("c", 32)
	now := time.Now().UTC()
	app := &application{
		customerPasswordPepper: pepper,
		customerTOTPKey:        []byte("0123456789abcdef0123456789abcdef"),
		customerRecoveryPepper: []byte("abcdef0123456789abcdef0123456789"),
		tenantID:               "tenant_test",
		portalURL:              "http://localhost:3000",
	}
	hash := app.deriveCustomerArgon2id(password, salt)
	db := &customerLoginDatabase{rows: []map[string]any{{
		"id": "session_test", "customer_id": "customer_test", "csrf_hash": tokenHash(csrf),
		"credential_version": int64(1), "current_credential_version": int64(1),
		"expires_at":      databaseTimestamp(now.Add(time.Hour)),
		"idle_expires_at": databaseTimestamp(now.Add(30 * time.Minute)),
		"last_seen_at":    databaseTimestamp(now),
		"email":           "customer@example.test", "display_name": "Customer", "status": "active",
		"totp_enabled": false, "totp_secret_ciphertext": nil,
		"password_salt": hex.EncodeToString(salt), "password_hash": hex.EncodeToString(hash),
		"password_algorithm": customerPasswordAlgorithm, "password_iterations": int64(0),
		"password_memory_kib": int64(customerArgonMemoryKiB), "password_time_cost": int64(customerArgonTimeCost),
		"password_parallelism": int64(customerArgonParallelism),
	}}}
	app.db = db

	startRequest := httptest.NewRequest(http.MethodPost, "/api/auth/customer/totp/enroll/start", bytes.NewBufferString(
		`{"current_password":"Correct-Horse-7-Battery!"}`,
	))
	startRequest.Header.Set("Content-Type", "application/json")
	startRequest.Header.Set("Origin", app.portalURL)
	startRequest.Header.Set("X-CSRF-Token", csrf)
	startRequest.AddCookie(&http.Cookie{Name: app.customerCookieName(), Value: token})
	startRequest.AddCookie(&http.Cookie{Name: app.customerCSRFCookieName(), Value: csrf})
	startResponse := httptest.NewRecorder()
	app.startCustomerTOTPEnrollment(startResponse, startRequest)
	if startResponse.Code != http.StatusOK {
		t.Fatalf("start enrollment status=%d body=%q", startResponse.Code, startResponse.Body.String())
	}
	var startPayload map[string]any
	if err := json.Unmarshal(startResponse.Body.Bytes(), &startPayload); err != nil {
		t.Fatal(err)
	}
	secret := text(startPayload["secret"])
	enrollmentToken := text(startPayload["enrollment_token"])
	if secret == "" || enrollmentToken == "" || strings.Contains(enrollmentToken, secret) {
		t.Fatal("enrollment must return a secret and an opaque bound token")
	}
	for _, statement := range db.statements {
		if strings.Contains(statement.SQL, "UPDATE customer_credentials") {
			t.Fatal("starting enrollment must not persist or activate the pending TOTP secret")
		}
	}

	code := totpCodeForTest(t, secret, time.Now().UTC())
	verifyRequest := httptest.NewRequest(http.MethodPost, "/api/auth/customer/totp/enroll/verify", bytes.NewBufferString(
		fmt.Sprintf(`{"enrollment_token":%q,"code":%q}`, enrollmentToken, code),
	))
	verifyRequest.Header.Set("Content-Type", "application/json")
	verifyRequest.Header.Set("Origin", app.portalURL)
	verifyRequest.Header.Set("X-CSRF-Token", csrf)
	verifyRequest.AddCookie(&http.Cookie{Name: app.customerCookieName(), Value: token})
	verifyRequest.AddCookie(&http.Cookie{Name: app.customerCSRFCookieName(), Value: csrf})
	verifyResponse := httptest.NewRecorder()
	app.verifyActiveCustomerTOTPEnrollment(verifyResponse, verifyRequest)
	if verifyResponse.Code != http.StatusOK || !strings.Contains(verifyResponse.Body.String(), `"totp_enabled":true`) {
		t.Fatalf("verify enrollment status=%d body=%q", verifyResponse.Code, verifyResponse.Body.String())
	}
	var verifyPayload map[string]any
	if err := json.Unmarshal(verifyResponse.Body.Bytes(), &verifyPayload); err != nil {
		t.Fatal(err)
	}
	if codes, ok := verifyPayload["recovery_codes"].([]any); !ok || len(codes) != 10 {
		t.Fatalf("expected ten one-time recovery codes, got %#v", verifyPayload["recovery_codes"])
	}
}

func TestCustomerTOTPEnrollmentTokenRejectsTampering(t *testing.T) {
	app := &application{
		tenantID:        "tenant_test",
		customerTOTPKey: []byte("0123456789abcdef0123456789abcdef"),
	}
	token, err := app.encryptCustomerTOTPEnrollment(customerTOTPEnrollment{
		CustomerID: "customer_test", Secret: "JBSWY3DPEHPK3PXP", CredentialVersion: 1,
		ExpiresAt: time.Now().Add(time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := app.decryptCustomerTOTPEnrollment(token)
	if err != nil || decoded.CustomerID != "customer_test" {
		t.Fatalf("valid enrollment token failed: %#v %v", decoded, err)
	}
	last := token[len(token)-1]
	replacement := byte('A')
	if last == replacement {
		replacement = 'B'
	}
	if _, err := app.decryptCustomerTOTPEnrollment(token[:len(token)-1] + string(replacement)); err == nil {
		t.Fatal("tampered enrollment token must fail authentication")
	}
}

func TestLegacyPasswordVerificationRequestsArgonUpgrade(t *testing.T) {
	app := &application{customerPasswordPepper: []byte("0123456789abcdef0123456789abcdef")}
	salt := []byte("0123456789abcdef")
	hash, err := app.deriveLegacyCustomerPassword("Correct-Horse-7-Battery", salt)
	if err != nil {
		t.Fatal(err)
	}
	valid, upgrade := app.verifyCustomerPassword("Correct-Horse-7-Battery", map[string]any{
		"password_salt":       hex.EncodeToString(salt),
		"password_hash":       hex.EncodeToString(hash),
		"password_algorithm":  "pbkdf2-sha256-v1",
		"password_iterations": int64(customerLegacyPasswordIterations),
	})
	if !valid || !upgrade {
		t.Fatal("valid legacy password must authenticate and request an Argon2id upgrade")
	}
}

func TestArgonPasswordVerificationRejectsWrongParameters(t *testing.T) {
	app := &application{customerPasswordPepper: []byte("0123456789abcdef0123456789abcdef")}
	salt := []byte("0123456789abcdef")
	hash := app.deriveCustomerArgon2id("Correct-Horse-7-Battery", salt)
	row := map[string]any{
		"password_salt":        hex.EncodeToString(salt),
		"password_hash":        hex.EncodeToString(hash),
		"password_algorithm":   customerPasswordAlgorithm,
		"password_memory_kib":  int32(customerArgonMemoryKiB),
		"password_time_cost":   int32(customerArgonTimeCost),
		"password_parallelism": int32(customerArgonParallelism),
	}
	valid, upgrade := app.verifyCustomerPassword("Correct-Horse-7-Battery", row)
	if !valid || upgrade {
		t.Fatal("current Argon2id record must authenticate without an upgrade")
	}
	row["password_memory_kib"] = int64(1)
	valid, _ = app.verifyCustomerPassword("Correct-Horse-7-Battery", row)
	if valid {
		t.Fatal("unsupported Argon2id parameters must fail closed")
	}
}

func TestIntegerSupportsPGXIntegerTypes(t *testing.T) {
	tests := []struct {
		value    any
		expected int64
	}{
		{value: int8(1), expected: 1},
		{value: int16(2), expected: 2},
		{value: int32(3), expected: 3},
		{value: int64(4), expected: 4},
		{value: int(5), expected: 5},
	}
	for _, test := range tests {
		if actual := integer(test.value); actual != test.expected {
			t.Fatalf("integer(%T(%v)) = %d; want %d", test.value, test.value, actual, test.expected)
		}
	}
}

func TestCustomerTOTPEncryptionRoundTrip(t *testing.T) {
	app := &application{
		tenantID:        "test-tenant",
		customerTOTPKey: []byte("0123456789abcdef0123456789abcdef"),
	}
	secret := "JBSWY3DPEHPK3PXP"
	encrypted, err := app.encryptCustomerTOTP(secret)
	if err != nil {
		t.Fatal(err)
	}
	if encrypted == secret {
		t.Fatal("TOTP secret must not be stored as plaintext")
	}
	decrypted, err := app.decryptCustomerTOTP(encrypted)
	if err != nil {
		t.Fatal(err)
	}
	if decrypted != secret {
		t.Fatalf("unexpected decrypted secret: %s", decrypted)
	}
}

func TestVerifyCustomerTOTPCode(t *testing.T) {
	secret := "JBSWY3DPEHPK3PXP"
	now := time.Unix(1_800_000_000, 0)
	code := totpCodeForTest(t, secret, now)
	counter, valid := verifyTOTPCode(secret, code, now, -1)
	if !valid {
		t.Fatal("expected current TOTP code to verify")
	}
	if _, replayed := verifyTOTPCode(secret, code, now, counter); replayed {
		t.Fatal("accepted TOTP counter must not be reusable")
	}
	if _, accepted := verifyTOTPCode(secret, "000000", now, -1); accepted && code != "000000" {
		t.Fatal("unexpected invalid TOTP acceptance")
	}
}

func TestChallengeSessionsRequireAtomicSecurityState(t *testing.T) {
	for name, sql := range map[string]string{
		"totp":       totpCustomerSessionSQL,
		"enrollment": enrollmentCustomerSessionSQL,
	} {
		for _, required := range []string{"credential_version=?", "totp_last_counter=?"} {
			if !strings.Contains(sql, required) {
				t.Fatalf("%s session SQL must contain %q", name, required)
			}
		}
	}
}

func totpCodeForTest(t *testing.T, secret string, now time.Time) string {
	t.Helper()
	decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	if err != nil {
		t.Fatal(err)
	}
	counter := uint64(now.Unix() / 30)
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
	return fmt.Sprintf("%06d", value%1_000_000)
}
