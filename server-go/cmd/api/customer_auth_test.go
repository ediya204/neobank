package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/hex"
	"fmt"
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

func (db *customerLoginDatabase) Query(context.Context, string, ...any) ([]map[string]any, error) {
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
		"status": "active", "password_salt": hex.EncodeToString(salt),
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
	combined := ""
	for _, statement := range db.statements {
		combined += statement.SQL
	}
	if strings.Contains(combined, "customer_login_challenges") {
		t.Fatal("password-only registration login must not create a TOTP challenge")
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
