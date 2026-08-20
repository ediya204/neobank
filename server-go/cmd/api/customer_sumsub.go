package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
	sumsubapi "github.com/ediya204/neobank/server-go/internal/sumsub"
)

const (
	onboardingSessionDuration     = 24 * time.Hour
	onboardingSessionIdleDuration = 30 * time.Minute
	onboardingSessionCookie       = "__Host-neobank_onboarding"
	onboardingCSRFCookie          = "__Host-neobank_onboarding_csrf"
	sumsubSDKTokenTTLSeconds      = 600
)

var sumsubApplicantIDPattern = regexp.MustCompile(`^[0-9a-f]{24}$`)

type sumsubProvider interface {
	LevelName() string
	EnsureApplicant(context.Context, sumsubapi.ApplicantInput) (sumsubapi.Applicant, error)
	CreateSDKToken(context.Context, sumsubapi.ApplicantInput, int) (sumsubapi.SDKToken, error)
	GetReviewStatus(context.Context, string) (sumsubapi.ReviewStatus, error)
	GetRequiredSteps(context.Context, string) (sumsubapi.RequiredSteps, error)
}

type customerOnboardingSession struct {
	ID                   string
	CustomerID           string
	Email                string
	PhoneCountryCode     string
	Phone                string
	ResidenceCountry     string
	ApplicationReference string
	VerificationID       string
	ExternalUserID       string
	ApplicantID          string
	ProviderStatus       string
	ExpiresAt            time.Time
	IdleExpiresAt        time.Time
}

type sumsubWebhookPayload struct {
	ApplicantID  string                 `json:"applicantId"`
	ExternalID   string                 `json:"externalUserId"`
	LevelName    string                 `json:"levelName"`
	Type         string                 `json:"type"`
	SandboxMode  bool                   `json:"sandboxMode"`
	ReviewStatus string                 `json:"reviewStatus"`
	ReviewResult sumsubapi.ReviewResult `json:"reviewResult"`
	CreatedAt    string                 `json:"createdAt"`
	CreatedAtMS  string                 `json:"createdAtMs"`
}

func newCustomerOnboardingSession(customerID string, now time.Time) (string, string, string, d1.Statement) {
	sessionID := randomID("onboarding_session")
	sessionToken := randomToken(32)
	csrfToken := randomToken(32)
	return sessionID, sessionToken, csrfToken, d1.Statement{SQL: `INSERT INTO customer_onboarding_sessions
	    (id, customer_id, token_hash, csrf_hash, expires_at, idle_expires_at, created_at, last_seen_at)
	    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, Params: []any{
		sessionID, customerID, tokenHash(sessionToken), tokenHash(csrfToken),
		databaseTimestamp(now.Add(onboardingSessionDuration)), databaseTimestamp(now.Add(onboardingSessionIdleDuration)),
		databaseTimestamp(now), databaseTimestamp(now),
	}}
}

func newSumsubVerificationStatement(app *application, verificationID, customerID, nowText string) d1.Statement {
	externalUserID := "neobank:" + customerID
	return d1.Statement{SQL: `INSERT INTO customer_kyc_verifications
	  (id, tenant_id, customer_id, external_user_id, level_name, environment, status, created_at, updated_at)
	  VALUES (?, ?, ?, ?, ?, ?, 'initializing', ?, ?)`, Params: []any{
		verificationID, app.tenantID, customerID, externalUserID, app.sumsub.LevelName(), app.sumsubEnvironment, nowText, nowText,
	}}
}

func (app *application) setOnboardingSessionCookies(w http.ResponseWriter, token, csrfToken string, expires time.Time) {
	secure := strings.HasPrefix(app.portalURL, "https://")
	http.SetCookie(w, &http.Cookie{Name: app.onboardingCookieName(), Value: token, Path: "/", Expires: expires,
		MaxAge: int(time.Until(expires).Seconds()), HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode})
	http.SetCookie(w, &http.Cookie{Name: app.onboardingCSRFCookieName(), Value: csrfToken, Path: "/", Expires: expires,
		MaxAge: int(time.Until(expires).Seconds()), HttpOnly: false, Secure: secure, SameSite: http.SameSiteLaxMode})
}

func (app *application) onboardingCookieName() string {
	if strings.HasPrefix(app.portalURL, "https://") {
		return onboardingSessionCookie
	}
	return "neobank_onboarding"
}

func (app *application) onboardingCSRFCookieName() string {
	if strings.HasPrefix(app.portalURL, "https://") {
		return onboardingCSRFCookie
	}
	return "neobank_onboarding_csrf"
}

func (app *application) clearOnboardingSessionCookies(w http.ResponseWriter) {
	secure := strings.HasPrefix(app.portalURL, "https://")
	http.SetCookie(w, &http.Cookie{Name: app.onboardingCookieName(), Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode})
	http.SetCookie(w, &http.Cookie{Name: app.onboardingCSRFCookieName(), Value: "", Path: "/", MaxAge: -1,
		HttpOnly: false, Secure: secure, SameSite: http.SameSiteLaxMode})
}

func (app *application) loadOnboardingSession(r *http.Request) (*customerOnboardingSession, string, error) {
	cookie, err := r.Cookie(app.onboardingCookieName())
	if err != nil || cookie.Value == "" {
		return nil, "", errors.New("onboarding session missing")
	}
	rows, err := app.db.Query(r.Context(), `SELECT s.id, s.customer_id, s.csrf_hash, s.expires_at, s.idle_expires_at,
	  c.email, ca.phone_country_code, ca.phone, ca.residence_country, ca.application_reference,
	  v.id AS verification_id, v.external_user_id, v.applicant_id, v.status AS provider_status
	  FROM customer_onboarding_sessions s
	  JOIN customers c ON c.id=s.customer_id
	  JOIN customer_applications ca ON ca.customer_id=c.id AND ca.tenant_id=c.tenant_id
	  JOIN customer_kyc_verifications v ON v.customer_id=c.id AND v.tenant_id=c.tenant_id
	  WHERE s.token_hash=? AND s.revoked_at IS NULL AND c.tenant_id=?
	    AND c.kyc_status='pending' AND c.operations_status='pending'
	    AND s.expires_at>? AND s.idle_expires_at>?`, tokenHash(cookie.Value), app.tenantID,
		databaseTimestamp(time.Now()), databaseTimestamp(time.Now()))
	if err != nil || len(rows) != 1 {
		return nil, "", errors.New("onboarding session invalid")
	}
	expiresAt, expiresErr := time.Parse(time.RFC3339Nano, text(rows[0]["expires_at"]))
	idleExpiresAt, idleErr := time.Parse(time.RFC3339Nano, text(rows[0]["idle_expires_at"]))
	csrfCookie, csrfErr := r.Cookie(app.onboardingCSRFCookieName())
	if expiresErr != nil || idleErr != nil || csrfErr != nil || csrfCookie.Value == "" ||
		!hmac.Equal([]byte(tokenHash(csrfCookie.Value)), []byte(text(rows[0]["csrf_hash"]))) {
		return nil, "", errors.New("onboarding session metadata invalid")
	}
	now := time.Now().UTC()
	newIdle := now.Add(onboardingSessionIdleDuration)
	if newIdle.After(expiresAt) {
		newIdle = expiresAt
	}
	_, _ = app.db.Batch(r.Context(), d1.Statement{SQL: `UPDATE customer_onboarding_sessions SET idle_expires_at=?, last_seen_at=?
	  WHERE id=? AND revoked_at IS NULL`, Params: []any{databaseTimestamp(newIdle), databaseTimestamp(now), text(rows[0]["id"])}})
	return &customerOnboardingSession{
		ID: text(rows[0]["id"]), CustomerID: text(rows[0]["customer_id"]), Email: text(rows[0]["email"]),
		PhoneCountryCode: text(rows[0]["phone_country_code"]), Phone: text(rows[0]["phone"]),
		ResidenceCountry: text(rows[0]["residence_country"]), ApplicationReference: text(rows[0]["application_reference"]),
		VerificationID: text(rows[0]["verification_id"]), ExternalUserID: text(rows[0]["external_user_id"]),
		ApplicantID: text(rows[0]["applicant_id"]), ProviderStatus: text(rows[0]["provider_status"]),
		ExpiresAt: expiresAt, IdleExpiresAt: idleExpiresAt,
	}, csrfCookie.Value, nil
}

func (app *application) requireOnboardingMutation(r *http.Request) (*customerOnboardingSession, error) {
	session, csrfToken, err := app.loadOnboardingSession(r)
	if err != nil {
		return nil, err
	}
	provided := r.Header.Get("X-CSRF-Token")
	if provided == "" || !hmac.Equal([]byte(tokenHash(provided)), []byte(tokenHash(csrfToken))) {
		return nil, errors.New("invalid onboarding csrf token")
	}
	return session, nil
}

func countryAlpha3(value string) string {
	return map[string]string{"HK": "HKG", "SG": "SGP", "CN": "CHN", "GB": "GBR", "US": "USA"}[strings.ToUpper(value)]
}

func (app *application) onboardingLogin(w http.ResponseWriter, r *http.Request) {
	if app.sumsub == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": map[string]string{"code": "sumsub_not_configured"}})
		return
	}
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	email := normalizeCustomerEmail(input.Email)
	rows, err := app.db.Query(r.Context(), `SELECT c.id, cc.password_salt, cc.password_hash, cc.password_algorithm,
	  cc.password_iterations, cc.password_memory_kib, cc.password_time_cost, cc.password_parallelism,
	  ca.application_reference
	  FROM customers c JOIN customer_credentials cc ON cc.customer_id=c.id
	  JOIN customer_applications ca ON ca.customer_id=c.id AND ca.tenant_id=c.tenant_id
	  JOIN customer_kyc_verifications v ON v.customer_id=c.id AND v.tenant_id=c.tenant_id
	  WHERE c.tenant_id=? AND c.email=? AND ca.account_type='individual'
	    AND c.kyc_status='pending' AND c.operations_status='pending'`, app.tenantID, email)
	valid := false
	if err == nil && len(rows) == 1 {
		valid, _ = app.verifyCustomerPassword(input.Password, rows[0])
	} else {
		_ = app.deriveCustomerArgon2id(input.Password, make([]byte, 16))
	}
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if !valid {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "invalid_email_or_password"}})
		return
	}
	now := time.Now().UTC()
	_, token, csrfToken, statement := newCustomerOnboardingSession(text(rows[0]["id"]), now)
	result, err := app.db.Batch(r.Context(), statement)
	if err != nil || len(result) != 1 || resultChanges(result) != 1 {
		databaseError(app, w, err)
		return
	}
	app.setOnboardingSessionCookies(w, token, csrfToken, now.Add(onboardingSessionDuration))
	writeJSON(w, http.StatusOK, map[string]any{
		"application_reference": text(rows[0]["application_reference"]), "csrf_token": csrfToken,
	})
}

func (app *application) onboardingStatus(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.loadOnboardingSession(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "onboarding_session_expired"}})
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT status, review_status, review_answer, review_reject_type,
	  reject_labels_json, moderation_comment, provider_created_at, provider_reviewed_at, last_synced_at
	  FROM customer_kyc_verifications WHERE id=? AND customer_id=?`, session.VerificationID, session.CustomerID)
	if err != nil || len(rows) != 1 {
		databaseError(app, w, err)
		return
	}
	steps, err := app.customerVisibleSumsubSteps(r.Context(), session.VerificationID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"application_reference": session.ApplicationReference,
		"verification":          customerVisibleVerification(rows[0], steps),
	})
}

func customerVisibleVerification(row map[string]any, steps []map[string]any) map[string]any {
	return map[string]any{
		"status": text(row["status"]), "review_status": text(row["review_status"]),
		"review_answer": text(row["review_answer"]), "review_reject_type": text(row["review_reject_type"]),
		"reject_labels":      jsonStringArray(row["reject_labels_json"]),
		"moderation_comment": text(row["moderation_comment"]), "provider_created_at": text(row["provider_created_at"]),
		"provider_reviewed_at": text(row["provider_reviewed_at"]), "last_synced_at": text(row["last_synced_at"]),
		"steps": steps,
	}
}

func (app *application) customerVisibleSumsubSteps(ctx context.Context, verificationID string) ([]map[string]any, error) {
	rows, err := app.db.Query(ctx, `SELECT step_type, review_answer, review_reject_type, document_type,
	  document_country, reject_labels_json, moderation_comment, updated_at
	  FROM customer_kyc_steps WHERE verification_id=? ORDER BY step_type`, verificationID)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		row["reject_labels"] = jsonStringArray(row["reject_labels_json"])
		delete(row, "reject_labels_json")
	}
	return rows, nil
}

func jsonStringArray(value any) []string {
	var result []string
	_ = json.Unmarshal([]byte(text(value)), &result)
	if result == nil {
		return []string{}
	}
	return result
}

func (app *application) createOnboardingSumsubToken(w http.ResponseWriter, r *http.Request) {
	if app.sumsub == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": map[string]string{"code": "sumsub_not_configured"}})
		return
	}
	session, err := app.requireOnboardingMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "onboarding_session_expired"}})
		return
	}
	providerInput := sumsubapi.ApplicantInput{
		ExternalUserID: session.ExternalUserID, Email: session.Email,
		Phone: session.PhoneCountryCode + session.Phone, Country: countryAlpha3(session.ResidenceCountry),
	}
	if providerInput.Country == "" {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": map[string]string{"code": "unsupported_residence_country"}})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	applicant, err := app.sumsub.EnsureApplicant(ctx, providerInput)
	if err != nil || !sumsubApplicantIDPattern.MatchString(applicant.ID) {
		app.markSumsubProviderError(r.Context(), session.VerificationID, "applicant_unavailable")
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": map[string]string{"code": "sumsub_unavailable"}})
		return
	}
	if session.ApplicantID != "" && session.ApplicantID != applicant.ID {
		writeJSON(w, http.StatusConflict, map[string]any{"error": map[string]string{"code": "sumsub_applicant_mismatch"}})
		return
	}
	nowText := databaseTimestamp(time.Now())
	results, err := app.db.Batch(r.Context(), d1.Statement{SQL: `UPDATE customer_kyc_verifications
	  SET applicant_id=?, status=CASE WHEN status='initializing' OR status='provider_error' THEN 'awaiting_applicant' ELSE status END,
	      provider_created_at=COALESCE(provider_created_at, ?), updated_at=?, version=version+1
	  WHERE id=? AND customer_id=? AND (applicant_id IS NULL OR applicant_id=?)`, Params: []any{
		applicant.ID, nowText, nowText, session.VerificationID, session.CustomerID, applicant.ID,
	}})
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 1 || resultChanges(results) != 1 {
		conflict(w, "sumsub_applicant_mismatch")
		return
	}
	token, err := app.sumsub.CreateSDKToken(ctx, providerInput, sumsubSDKTokenTTLSeconds)
	if err != nil {
		app.markSumsubProviderError(r.Context(), session.VerificationID, "token_unavailable")
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": map[string]string{"code": "sumsub_unavailable"}})
		return
	}
	verificationStatus := session.ProviderStatus
	if verificationStatus == "initializing" || verificationStatus == "provider_error" {
		verificationStatus = "awaiting_applicant"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": token.Token, "expires_in": sumsubSDKTokenTTLSeconds,
		"verification_status": verificationStatus,
	})
}

func (app *application) markSumsubProviderError(ctx context.Context, verificationID, code string) {
	nowText := databaseTimestamp(time.Now())
	_, _ = app.db.Batch(ctx,
		d1.Statement{SQL: `UPDATE customer_kyc_verifications SET status='provider_error', updated_at=?, version=version+1
		  WHERE id=? AND status IN ('initializing','awaiting_applicant','provider_error')`, Params: []any{nowText, verificationID}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  SELECT ?, customer_id, 'customer.sumsub_provider_error', 'sumsub_integration', ?, ?
		  FROM customer_kyc_verifications WHERE id=?`, Params: []any{
			randomID("audit"), mustJSON(map[string]string{"error_code": code}), nowText, verificationID,
		}},
	)
}

func (app *application) verifySumsubWebhook(raw []byte, algorithm, providedHex string) bool {
	provided, err := hex.DecodeString(strings.TrimSpace(providedHex))
	if err != nil {
		return false
	}
	var expected []byte
	switch strings.TrimSpace(algorithm) {
	case "HMAC_SHA256_HEX":
		mac := hmac.New(sha256.New, app.sumsubWebhookSecret)
		_, _ = mac.Write(raw)
		expected = mac.Sum(nil)
	case "HMAC_SHA512_HEX":
		mac := hmac.New(sha512.New, app.sumsubWebhookSecret)
		_, _ = mac.Write(raw)
		expected = mac.Sum(nil)
	default:
		return false
	}
	return hmac.Equal(provided, expected)
}

func (app *application) sumsubWebhook(w http.ResponseWriter, r *http.Request) {
	if app.sumsub == nil || len(app.sumsubWebhookSecret) == 0 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": map[string]string{"code": "sumsub_not_configured"}})
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 128*1024+1))
	if err != nil || len(raw) > 128*1024 {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": map[string]string{"code": "payload_too_large"}})
		return
	}
	if !app.verifySumsubWebhook(raw, r.Header.Get("X-Payload-Digest-Alg"), r.Header.Get("X-Payload-Digest")) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "invalid_sumsub_signature"}})
		return
	}
	var payload sumsubWebhookPayload
	if json.Unmarshal(raw, &payload) != nil || !sumsubApplicantIDPattern.MatchString(payload.ApplicantID) ||
		!strings.HasPrefix(payload.ExternalID, "neobank:customer_") || payload.LevelName != app.sumsub.LevelName() {
		validationError(w)
		return
	}
	if payload.SandboxMode != (app.sumsubEnvironment == "sandbox") {
		writeJSON(w, http.StatusConflict, map[string]any{"error": map[string]string{"code": "sumsub_environment_mismatch"}})
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT id, customer_id, applicant_id FROM customer_kyc_verifications
	  WHERE tenant_id=? AND external_user_id=? AND level_name=? AND environment=?`,
		app.tenantID, payload.ExternalID, payload.LevelName, app.sumsubEnvironment)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	verificationID := text(rows[0]["id"])
	if existing := text(rows[0]["applicant_id"]); existing != "" && existing != payload.ApplicantID {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	digest := sha256.Sum256(raw)
	nowText := databaseTimestamp(time.Now())
	occurredAt := payload.CreatedAtMS
	if occurredAt == "" {
		occurredAt = payload.CreatedAt
	}
	providerStatus := webhookProviderStatus(payload)
	rejectLabels := sumsubRejectLabelsJSON(payload.ReviewResult.RejectLabels)
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `INSERT OR IGNORE INTO sumsub_webhook_events
		  (id, verification_id, event_type, payload_sha256, applicant_id, external_user_id,
		   sandbox_mode, occurred_at, received_at, processed_at)
		  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, Params: []any{
			randomID("sumsub_event"), verificationID, safeWebhookText(payload.Type, 80), hex.EncodeToString(digest[:]),
			payload.ApplicantID, payload.ExternalID, payload.SandboxMode, nullIfEmpty(safeWebhookText(occurredAt, 80)), nowText, nowText,
		}},
		d1.Statement{SQL: `UPDATE customer_kyc_verifications
		  SET applicant_id=?, status=?, review_status=?, review_answer=?, review_reject_type=?,
		      reject_labels_json=?, moderation_comment=?, client_comment=?, last_event_at=?, updated_at=?, version=version+1
		  WHERE id=? AND (applicant_id IS NULL OR applicant_id=?)`, Params: []any{
			payload.ApplicantID, providerStatus, nullIfEmpty(safeWebhookText(payload.ReviewStatus, 40)),
			nullIfEmpty(safeWebhookText(payload.ReviewResult.ReviewAnswer, 16)),
			nullIfEmpty(safeWebhookText(payload.ReviewResult.ReviewRejectType, 16)), rejectLabels,
			nullIfEmpty(safeWebhookText(payload.ReviewResult.ModerationComment, 4000)),
			nullIfEmpty(safeWebhookText(payload.ReviewResult.ClientComment, 4000)), nowText, nowText,
			verificationID, payload.ApplicantID,
		}},
		sumsubSyncJobStatement(verificationID, nowText),
	)
	if err != nil || len(results) != 3 {
		if err == nil {
			err = errors.New("unexpected Sumsub webhook database result")
		}
		databaseError(app, w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func safeWebhookText(value string, maximum int) string {
	value = strings.TrimSpace(value)
	if len([]rune(value)) <= maximum {
		return value
	}
	return string([]rune(value)[:maximum])
}

func sumsubRejectLabelsJSON(labels []string) string {
	if len(labels) == 0 {
		return "[]"
	}
	encoded, err := json.Marshal(labels)
	if err != nil {
		return "[]"
	}
	return string(encoded)
}

func webhookProviderStatus(payload sumsubWebhookPayload) string {
	if payload.ReviewStatus == "completed" && payload.ReviewResult.ReviewAnswer == "RED" {
		if payload.ReviewResult.ReviewRejectType == "RETRY" {
			return "resubmission_required"
		}
		return "provider_rejected"
	}
	if payload.ReviewStatus == "init" || payload.Type == "applicantCreated" {
		return "awaiting_applicant"
	}
	return "provider_reviewing"
}

func sumsubSyncJobStatement(verificationID, nowText string) d1.Statement {
	return d1.Statement{SQL: `INSERT INTO sumsub_sync_jobs
	  (id, verification_id, status, attempts, run_after, created_at, updated_at)
	  VALUES (?, ?, 'pending', 0, ?, ?, ?)
	  ON CONFLICT(verification_id) DO UPDATE SET status='pending', attempts=0, run_after=excluded.run_after,
	    locked_at=NULL, last_error_code=NULL, updated_at=excluded.updated_at`, Params: []any{
		randomID("sumsub_job"), verificationID, nowText, nowText, nowText,
	}}
}

func (app *application) enqueueSumsubSync(w http.ResponseWriter, r *http.Request, customerID string) {
	if !app.sumsubSchemaReady {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]string{"code": "sumsub_verification_not_found"}})
		return
	}
	if app.sumsub == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": map[string]string{"code": "sumsub_not_configured"}})
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT id FROM customer_kyc_verifications WHERE tenant_id=? AND customer_id=?`, app.tenantID, customerID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]string{"code": "sumsub_verification_not_found"}})
		return
	}
	nowText := databaseTimestamp(time.Now())
	_, err = app.db.Batch(r.Context(), sumsubSyncJobStatement(text(rows[0]["id"]), nowText))
	if err != nil {
		databaseError(app, w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "sync_queued"})
}

func (app *application) writeAdminSumsubVerification(w http.ResponseWriter, r *http.Request, customerID string) {
	if !app.sumsubSchemaReady {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]string{"code": "sumsub_verification_not_found"}})
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT id, provider, external_user_id, applicant_id, level_name, environment,
	  status, review_status, review_answer, review_reject_type, reject_labels_json, moderation_comment,
	  client_comment, provider_created_at, provider_reviewed_at, last_event_at, last_synced_at, version, created_at, updated_at
	  FROM customer_kyc_verifications WHERE tenant_id=? AND customer_id=?`, app.tenantID, customerID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]string{"code": "sumsub_verification_not_found"}})
		return
	}
	verificationID := text(rows[0]["id"])
	steps, err := app.db.Query(r.Context(), `SELECT step_type, review_answer, review_reject_type, document_type,
	  document_country, reject_labels_json, moderation_comment, client_comment, updated_at
	  FROM customer_kyc_steps WHERE verification_id=? ORDER BY step_type`, verificationID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	events, err := app.db.Query(r.Context(), `SELECT event_type, occurred_at, received_at, processed_at
	  FROM sumsub_webhook_events WHERE verification_id=? ORDER BY received_at DESC LIMIT 50`, verificationID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	rows[0]["reject_labels"] = jsonStringArray(rows[0]["reject_labels_json"])
	delete(rows[0], "reject_labels_json")
	for _, step := range steps {
		step["reject_labels"] = jsonStringArray(step["reject_labels_json"])
		delete(step, "reject_labels_json")
	}
	rows[0]["steps"] = steps
	rows[0]["events"] = events
	writeJSON(w, http.StatusOK, rows[0])
}

func (app *application) runSumsubSyncWorker(ctx context.Context) {
	if app.sumsub == nil {
		return
	}
	app.logger.Info("sumsub sync worker started")
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			app.processOneSumsubSync(ctx)
		}
	}
}

func (app *application) processOneSumsubSync(ctx context.Context) {
	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	staleLock := databaseTimestamp(now.Add(-2 * time.Minute))
	rows, err := app.db.Query(ctx, `WITH candidate AS (
	  SELECT job.id FROM sumsub_sync_jobs job
	  WHERE job.attempts<8 AND job.run_after<=?
	    AND (job.status IN ('pending','failed') OR (job.status='processing' AND job.locked_at<?))
	  ORDER BY job.run_after, job.created_at FOR UPDATE SKIP LOCKED LIMIT 1
	)
	UPDATE sumsub_sync_jobs job SET status='processing', attempts=attempts+1, locked_at=?, updated_at=?
	FROM candidate WHERE job.id=candidate.id
	RETURNING job.id, job.verification_id, job.attempts`, nowText, staleLock, nowText, nowText)
	if err != nil {
		app.logger.Error("sumsub sync job selection failed", "error", err)
		return
	}
	if len(rows) == 0 {
		return
	}
	jobID := text(rows[0]["id"])
	verificationID := text(rows[0]["verification_id"])
	verificationRows, err := app.db.Query(ctx, `SELECT customer_id, applicant_id, status, level_name, environment
	  FROM customer_kyc_verifications WHERE id=?`, verificationID)
	if err != nil || len(verificationRows) != 1 || text(verificationRows[0]["applicant_id"]) == "" {
		app.failSumsubSyncJob(ctx, jobID, integer(rows[0]["attempts"]), "verification_unavailable")
		return
	}
	verification := verificationRows[0]
	if text(verification["level_name"]) != app.sumsub.LevelName() || text(verification["environment"]) != app.sumsubEnvironment {
		app.failSumsubSyncJob(ctx, jobID, 8, "configuration_mismatch")
		return
	}
	syncContext, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	applicantID := text(verification["applicant_id"])
	review, err := app.sumsub.GetReviewStatus(syncContext, applicantID)
	if err != nil {
		app.failSumsubSyncJob(ctx, jobID, integer(rows[0]["attempts"]), "review_status_unavailable")
		return
	}
	steps, err := app.sumsub.GetRequiredSteps(syncContext, applicantID)
	if err != nil {
		app.failSumsubSyncJob(ctx, jobID, integer(rows[0]["attempts"]), "required_steps_unavailable")
		return
	}
	steps = sumsubEffectiveRequiredSteps(steps)
	nextStatus := sumsubProviderStatus(review, steps)
	rejectLabels := sumsubRejectLabelsJSON(review.ReviewResult.RejectLabels)
	statements := []d1.Statement{{SQL: `UPDATE customer_kyc_verifications
	  SET status=?, review_status=?, review_answer=?, review_reject_type=?, reject_labels_json=?,
	      moderation_comment=?, client_comment=?, provider_created_at=?, provider_reviewed_at=?,
	      last_synced_at=?, updated_at=?, version=version+1 WHERE id=?`, Params: []any{
		nextStatus, nullIfEmpty(review.ReviewStatus), nullIfEmpty(review.ReviewResult.ReviewAnswer),
		nullIfEmpty(review.ReviewResult.ReviewRejectType), rejectLabels,
		nullIfEmpty(safeWebhookText(review.ReviewResult.ModerationComment, 4000)),
		nullIfEmpty(safeWebhookText(review.ReviewResult.ClientComment, 4000)),
		nullIfEmpty(safeWebhookText(review.CreateDate, 80)), nullIfEmpty(safeWebhookText(review.ReviewDate, 80)),
		nowText, nowText, verificationID,
	}}}
	for _, stepType := range []string{"IDENTITY", "SELFIE", "PROOF_OF_RESIDENCE"} {
		step := steps[stepType]
		labels := sumsubRejectLabelsJSON(step.ReviewResult.RejectLabels)
		statements = append(statements, d1.Statement{SQL: `INSERT INTO customer_kyc_steps
		  (verification_id, step_type, review_answer, review_reject_type, document_type, document_country,
		   reject_labels_json, moderation_comment, client_comment, updated_at)
		  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		  ON CONFLICT(verification_id, step_type) DO UPDATE SET review_answer=excluded.review_answer,
		    review_reject_type=excluded.review_reject_type, document_type=excluded.document_type,
		    document_country=excluded.document_country, reject_labels_json=excluded.reject_labels_json,
		    moderation_comment=excluded.moderation_comment, client_comment=excluded.client_comment,
		    updated_at=excluded.updated_at`, Params: []any{
			verificationID, stepType, nullIfEmpty(step.ReviewResult.ReviewAnswer),
			nullIfEmpty(step.ReviewResult.ReviewRejectType), nullIfEmpty(step.IDDocType), nullIfEmpty(step.Country),
			labels, nullIfEmpty(safeWebhookText(step.ReviewResult.ModerationComment, 4000)),
			nullIfEmpty(safeWebhookText(step.ReviewResult.ClientComment, 4000)), nowText,
		}})
	}
	if text(verification["status"]) != nextStatus {
		statements = append(statements, d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at) VALUES (?, ?, 'customer.sumsub_status_changed', 'sumsub_integration', ?, ?)`, Params: []any{
			randomID("audit"), text(verification["customer_id"]),
			mustJSON(map[string]string{"from": text(verification["status"]), "to": nextStatus}), nowText,
		}})
	}
	statements = append(statements, d1.Statement{SQL: `UPDATE sumsub_sync_jobs SET status='completed', locked_at=NULL,
	  last_error_code=NULL, updated_at=? WHERE id=? AND status='processing'`, Params: []any{nowText, jobID}})
	if _, err := app.db.Batch(ctx, statements...); err != nil {
		app.failSumsubSyncJob(ctx, jobID, integer(rows[0]["attempts"]), "database_update_failed")
		return
	}
	app.logger.Info("sumsub sync job completed", "provider_status", nextStatus,
		"identity", steps["IDENTITY"].ReviewResult.ReviewAnswer,
		"selfie", steps["SELFIE"].ReviewResult.ReviewAnswer,
		"proof_of_residence", steps["PROOF_OF_RESIDENCE"].ReviewResult.ReviewAnswer)
}

func sumsubEffectiveRequiredSteps(steps sumsubapi.RequiredSteps) sumsubapi.RequiredSteps {
	for stepType, step := range steps {
		if step.ReviewResult.ReviewAnswer == "GREEN" || len(step.ImageStatuses) == 0 {
			continue
		}
		allActiveImagesGreen := true
		for _, image := range step.ImageStatuses {
			if image.ReviewResult.ReviewAnswer != "GREEN" {
				allActiveImagesGreen = false
				break
			}
		}
		if allActiveImagesGreen {
			step.ReviewResult = sumsubapi.ReviewResult{ReviewAnswer: "GREEN"}
			steps[stepType] = step
		}
	}
	return steps
}

func sumsubProviderStatus(review sumsubapi.ReviewStatus, steps sumsubapi.RequiredSteps) string {
	if review.ReviewStatus == "completed" && review.ReviewResult.ReviewAnswer == "RED" {
		if review.ReviewResult.ReviewRejectType == "RETRY" {
			return "resubmission_required"
		}
		return "provider_rejected"
	}
	if review.ReviewStatus == "completed" && review.ReviewResult.ReviewAnswer == "GREEN" &&
		steps["IDENTITY"].ReviewResult.ReviewAnswer == "GREEN" && steps["IDENTITY"].IDDocType == "PASSPORT" &&
		steps["SELFIE"].ReviewResult.ReviewAnswer == "GREEN" &&
		steps["PROOF_OF_RESIDENCE"].ReviewResult.ReviewAnswer == "GREEN" {
		return "ready_for_admin_review"
	}
	if review.ReviewStatus == "init" || review.ReviewStatus == "" {
		return "awaiting_applicant"
	}
	return "provider_reviewing"
}

func (app *application) failSumsubSyncJob(ctx context.Context, jobID string, attempts int64, errorCode string) {
	status := "failed"
	if attempts >= 8 {
		status = "dead"
	}
	now := time.Now().UTC()
	runAfter := now.Add(time.Duration(maxInt64(1, attempts)) * time.Minute)
	_, _ = app.db.Batch(ctx, d1.Statement{SQL: `UPDATE sumsub_sync_jobs SET status=?, run_after=?, locked_at=NULL,
	  last_error_code=?, updated_at=? WHERE id=?`, Params: []any{status, databaseTimestamp(runAfter), errorCode,
		databaseTimestamp(now), jobID}})
	app.logger.Warn("sumsub sync job failed", "error_code", errorCode, "attempts", attempts, "status", status)
}

func maxInt64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
