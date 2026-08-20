package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
)

type passwordRecoveryDatabase struct {
	rows       []map[string]any
	statements []d1.Statement
	query      func(string, ...any) ([]map[string]any, error)
}

func (db *passwordRecoveryDatabase) Query(_ context.Context, sql string, params ...any) ([]map[string]any, error) {
	if db.query != nil {
		return db.query(sql, params...)
	}
	return db.rows, nil
}

func (db *passwordRecoveryDatabase) Batch(_ context.Context, statements ...d1.Statement) ([]d1.Result, error) {
	db.statements = append(db.statements, statements...)
	if len(statements) == 2 && strings.Contains(statements[0].SQL, "attempts=attempts+1") {
		return []d1.Result{
			{Meta: map[string]any{"changes": float64(1)}},
			{Results: db.rows, Meta: map[string]any{"changes": float64(0)}},
		}, nil
	}
	results := make([]d1.Result, len(statements))
	for index := range results {
		results[index] = d1.Result{Meta: map[string]any{"changes": float64(1)}}
	}
	return results, nil
}

func TestCustomerRecoveryTokenIsDerivedAndPurposeBound(t *testing.T) {
	app := &application{customerPasswordResetSecret: []byte("0123456789abcdef0123456789abcdef")}
	requestID := "password_reset_0123456789abcdef0123456789abcdef"
	token := app.deriveCustomerRecoveryToken("password-reset-v1", requestID)
	if token == requestID || !strings.HasPrefix(token, requestID+".") {
		t.Fatal("recovery token must contain a derived authenticator")
	}
	if parsed, ok := app.verifyCustomerRecoveryToken("password-reset-v1", token); !ok || parsed != requestID {
		t.Fatal("valid recovery token must verify")
	}
	if _, ok := app.verifyCustomerRecoveryToken("email-verification-v1", token); ok {
		t.Fatal("a password reset token must not cross into email verification")
	}
	if _, ok := app.verifyCustomerRecoveryToken("password-reset-v1", token+"x"); ok {
		t.Fatal("a modified recovery token must fail")
	}
}

func TestPasswordResetRequestUsesGenericResponseAndStoresNoRawToken(t *testing.T) {
	app := &application{
		customerPasswordResetSecret: []byte("0123456789abcdef0123456789abcdef"),
		emailNotifications:          true,
		tenantID:                    "neobank",
		coreOrganizationID:          "org_neobank",
	}
	db := &passwordRecoveryDatabase{rows: []map[string]any{{
		"id": "customer_1", "email": "customer@example.test", "display_name": "Customer",
		"email_verified_at": databaseTimestamp(time.Now().UTC()), "credential_version": int64(3),
	}}}
	app.db = db
	request := httptest.NewRequest(http.MethodPost, "/api/auth/customer/password-reset/request",
		bytes.NewBufferString(`{"email":"customer@example.test"}`))
	response := httptest.NewRecorder()
	app.requestCustomerPasswordReset(response, request)
	if response.Code != http.StatusAccepted || response.Body.String() != "{\"accepted\":true}\n" {
		t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
	}
	if len(db.statements) != 4 {
		t.Fatalf("expected reset request transaction, got %d statements", len(db.statements))
	}
	combined := ""
	for _, statement := range db.statements {
		combined += statement.SQL + fmt.Sprint(statement.Params)
		for _, parameter := range statement.Params {
			if value, ok := parameter.(string); ok {
				if strings.Contains(value, "reset_token") || strings.Count(value, ".") == 1 && strings.HasPrefix(value, "password_reset_") {
					t.Fatal("raw reset tokens must not be stored in PostgreSQL or the email outbox")
				}
			}
		}
	}
	for _, required := range []string{"customer_password_reset_requests", "CUSTOMER_PASSWORD_RESET_REQUESTED", "auth.password_reset_requested"} {
		if !strings.Contains(combined, required) {
			t.Fatalf("reset transaction must contain %q", required)
		}
	}
}

func TestPasswordResetCompletionReplacesHashAndRevokesSessionsWithoutPlaintext(t *testing.T) {
	pepper := []byte("0123456789abcdef0123456789abcdef")
	resetSecret := []byte("abcdef0123456789abcdef0123456789")
	oldPassword := "Old-Customer-Password-7!"
	newPassword := "New-Customer-Password-8!"
	salt := []byte("0123456789abcdef")
	app := &application{
		customerPasswordPepper:      pepper,
		customerPasswordResetSecret: resetSecret,
		tenantID:                    "neobank",
		portalURL:                   "http://localhost:3000",
	}
	oldHash := app.deriveCustomerArgon2id(oldPassword, salt)
	db := &passwordRecoveryDatabase{rows: []map[string]any{{
		"customer_id": "customer_1", "email": "customer@example.test", "display_name": "Customer",
		"expires_at":    databaseTimestamp(time.Now().UTC().Add(time.Minute)),
		"password_salt": hex.EncodeToString(salt), "password_hash": hex.EncodeToString(oldHash),
		"password_algorithm": customerPasswordAlgorithm, "password_iterations": int64(0),
		"password_memory_kib": int64(customerArgonMemoryKiB), "password_time_cost": int64(customerArgonTimeCost),
		"password_parallelism": int64(customerArgonParallelism), "totp_secret_ciphertext": "",
		"totp_last_counter": int64(-1), "credential_version": int64(4),
	}}}
	app.db = db
	requestID := "password_reset_0123456789abcdef0123456789abcdef"
	token := app.deriveCustomerRecoveryToken("password-reset-v1", requestID)
	request := httptest.NewRequest(http.MethodPost, "/api/auth/customer/password-reset/complete",
		bytes.NewBufferString(`{"reset_token":"`+token+`","new_password":"`+newPassword+`"}`))
	response := httptest.NewRecorder()
	app.completeCustomerPasswordReset(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"sessions_revoked":true`) {
		t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
	}
	combined := ""
	for _, statement := range db.statements {
		combined += statement.SQL
		for _, parameter := range statement.Params {
			if value, ok := parameter.(string); ok && (value == newPassword || value == oldPassword || value == token) {
				t.Fatal("plaintext passwords and reset tokens must never be sent to PostgreSQL")
			}
		}
	}
	for _, required := range []string{
		"SET consumed_at=?", "credential_version=?", "customer_sessions SET revoked_at=?",
		"customer_login_challenges SET consumed_at=?", "auth.password_reset_completed",
	} {
		if !strings.Contains(combined, required) {
			t.Fatalf("completion transaction must contain %q", required)
		}
	}
}

func TestPasswordResetDoesNotRevealPasswordEqualityBeforeTOTP(t *testing.T) {
	oldPassword := "Old-Customer-Password-7!"
	app, db, token, _, invalidTOTP := newTOTPPasswordRecoveryTestApp(t, oldPassword)

	for _, password := range []string{oldPassword, "Different-Customer-Password-8!"} {
		request := httptest.NewRequest(http.MethodPost, "/api/auth/customer/password-reset/complete",
			bytes.NewBufferString(`{"reset_token":"`+token+`","new_password":"`+password+`","totp_code":"`+invalidTOTP+`"}`))
		response := httptest.NewRecorder()
		app.completeCustomerPasswordReset(response, request)
		if response.Code != http.StatusUnauthorized ||
			!strings.Contains(response.Body.String(), `"code":"invalid_totp_code"`) ||
			strings.Contains(response.Body.String(), `"code":"password_unchanged"`) {
			t.Fatalf("password=%q status=%d body=%q", password, response.Code, response.Body.String())
		}
	}
	if len(db.statements) != 4 {
		t.Fatalf("each failed TOTP attempt must only increment the reset attempt counter; got %d statements", len(db.statements))
	}
}

func TestPasswordResetDoesNotRevealPasswordEqualityBeforeRecoveryCode(t *testing.T) {
	oldPassword := "Old-Customer-Password-7!"
	app, _, token, _, _ := newTOTPPasswordRecoveryTestApp(t, oldPassword)
	db := app.db.(*passwordRecoveryDatabase)
	db.query = func(sql string, _ ...any) ([]map[string]any, error) {
		if strings.Contains(sql, "customer_recovery_codes") {
			return nil, nil
		}
		return db.rows, nil
	}

	for _, password := range []string{oldPassword, "Different-Customer-Password-8!"} {
		request := httptest.NewRequest(http.MethodPost, "/api/auth/customer/password-reset/complete",
			bytes.NewBufferString(`{"reset_token":"`+token+`","new_password":"`+password+`","recovery_code":"invalid-code"}`))
		response := httptest.NewRecorder()
		app.completeCustomerPasswordReset(response, request)
		if response.Code != http.StatusUnauthorized ||
			!strings.Contains(response.Body.String(), `"code":"invalid_recovery_code"`) ||
			strings.Contains(response.Body.String(), `"code":"password_unchanged"`) {
			t.Fatalf("password=%q status=%d body=%q", password, response.Code, response.Body.String())
		}
	}
}

func TestPasswordResetPreservesPostTOTPPasswordRulesAndSuccess(t *testing.T) {
	oldPassword := "Old-Customer-Password-7!"
	app, _, token, validTOTP, _ := newTOTPPasswordRecoveryTestApp(t, oldPassword)

	unchangedRequest := httptest.NewRequest(http.MethodPost, "/api/auth/customer/password-reset/complete",
		bytes.NewBufferString(`{"reset_token":"`+token+`","new_password":"`+oldPassword+`","totp_code":"`+validTOTP+`"}`))
	unchangedResponse := httptest.NewRecorder()
	app.completeCustomerPasswordReset(unchangedResponse, unchangedRequest)
	if unchangedResponse.Code != http.StatusUnprocessableEntity ||
		!strings.Contains(unchangedResponse.Body.String(), `"code":"password_unchanged"`) {
		t.Fatalf("status=%d body=%q", unchangedResponse.Code, unchangedResponse.Body.String())
	}

	newPassword := "New-Customer-Password-8!"
	successRequest := httptest.NewRequest(http.MethodPost, "/api/auth/customer/password-reset/complete",
		bytes.NewBufferString(`{"reset_token":"`+token+`","new_password":"`+newPassword+`","totp_code":"`+validTOTP+`"}`))
	successResponse := httptest.NewRecorder()
	app.completeCustomerPasswordReset(successResponse, successRequest)
	if successResponse.Code != http.StatusOK || !strings.Contains(successResponse.Body.String(), `"sessions_revoked":true`) {
		t.Fatalf("status=%d body=%q", successResponse.Code, successResponse.Body.String())
	}
}

func newTOTPPasswordRecoveryTestApp(t *testing.T, oldPassword string) (*application, *passwordRecoveryDatabase, string, string, string) {
	t.Helper()
	pepper := []byte("0123456789abcdef0123456789abcdef")
	resetSecret := []byte("abcdef0123456789abcdef0123456789")
	totpKey := []byte("fedcba9876543210fedcba9876543210")
	salt := []byte("0123456789abcdef")
	app := &application{
		customerPasswordPepper:      pepper,
		customerPasswordResetSecret: resetSecret,
		customerTOTPKey:             totpKey,
		tenantID:                    "neobank",
		portalURL:                   "http://localhost:3000",
	}
	totpSecret := "JBSWY3DPEHPK3PXP"
	encryptedTOTP, err := app.encryptCustomerTOTP(totpSecret)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	validTOTP := totpCodeForTest(t, totpSecret, now)
	invalidTOTP := differentInvalidTOTP(t, totpSecret, now)
	oldHash := app.deriveCustomerArgon2id(oldPassword, salt)
	db := &passwordRecoveryDatabase{rows: []map[string]any{{
		"customer_id": "customer_1", "email": "customer@example.test", "display_name": "Customer",
		"expires_at": databaseTimestamp(now.Add(time.Minute)), "password_salt": hex.EncodeToString(salt),
		"password_hash": hex.EncodeToString(oldHash), "password_algorithm": customerPasswordAlgorithm,
		"password_iterations": int64(0), "password_memory_kib": int64(customerArgonMemoryKiB),
		"password_time_cost": int64(customerArgonTimeCost), "password_parallelism": int64(customerArgonParallelism),
		"totp_secret_ciphertext": encryptedTOTP, "totp_last_counter": int64(-1), "credential_version": int64(4),
	}}}
	app.db = db
	requestID := "password_reset_0123456789abcdef0123456789abcdef"
	return app, db, app.deriveCustomerRecoveryToken("password-reset-v1", requestID), validTOTP, invalidTOTP
}

func differentInvalidTOTP(t *testing.T, secret string, now time.Time) string {
	t.Helper()
	for candidate := 0; candidate < 1_000_000; candidate++ {
		code := fmt.Sprintf("%06d", candidate)
		if _, accepted := verifyTOTPCode(secret, code, now, -1); !accepted {
			return code
		}
	}
	t.Fatal("could not generate an invalid TOTP code")
	return ""
}
