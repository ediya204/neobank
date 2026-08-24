package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
)

type adminCustomerPasswordDatabase struct {
	rows       []map[string]any
	statements []d1.Statement
}

type adminCustomerSetupDatabase struct {
	rows       []map[string]any
	statements []d1.Statement
}

type adminCustomerEmailVerificationDatabase struct {
	rows       []map[string]any
	statements []d1.Statement
}

func (db *adminCustomerEmailVerificationDatabase) Query(context.Context, string, ...any) ([]map[string]any, error) {
	return db.rows, nil
}

func (db *adminCustomerEmailVerificationDatabase) Batch(_ context.Context, statements ...d1.Statement) ([]d1.Result, error) {
	db.statements = append(db.statements, statements...)
	return []d1.Result{
		{Meta: map[string]any{"changes": float64(0)}},
		{Meta: map[string]any{"changes": float64(1)}},
		{Meta: map[string]any{"changes": float64(1)}},
		{Meta: map[string]any{"changes": float64(1)}},
	}, nil
}

func (db *adminCustomerSetupDatabase) Query(context.Context, string, ...any) ([]map[string]any, error) {
	return db.rows, nil
}

func (db *adminCustomerSetupDatabase) Batch(_ context.Context, statements ...d1.Statement) ([]d1.Result, error) {
	db.statements = append(db.statements, statements...)
	return []d1.Result{
		{Meta: map[string]any{"changes": float64(1)}},
		{Meta: map[string]any{"changes": float64(0)}},
		{Meta: map[string]any{"changes": float64(0)}},
		{Meta: map[string]any{"changes": float64(0)}},
		{Meta: map[string]any{"changes": float64(1)}},
	}, nil
}

func (db *adminCustomerPasswordDatabase) Query(context.Context, string, ...any) ([]map[string]any, error) {
	return db.rows, nil
}

func (db *adminCustomerPasswordDatabase) Batch(_ context.Context, statements ...d1.Statement) ([]d1.Result, error) {
	db.statements = append(db.statements, statements...)
	return []d1.Result{
		{Meta: map[string]any{"changes": float64(1)}},
		{Meta: map[string]any{"changes": float64(2)}},
		{Meta: map[string]any{"changes": float64(1)}},
		{Meta: map[string]any{"changes": float64(1)}},
	}, nil
}

func TestAdminCustomerViewNeverSelectsCredentialMaterial(t *testing.T) {
	for _, prohibited := range []string{"password", "token", "totp", "credential", "recovery"} {
		if strings.Contains(strings.ToLower(adminCustomerFields), prohibited) {
			t.Fatalf("admin customer response must not include %q: %s", prohibited, adminCustomerFields)
		}
	}
	for _, required := range []string{
		"kyc_status", "operations_status", "kyc_reviewed_by", "activated_by", "wallet_count", "wallet_status",
		"wallet_deposit_enabled", "custody_provider='cregis'", "ownership_verified_at IS NOT NULL",
	} {
		if !strings.Contains(adminCustomerFields, required) {
			t.Fatalf("admin customer response must include %q", required)
		}
	}
}

func TestAdminResendsLegacyCustomerEmailVerificationWithoutForgingVerification(t *testing.T) {
	db := &adminCustomerEmailVerificationDatabase{rows: []map[string]any{{
		"email": "legacy@example.test", "display_name": "Legacy Applicant",
		"credential_version": int64(3), "latest_verification_created_at": "",
	}}}
	app := &application{
		db: db, tenantID: "neobank", coreOrganizationID: "org_neobank",
		emailNotifications:          true,
		customerPasswordResetSecret: []byte("0123456789abcdef0123456789abcdef"),
	}
	request := httptest.NewRequest(http.MethodPost,
		"/api/v1/admin/customers/customer_1/email-verification", bytes.NewBufferString(`{}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Neobank-User", "compliance@example.test")
	response := httptest.NewRecorder()

	app.adminResendLegacyCustomerEmailVerification(response, request, "customer_1")

	if response.Code != http.StatusAccepted || !strings.Contains(response.Body.String(), `"accepted":true`) {
		t.Fatalf("email verification resend status=%d body=%q", response.Code, response.Body.String())
	}
	var payload struct {
		ExpiresAt string `json:"expires_at"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode email verification resend response: %v", err)
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, payload.ExpiresAt)
	if err != nil {
		t.Fatalf("parse email verification expiry: %v", err)
	}
	if remaining := time.Until(expiresAt); remaining < 5*time.Hour+59*time.Minute || remaining > 6*time.Hour+time.Minute {
		t.Fatalf("legacy verification link lifetime=%s, want 6 hours", remaining)
	}
	if len(db.statements) != 4 {
		t.Fatalf("email verification resend statements=%d, want 4", len(db.statements))
	}
	for _, prohibited := range []string{"UPDATE customers SET email_verified_at", "kyc_status='approved'", "operations_status='active'"} {
		for _, statement := range db.statements {
			if strings.Contains(statement.SQL, prohibited) {
				t.Fatalf("repair must not forge verification or approve the customer: %q", prohibited)
			}
		}
	}
	for _, required := range []string{
		"created_by='public_registration'", "email_verified_at IS NULL", "customer_applications",
	} {
		if !strings.Contains(db.statements[1].SQL, required) {
			t.Fatalf("verification request insert must require %q", required)
		}
	}
	if !strings.Contains(db.statements[2].SQL, "CUSTOMER_EMAIL_VERIFICATION") ||
		!strings.Contains(db.statements[2].SQL, "EXISTS") {
		t.Fatal("outbox write must use the verification template and depend on the request row")
	}
	if !strings.Contains(db.statements[3].SQL, "auth.email_verification_requested") ||
		!strings.Contains(strings.Join(anyStrings(db.statements[3].Params), " "), "admin_legacy_application_resend") {
		t.Fatal("verification resend must write a dedicated admin audit event")
	}
}

func TestAdminLegacyEmailVerificationResendRejectsIneligibleCustomer(t *testing.T) {
	db := &adminCustomerEmailVerificationDatabase{}
	app := &application{
		db: db, tenantID: "neobank", emailNotifications: true,
		customerPasswordResetSecret: []byte("0123456789abcdef0123456789abcdef"),
	}
	request := httptest.NewRequest(http.MethodPost,
		"/api/v1/admin/customers/customer_1/email-verification", bytes.NewBufferString(`{}`))
	response := httptest.NewRecorder()

	app.adminResendLegacyCustomerEmailVerification(response, request, "customer_1")

	if response.Code != http.StatusConflict ||
		!strings.Contains(response.Body.String(), `"code":"customer_email_verification_repair_unavailable"`) {
		t.Fatalf("ineligible resend status=%d body=%q", response.Code, response.Body.String())
	}
	if len(db.statements) != 0 {
		t.Fatal("ineligible customer must not enqueue email or audit writes")
	}
}

func TestAdminCustomerPasswordChangeRevokesSessionsAndAuditsWithoutPlaintext(t *testing.T) {
	pepper := []byte("0123456789abcdef0123456789abcdef")
	oldPassword := "Old-Customer-Password-7!"
	newPassword := "New-Customer-Password-8!"
	salt := []byte("0123456789abcdef")
	app := &application{customerPasswordPepper: pepper, tenantID: "neobank"}
	oldHash := app.deriveCustomerArgon2id(oldPassword, salt)
	db := &adminCustomerPasswordDatabase{rows: []map[string]any{{
		"password_salt": hex.EncodeToString(salt), "password_hash": hex.EncodeToString(oldHash),
		"password_algorithm": customerPasswordAlgorithm, "password_iterations": int64(0),
		"password_memory_kib":  int64(customerArgonMemoryKiB),
		"password_time_cost":   int64(customerArgonTimeCost),
		"password_parallelism": int64(customerArgonParallelism), "credential_version": int64(4),
	}}}
	app.db = db
	request := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/customers/customer_1/password",
		bytes.NewBufferString(`{"new_password":"`+newPassword+`"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Neobank-User", "super-admin@example.test")
	response := httptest.NewRecorder()

	app.adminChangeCustomerPassword(response, request, "customer_1")

	if response.Code != http.StatusOK {
		t.Fatalf("password change status=%d body=%q", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), newPassword) || strings.Contains(response.Body.String(), oldPassword) {
		t.Fatal("password change response must not expose plaintext passwords")
	}
	if len(db.statements) != 4 {
		t.Fatalf("password change statements=%d, want 4", len(db.statements))
	}
	for _, required := range []struct {
		index int
		text  string
	}{
		{0, "credential_version=?"},
		{1, "credential_version=? AND cc.password_hash=?"},
		{2, "credential_version=? AND cc.password_hash=?"},
		{3, "auth.password_changed_by_admin"},
	} {
		if !strings.Contains(db.statements[required.index].SQL, required.text) {
			t.Fatalf("statement %d must contain %q", required.index, required.text)
		}
	}
	for _, statement := range db.statements {
		for _, param := range statement.Params {
			if value, ok := param.(string); ok && (value == newPassword || value == oldPassword) {
				t.Fatal("plaintext password must not be sent to the datastore")
			}
		}
	}
	if !strings.Contains(response.Body.String(), `"sessions_revoked":2`) {
		t.Fatalf("password change response must report revoked sessions: %s", response.Body.String())
	}
}

func TestAdminCustomerPasswordChangeRejectsUnchangedPassword(t *testing.T) {
	pepper := []byte("0123456789abcdef0123456789abcdef")
	password := "Same-Customer-Password-7!"
	salt := []byte("0123456789abcdef")
	app := &application{customerPasswordPepper: pepper, tenantID: "neobank"}
	hash := app.deriveCustomerArgon2id(password, salt)
	db := &adminCustomerPasswordDatabase{rows: []map[string]any{{
		"password_salt": hex.EncodeToString(salt), "password_hash": hex.EncodeToString(hash),
		"password_algorithm": customerPasswordAlgorithm, "password_iterations": int64(0),
		"password_memory_kib":  int64(customerArgonMemoryKiB),
		"password_time_cost":   int64(customerArgonTimeCost),
		"password_parallelism": int64(customerArgonParallelism), "credential_version": int64(1),
	}}}
	app.db = db
	request := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/customers/customer_1/password",
		bytes.NewBufferString(`{"new_password":"`+password+`"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	app.adminChangeCustomerPassword(response, request, "customer_1")

	if response.Code != http.StatusUnprocessableEntity ||
		!strings.Contains(response.Body.String(), `"code":"password_unchanged"`) {
		t.Fatalf("unchanged password status=%d body=%q", response.Code, response.Body.String())
	}
	if len(db.statements) != 0 {
		t.Fatal("unchanged password must not write to the datastore")
	}
}

func TestAdminCustomerSetupLinkReissueInvalidatesIncompleteCredentialsAndAudits(t *testing.T) {
	db := &adminCustomerSetupDatabase{rows: []map[string]any{{
		"status": "pending_setup", "kyc_status": "approved", "operations_status": "active",
	}}}
	app := &application{db: db, tenantID: "neobank", portalURL: "https://portal.example.test"}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/customers/customer_1/setup-link",
		bytes.NewBufferString(`{"reason":"Original setup link expired"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Neobank-User", "super-admin@example.test")
	response := httptest.NewRecorder()

	app.adminReissueCustomerSetupLink(response, request, "customer_1")

	if response.Code != http.StatusCreated {
		t.Fatalf("setup reissue status=%d body=%q", response.Code, response.Body.String())
	}
	var payload struct {
		SetupURL string `json:"setup_url"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode setup response: %v", err)
	}
	const prefix = "https://portal.example.test/customer/setup#setup_token="
	if !strings.HasPrefix(payload.SetupURL, prefix) {
		t.Fatalf("setup URL=%q", payload.SetupURL)
	}
	token := strings.TrimPrefix(payload.SetupURL, prefix)
	if len(token) < 32 {
		t.Fatal("setup response must contain a strong one-time token")
	}
	if len(db.statements) != 5 {
		t.Fatalf("setup reissue statements=%d, want 5", len(db.statements))
	}
	for _, required := range []string{
		"password_salt=NULL", "totp_secret_ciphertext=NULL", "setup_consumed_at=NULL",
		"enrollment_token_hash=NULL", "credential_version=credential_version+1",
		"status='pending_setup'", "kyc_status='approved'", "operations_status='active'",
	} {
		if !strings.Contains(reissueCustomerSetupCredentialSQL, required) {
			t.Fatalf("setup reissue SQL must contain %q", required)
		}
	}
	if !strings.Contains(db.statements[4].SQL, "auth.setup_link_reissued") {
		t.Fatal("setup reissue must create a dedicated audit event")
	}
	for _, statement := range db.statements {
		for _, param := range statement.Params {
			if value, ok := param.(string); ok && value == token {
				t.Fatal("raw setup token must never be written to the datastore")
			}
		}
	}
	if got := db.statements[0].Params[1]; got != tokenHash(token) {
		t.Fatal("datastore must receive only the setup token hash")
	}
}

func TestAdminCustomerSetupLinkReissueRejectsActiveCustomer(t *testing.T) {
	db := &adminCustomerSetupDatabase{rows: []map[string]any{{
		"status": "active", "kyc_status": "approved", "operations_status": "active",
	}}}
	app := &application{db: db, tenantID: "neobank", portalURL: "https://portal.example.test"}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/customers/customer_1/setup-link",
		bytes.NewBufferString(`{"reason":"Unexpected request"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	app.adminReissueCustomerSetupLink(response, request, "customer_1")

	if response.Code != http.StatusConflict ||
		!strings.Contains(response.Body.String(), `"code":"customer_setup_reissue_unavailable"`) {
		t.Fatalf("active customer status=%d body=%q", response.Code, response.Body.String())
	}
	if len(db.statements) != 0 {
		t.Fatal("active customer setup reissue must not write to the datastore")
	}
}

func TestKYCApprovalAutomaticallyActivatesCustomerBeforeWalletProvisioning(t *testing.T) {
	for _, required := range []string{
		"kyc_status='approved'",
		"operations_status='active'",
		"kyc_status='pending'",
		"operations_status='pending'",
		"password_hash IS NOT NULL",
		"THEN 'active'",
		"created_by<>'public_registration' OR (",
		"email_verified_at IS NOT NULL AND EXISTS",
		"customer_applications ca",
	} {
		if !strings.Contains(approveCustomerKYCAutomationSQL, required) {
			t.Fatalf("automatic KYC approval SQL must contain %q", required)
		}
	}
	if got := automaticWalletIdempotency("customer_123"); got != "auto-kyc-customer_123" {
		t.Fatalf("automatic wallet idempotency = %q", got)
	}
	if !safeIdentifier.MatchString(automaticWalletIdempotency("customer_123")) {
		t.Fatal("automatic wallet idempotency must satisfy the public wallet API contract")
	}
	if got := automaticWalletAlias("customer_123"); got != "customer_123" {
		t.Fatalf("automatic wallet alias = %q", got)
	}
}

func TestKYCApprovalReportsWalletRetryWithoutReversingApproval(t *testing.T) {
	metadata := walletProvisioningRetryMetadata(&walletProvisionError{
		status: 502,
		code:   "cregis_address_ownership_verification_failed",
		cause:  errors.New("internal cause"),
	})
	if metadata["status"] != "retry_required" {
		t.Fatalf("wallet provisioning status = %q", metadata["status"])
	}
	if metadata["error_code"] != "cregis_address_ownership_verification_failed" {
		t.Fatalf("wallet provisioning error code = %q", metadata["error_code"])
	}
	if _, exposed := metadata["cause"]; exposed {
		t.Fatal("wallet provisioning metadata must not expose the internal cause")
	}
}

func TestManualActivationRemainsARepairPath(t *testing.T) {
	for _, required := range []string{
		"kyc_status='approved'",
		"operations_status='pending'",
		"status IN ('pending_setup', 'active')",
		"password_hash IS NOT NULL",
		"THEN 'active'",
	} {
		if !strings.Contains(activateCustomerOperationsSQL, required) {
			t.Fatalf("operations activation SQL must contain %q", required)
		}
	}
	if !strings.Contains(issueCustomerSetupCredentialSQL, "status='pending_setup'") {
		t.Fatal("setup credentials may only be issued to pending_setup customers")
	}
}

func TestSumsubApprovalGate(t *testing.T) {
	tests := []struct {
		name        string
		account     string
		status      string
		level       string
		environment string
		configured  bool
		syncStatus  string
		stepsReady  bool
		want        string
	}{
		{name: "legacy individual remains reviewable", account: "individual"},
		{name: "business remains manual", account: "business", status: "provider_reviewing"},
		{name: "ready", account: "individual", status: "ready_for_admin_review", level: "neobank_individual_v1", environment: "sandbox", syncStatus: "completed", stepsReady: true, configured: true},
		{name: "provider status incomplete", account: "individual", status: "provider_reviewing", level: "neobank_individual_v1", environment: "sandbox", syncStatus: "completed", stepsReady: true, configured: true, want: "sumsub_verification_not_ready"},
		{name: "sync incomplete", account: "individual", status: "ready_for_admin_review", level: "neobank_individual_v1", environment: "sandbox", syncStatus: "pending", stepsReady: true, configured: true, want: "sumsub_verification_not_ready"},
		{name: "steps incomplete", account: "individual", status: "ready_for_admin_review", level: "neobank_individual_v1", environment: "sandbox", syncStatus: "completed", configured: true, want: "sumsub_verification_not_ready"},
		{name: "wrong level", account: "individual", status: "ready_for_admin_review", level: "other", environment: "sandbox", syncStatus: "completed", stepsReady: true, configured: true, want: "sumsub_configuration_mismatch"},
		{name: "provider disabled", account: "individual", status: "ready_for_admin_review", level: "neobank_individual_v1", environment: "sandbox", syncStatus: "completed", stepsReady: true, want: "sumsub_configuration_mismatch"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := sumsubApprovalBlockCode(test.account, test.status, test.level, test.environment,
				test.syncStatus, test.stepsReady,
				"neobank_individual_v1", "sandbox", test.configured)
			if got != test.want {
				t.Fatalf("block code = %q, want %q", got, test.want)
			}
		})
	}
}
