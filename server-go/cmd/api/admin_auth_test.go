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
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	postgresdb "github.com/ediya204/neobank/server-go/internal/postgres"
)

func TestAdminPasswordDerivationIsDomainSeparated(t *testing.T) {
	pepper := []byte("0123456789abcdef0123456789abcdef")
	app := &application{adminPasswordPepper: pepper, customerPasswordPepper: pepper}
	salt := []byte("0123456789abcdef")
	adminHash := app.deriveAdminPassword("Correct-Horse-7-Battery!", salt)
	customerHash := app.deriveCustomerArgon2id("Correct-Horse-7-Battery!", salt)
	if hmac.Equal(adminHash, customerHash) {
		t.Fatal("admin and customer password domains must not share derived hashes")
	}
	row := map[string]any{"password_salt": hex.EncodeToString(salt), "password_hash": hex.EncodeToString(adminHash)}
	if !app.verifyAdminPassword("Correct-Horse-7-Battery!", row) || app.verifyAdminPassword("wrong-password", row) {
		t.Fatal("admin password verification result is incorrect")
	}
}

func TestAdminSessionRecentReadsDoNotContendOnTouch(t *testing.T) {
	now := time.Now().UTC()
	token := strings.Repeat("t", 32)
	csrf := strings.Repeat("c", 32)
	db := &sessionTouchDatabase{rows: []map[string]any{{
		"id": "admin_session_test", "user_id": "admin_test", "csrf_hash": tokenHash(csrf),
		"credential_version": int64(1), "current_credential_version": int64(1),
		"expires_at": databaseTimestamp(now.Add(time.Hour)), "last_seen_at": databaseTimestamp(now),
		"email": "admin@example.test", "display_name": "Admin",
	}}}
	app := &application{db: db, portalURL: "http://localhost:3000"}
	request := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	request.AddCookie(&http.Cookie{Name: app.adminCookieName(), Value: token})
	request.AddCookie(&http.Cookie{Name: app.adminCSRFCookieName(), Value: csrf})
	session, _, err := app.loadAdminSession(request)
	if err != nil || session == nil {
		t.Fatalf("recent admin session must remain valid: %v", err)
	}
	if db.batchCalls != 0 || db.queryCalls != 1 {
		t.Fatalf("recent parallel reads must not write the session row, batch=%d query=%d", db.batchCalls, db.queryCalls)
	}
}

func TestAdminSessionConcurrentTouchRevalidatesZeroChange(t *testing.T) {
	now := time.Now().UTC()
	token := strings.Repeat("t", 32)
	csrf := strings.Repeat("c", 32)
	db := &sessionTouchDatabase{batchChanges: 0, rows: []map[string]any{{
		"id": "admin_session_test", "user_id": "admin_test", "csrf_hash": tokenHash(csrf),
		"credential_version": int64(1), "current_credential_version": int64(1),
		"expires_at": databaseTimestamp(now.Add(time.Hour)), "last_seen_at": databaseTimestamp(now.Add(-time.Minute)),
		"email": "admin@example.test", "display_name": "Admin",
	}}}
	app := &application{db: db, portalURL: "http://localhost:3000"}
	request := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	request.AddCookie(&http.Cookie{Name: app.adminCookieName(), Value: token})
	request.AddCookie(&http.Cookie{Name: app.adminCSRFCookieName(), Value: csrf})
	session, _, err := app.loadAdminSession(request)
	if err != nil || session == nil {
		t.Fatalf("concurrent admin session touch must remain valid: %v", err)
	}
	if db.batchCalls != 1 || db.queryCalls != 2 || !strings.Contains(db.statements[0].SQL, "last_seen_at<?") {
		t.Fatalf("expected conditional touch plus validity recheck, batch=%d query=%d", db.batchCalls, db.queryCalls)
	}
}

func TestAdminAuthPostgresIntegration(t *testing.T) {
	databaseURL := os.Getenv("POSTGRES_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("POSTGRES_TEST_DATABASE_URL is not set")
	}
	db, err := postgresdb.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	bootstrap := []byte("bootstrap-secret-0123456789abcdef")
	app := &application{
		db: db, portalURL: "http://localhost:3000",
		adminPasswordPepper:  []byte("admin-password-pepper-0123456789abcdef"),
		adminTOTPKey:         []byte("0123456789abcdef0123456789abcdef"),
		adminBootstrapSecret: bootstrap,
	}
	email := "admin-integration@example.test"
	setupRequest := httptest.NewRequest(http.MethodPost, "/api/auth/setup-token", bytes.NewBufferString(`{"email":"`+email+`","display_name":"Integration Admin"}`))
	setupRequest.Header.Set("Content-Type", "application/json")
	setupRequest.Header.Set("Authorization", "Bearer "+string(bootstrap))
	setupResponse := httptest.NewRecorder()
	app.createAdminSetupToken(setupResponse, setupRequest)
	if setupResponse.Code != http.StatusCreated {
		t.Fatalf("setup token status=%d body=%q", setupResponse.Code, setupResponse.Body.String())
	}
	var setupPayload map[string]any
	if err := json.Unmarshal(setupResponse.Body.Bytes(), &setupPayload); err != nil {
		t.Fatal(err)
	}
	setupToken := text(setupPayload["setup_token"])

	completeRequest := httptest.NewRequest(http.MethodPost, "/api/auth/admin/setup/complete", bytes.NewBufferString(`{"setup_token":"`+setupToken+`","password":"Correct-Horse-7-Battery!"}`))
	completeRequest.Header.Set("Content-Type", "application/json")
	completeResponse := httptest.NewRecorder()
	app.completeAdminSetup(completeResponse, completeRequest)
	if completeResponse.Code != http.StatusOK {
		t.Fatalf("complete status=%d body=%q", completeResponse.Code, completeResponse.Body.String())
	}
	var completePayload map[string]any
	_ = json.Unmarshal(completeResponse.Body.Bytes(), &completePayload)
	enrollmentToken := text(completePayload["enrollment_token"])

	totpSetupRequest := httptest.NewRequest(http.MethodPost, "/api/auth/admin/totp/setup", bytes.NewBufferString(`{"enrollment_token":"`+enrollmentToken+`"}`))
	totpSetupRequest.Header.Set("Content-Type", "application/json")
	totpSetupResponse := httptest.NewRecorder()
	app.adminTOTPSetup(totpSetupResponse, totpSetupRequest)
	if totpSetupResponse.Code != http.StatusOK {
		t.Fatalf("TOTP setup status=%d body=%q", totpSetupResponse.Code, totpSetupResponse.Body.String())
	}
	var totpPayload map[string]any
	_ = json.Unmarshal(totpSetupResponse.Body.Bytes(), &totpPayload)
	secret := text(totpPayload["secret"])
	enrollmentCode := totpCodeAt(t, secret, time.Now().Add(-30*time.Second))
	verifyEnrollmentRequest := httptest.NewRequest(http.MethodPost, "/api/auth/admin/totp/verify", bytes.NewBufferString(`{"enrollment_token":"`+enrollmentToken+`","code":"`+enrollmentCode+`"}`))
	verifyEnrollmentRequest.Header.Set("Content-Type", "application/json")
	verifyEnrollmentResponse := httptest.NewRecorder()
	app.verifyAdminTOTP(verifyEnrollmentResponse, verifyEnrollmentRequest)
	if verifyEnrollmentResponse.Code != http.StatusOK {
		t.Fatalf("enrollment verify status=%d body=%q", verifyEnrollmentResponse.Code, verifyEnrollmentResponse.Body.String())
	}

	cookies := verifyEnrollmentResponse.Result().Cookies()
	if len(cookies) != 2 {
		t.Fatalf("expected two admin cookies, got %d", len(cookies))
	}
	meRequest := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	for _, cookie := range cookies {
		meRequest.AddCookie(cookie)
	}
	meResponse := httptest.NewRecorder()
	app.adminSessionInfo(meResponse, meRequest)
	if meResponse.Code != http.StatusOK || !strings.Contains(meResponse.Body.String(), `"role":"admin"`) {
		t.Fatalf("me status=%d body=%q", meResponse.Code, meResponse.Body.String())
	}

	loginRequest := httptest.NewRequest(http.MethodPost, "/api/auth/admin/login", bytes.NewBufferString(`{"email":"`+email+`","password":"Correct-Horse-7-Battery!"}`))
	loginRequest.Header.Set("Content-Type", "application/json")
	loginResponse := httptest.NewRecorder()
	app.adminLogin(loginResponse, loginRequest)
	if loginResponse.Code != http.StatusOK {
		t.Fatalf("login status=%d body=%q", loginResponse.Code, loginResponse.Body.String())
	}
	var loginPayload map[string]any
	_ = json.Unmarshal(loginResponse.Body.Bytes(), &loginPayload)
	challenge := text(loginPayload["challenge_id"])
	loginCode := totpCodeAt(t, secret, time.Now())
	verifyLoginRequest := httptest.NewRequest(http.MethodPost, "/api/auth/admin/totp/verify", bytes.NewBufferString(`{"challenge_id":"`+challenge+`","code":"`+loginCode+`"}`))
	verifyLoginRequest.Header.Set("Content-Type", "application/json")
	verifyLoginResponse := httptest.NewRecorder()
	app.verifyAdminTOTP(verifyLoginResponse, verifyLoginRequest)
	if verifyLoginResponse.Code != http.StatusOK || !strings.Contains(verifyLoginResponse.Body.String(), `"next_step":"authenticated"`) {
		t.Fatalf("login verify status=%d body=%q", verifyLoginResponse.Code, verifyLoginResponse.Body.String())
	}
}

func totpCodeAt(t *testing.T, secret string, at time.Time) string {
	t.Helper()
	decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(secret))
	if err != nil {
		t.Fatal(err)
	}
	counter := uint64(at.Unix() / 30)
	message := make([]byte, 8)
	for index := 7; index >= 0; index-- {
		message[index] = byte(counter)
		counter >>= 8
	}
	mac := hmac.New(sha1.New, decoded)
	_, _ = mac.Write(message)
	digest := mac.Sum(nil)
	offset := digest[len(digest)-1] & 0x0f
	value := (uint32(digest[offset])&0x7f)<<24 | uint32(digest[offset+1])<<16 | uint32(digest[offset+2])<<8 | uint32(digest[offset+3])
	return fmt.Sprintf("%06d", value%1_000_000)
}

func TestAdminTOTPEncryptionRoundTrip(t *testing.T) {
	app := &application{adminTOTPKey: []byte("0123456789abcdef0123456789abcdef")}
	secret := "JBSWY3DPEHPK3PXP"
	encrypted, err := app.encryptAdminTOTP(secret)
	if err != nil || encrypted == secret {
		t.Fatalf("admin TOTP encryption failed: encrypted=%q err=%v", encrypted, err)
	}
	decrypted, err := app.decryptAdminTOTP(encrypted)
	if err != nil || decrypted != secret {
		t.Fatalf("admin TOTP decrypt mismatch: decrypted=%q err=%v", decrypted, err)
	}
}

func TestAdminLoginCreatesTOTPChallengeOnlyAfterPassword(t *testing.T) {
	pepper := []byte("0123456789abcdef0123456789abcdef")
	salt := []byte("0123456789abcdef")
	app := &application{adminPasswordPepper: pepper, portalURL: "http://localhost:3000"}
	hash := app.deriveAdminPassword("Correct-Horse-7-Battery!", salt)
	db := &customerLoginDatabase{rows: []map[string]any{{
		"id": "admin_test", "email": "admin@example.test", "display_name": "Admin",
		"password_salt": hex.EncodeToString(salt), "password_hash": hex.EncodeToString(hash),
		"credential_version": int64(1), "failed_attempts": int64(0), "locked_until": "", "totp_enabled": true,
	}}}
	app.db = db
	request := httptest.NewRequest(http.MethodPost, "/api/auth/admin/login", bytes.NewBufferString(`{"email":"admin@example.test","password":"Correct-Horse-7-Battery!"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	app.adminLogin(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"next_step":"totp_required"`) {
		t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
	}
	combined := ""
	for _, statement := range db.statements {
		combined += statement.SQL
	}
	if !strings.Contains(combined, "admin_login_challenges") || strings.Contains(response.Header().Get("Set-Cookie"), adminSessionCookie) {
		t.Fatal("password step must create only a TOTP challenge, not an admin session")
	}
}
