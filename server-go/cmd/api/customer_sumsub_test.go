package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	sumsubapi "github.com/ediya204/neobank/server-go/internal/sumsub"
)

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
