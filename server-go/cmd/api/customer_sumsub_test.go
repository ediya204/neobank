package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	sumsubapi "github.com/ediya204/neobank/server-go/internal/sumsub"
)

func onboardingRestartFixture(t *testing.T) (*application, *sessionTouchDatabase, *http.Request) {
	t.Helper()
	now := time.Now().UTC()
	token := strings.Repeat("t", 32)
	csrf := strings.Repeat("c", 32)
	db := &sessionTouchDatabase{batchChanges: 1, rows: []map[string]any{{
		"id": "onboarding_session_test", "customer_id": "customer_test", "csrf_hash": tokenHash(csrf),
		"expires_at": databaseTimestamp(now.Add(time.Hour)), "idle_expires_at": databaseTimestamp(now.Add(30 * time.Minute)),
		"email": "applicant@example.test", "phone_country_code": "+852", "phone": "61234567",
		"residence_country": "HK", "application_reference": "SSC-20260820-ABC123",
		"verification_id": "verification_test", "external_user_id": "neobank:customer_test",
		"applicant_id": "0123456789abcdef01234567", "provider_status": "awaiting_applicant",
	}}}
	app := &application{db: db, portalURL: "http://localhost:3000", tenantID: "neobank"}
	request := httptest.NewRequest(http.MethodPost, "/api/auth/customer/onboarding/restart", strings.NewReader(`{}`))
	request.AddCookie(&http.Cookie{Name: app.onboardingCookieName(), Value: token})
	request.AddCookie(&http.Cookie{Name: app.onboardingCSRFCookieName(), Value: csrf})
	request.Header.Set("X-CSRF-Token", csrf)
	return app, db, request
}

func TestRestartCustomerOnboardingRevokesSessionAuditsAndClearsCookies(t *testing.T) {
	app, db, request := onboardingRestartFixture(t)
	response := httptest.NewRecorder()

	app.restartCustomerOnboarding(response, request)

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"onboarding_session_revoked"`) {
		t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
	}
	if db.batchCalls != 2 || len(db.statements) != 3 {
		t.Fatalf("batch calls=%d statements=%d", db.batchCalls, len(db.statements))
	}
	if !strings.Contains(db.statements[1].SQL, "UPDATE customer_onboarding_sessions") ||
		!strings.Contains(db.statements[1].SQL, "revoked_at") ||
		!strings.Contains(db.statements[2].SQL, "customer.onboarding_session_revoked") {
		t.Fatalf("restart statements do not revoke and audit: %#v", db.statements[1:])
	}
	if got := db.statements[1].Params[2]; got != "onboarding_session_test" {
		t.Fatalf("revoked session id=%v", got)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 2 {
		t.Fatalf("cleared cookies=%d", len(cookies))
	}
	for _, cookie := range cookies {
		if cookie.Value != "" || cookie.MaxAge >= 0 {
			t.Fatalf("cookie %s was not expired: value=%q maxAge=%d", cookie.Name, cookie.Value, cookie.MaxAge)
		}
	}
}

func TestRestartCustomerOnboardingRequiresMatchingCSRF(t *testing.T) {
	app, db, request := onboardingRestartFixture(t)
	request.Header.Del("X-CSRF-Token")
	response := httptest.NewRecorder()

	app.restartCustomerOnboarding(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
	}
	if db.batchCalls != 1 || len(db.statements) != 1 || strings.Contains(db.statements[0].SQL, "SET revoked_at") {
		t.Fatalf("invalid CSRF must not revoke the session: calls=%d statements=%#v", db.batchCalls, db.statements)
	}
	if len(response.Result().Cookies()) != 0 {
		t.Fatal("invalid CSRF must not clear session cookies")
	}
}

func TestVerifySumsubWebhookUsesRawPayloadAndDeclaredAlgorithm(t *testing.T) {
	app := &application{sumsubWebhookSecret: []byte("0123456789abcdef0123456789abcdef")}
	payload := []byte(`{"type":"applicantReviewed","applicantId":"0123456789abcdef01234567"}`)
	mac := hmac.New(sha256.New, app.sumsubWebhookSecret)
	_, _ = mac.Write(payload)
	signature := hex.EncodeToString(mac.Sum(nil))

	if !app.verifySumsubWebhook(payload, "HMAC_SHA256_HEX", signature) {
		t.Fatal("valid Sumsub signature was rejected")
	}
	if app.verifySumsubWebhook(append(payload, '\n'), "HMAC_SHA256_HEX", signature) {
		t.Fatal("signature must cover the exact raw payload")
	}
	if app.verifySumsubWebhook(payload, "SHA256", signature) {
		t.Fatal("undeclared digest algorithms must be rejected")
	}
}

func TestSumsubProviderStatusRequiresAllIndividualChecks(t *testing.T) {
	greenReview := sumsubapi.ReviewStatus{
		ReviewStatus: "completed",
		ReviewResult: sumsubapi.ReviewResult{ReviewAnswer: "GREEN"},
	}
	greenSteps := func() sumsubapi.RequiredSteps {
		return sumsubapi.RequiredSteps{
			"IDENTITY":           {IDDocType: "PASSPORT", ReviewResult: sumsubapi.ReviewResult{ReviewAnswer: "GREEN"}},
			"SELFIE":             {ReviewResult: sumsubapi.ReviewResult{ReviewAnswer: "GREEN"}},
			"PROOF_OF_RESIDENCE": {ReviewResult: sumsubapi.ReviewResult{ReviewAnswer: "GREEN"}},
		}
	}
	if got := sumsubProviderStatus(greenReview, greenSteps()); got != "ready_for_admin_review" {
		t.Fatalf("all green checks status = %q", got)
	}

	missingAddress := greenSteps()
	missingAddress["PROOF_OF_RESIDENCE"] = sumsubapi.StepStatus{}
	if got := sumsubProviderStatus(greenReview, missingAddress); got != "provider_reviewing" {
		t.Fatalf("missing proof of residence status = %q", got)
	}

	nationalID := greenSteps()
	nationalID["IDENTITY"] = sumsubapi.StepStatus{IDDocType: "ID_CARD", ReviewResult: sumsubapi.ReviewResult{ReviewAnswer: "GREEN"}}
	if got := sumsubProviderStatus(greenReview, nationalID); got != "provider_reviewing" {
		t.Fatalf("non-passport identity status = %q", got)
	}
}

func TestSumsubProviderStatusSeparatesRetryAndFinalRejection(t *testing.T) {
	for rejectType, want := range map[string]string{
		"RETRY": "resubmission_required",
		"FINAL": "provider_rejected",
	} {
		review := sumsubapi.ReviewStatus{
			ReviewStatus: "completed",
			ReviewResult: sumsubapi.ReviewResult{ReviewAnswer: "RED", ReviewRejectType: rejectType},
		}
		if got := sumsubProviderStatus(review, nil); got != want {
			t.Fatalf("%s rejection status = %q, want %q", rejectType, got, want)
		}
	}
}

func TestGreenApplicantReviewedWebhookUnlocksOnlyManualReview(t *testing.T) {
	payload := sumsubWebhookPayload{
		Type:         "applicantReviewed",
		ReviewStatus: "completed",
		ReviewResult: sumsubapi.ReviewResult{ReviewAnswer: "GREEN"},
	}
	if got := webhookProviderStatus(payload); got != "ready_for_admin_review" {
		t.Fatalf("green reviewed webhook status = %q", got)
	}
	statements := sumsubWebhookStepStatements("verification_test", payload, "2026-08-20T14:00:00Z")
	if len(statements) != 3 {
		t.Fatalf("green reviewed webhook step statements = %d, want 3", len(statements))
	}
	for index, stepType := range []string{"IDENTITY", "SELFIE", "PROOF_OF_RESIDENCE"} {
		params := statements[index].Params
		if len(params) != 4 || params[0] != "verification_test" || params[1] != stepType {
			t.Fatalf("%s step params = %#v", stepType, params)
		}
	}

	payload.Type = "applicantPending"
	if got := webhookProviderStatus(payload); got != "provider_reviewing" {
		t.Fatalf("non-final green webhook status = %q", got)
	}
	if statements := sumsubWebhookStepStatements("verification_test", payload, "2026-08-20T14:00:00Z"); len(statements) != 0 {
		t.Fatalf("non-final webhook created %d step statements", len(statements))
	}
}

func TestSumsubEffectiveRequiredStepsUsesOnlyActiveImageStatuses(t *testing.T) {
	steps := sumsubapi.RequiredSteps{
		"PROOF_OF_RESIDENCE": {
			IDDocType: "UTILITY_BILL",
			ReviewResult: sumsubapi.ReviewResult{
				ReviewAnswer:      "RED",
				ReviewRejectType:  "RETRY",
				RejectLabels:      []string{"BAD_PROOF_OF_ADDRESS"},
				ModerationComment: "Upload another document",
			},
			ImageStatuses: []sumsubapi.ImageStatus{{
				ImageID:      "active-green-image",
				ReviewResult: sumsubapi.ReviewResult{ReviewAnswer: "GREEN"},
			}},
		},
	}

	effective := sumsubEffectiveRequiredSteps(steps)["PROOF_OF_RESIDENCE"]
	if effective.ReviewResult.ReviewAnswer != "GREEN" {
		t.Fatalf("active green image status = %q", effective.ReviewResult.ReviewAnswer)
	}
	if effective.ReviewResult.ReviewRejectType != "" || len(effective.ReviewResult.RejectLabels) != 0 ||
		effective.ReviewResult.ModerationComment != "" {
		t.Fatal("stale rejection details must be cleared after an active green replacement")
	}

	steps["PROOF_OF_RESIDENCE"] = sumsubapi.StepStatus{
		ReviewResult: sumsubapi.ReviewResult{ReviewAnswer: "RED"},
		ImageStatuses: []sumsubapi.ImageStatus{
			{ImageID: "green", ReviewResult: sumsubapi.ReviewResult{ReviewAnswer: "GREEN"}},
			{ImageID: "red", ReviewResult: sumsubapi.ReviewResult{ReviewAnswer: "RED"}},
		},
	}
	if got := sumsubEffectiveRequiredSteps(steps)["PROOF_OF_RESIDENCE"].ReviewResult.ReviewAnswer; got != "RED" {
		t.Fatalf("mixed active image status = %q, want RED", got)
	}
}

func TestSumsubRejectLabelsJSONAlwaysReturnsAnArray(t *testing.T) {
	for name, test := range map[string]struct {
		labels []string
		want   string
	}{
		"nil":       {labels: nil, want: "[]"},
		"empty":     {labels: []string{}, want: "[]"},
		"populated": {labels: []string{"LOW_QUALITY", "UNSATISFACTORY_PHOTOS"}, want: `["LOW_QUALITY","UNSATISFACTORY_PHOTOS"]`},
	} {
		t.Run(name, func(t *testing.T) {
			if got := sumsubRejectLabelsJSON(test.labels); got != test.want {
				t.Fatalf("sumsubRejectLabelsJSON() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestSumsubProviderOrNilKeepsDisabledProviderNil(t *testing.T) {
	if provider := sumsubProviderOrNil(nil); provider != nil {
		t.Fatal("disabled Sumsub provider must remain a nil interface")
	}
}
