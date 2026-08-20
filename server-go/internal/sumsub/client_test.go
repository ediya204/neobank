package sumsub

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func testClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewTLSServer(handler)
	t.Cleanup(server.Close)
	baseURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	return &Client{
		baseURL:    baseURL,
		appToken:   "sandbox-app-token",
		secret:     []byte("sandbox-secret-value"),
		level:      "neobank_individual_v1",
		httpClient: server.Client(),
		now:        func() time.Time { return time.Unix(1_700_000_000, 0) },
	}
}

func TestCreateSDKTokenSignsExactRequest(t *testing.T) {
	client := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		canonical := "1700000000POST" + r.URL.RequestURI() + string(body)
		mac := hmac.New(sha256.New, []byte("sandbox-secret-value"))
		_, _ = mac.Write([]byte(canonical))
		if got, want := r.Header.Get("X-App-Access-Sig"), hex.EncodeToString(mac.Sum(nil)); got != want {
			t.Fatalf("signature = %q, want %q", got, want)
		}
		if r.Header.Get("X-App-Token") != "sandbox-app-token" {
			t.Fatal("app token header is missing")
		}
		if !strings.Contains(string(body), `"levelName":"neobank_individual_v1"`) {
			t.Fatalf("unexpected body: %s", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"token":"opaque-token","userId":"neobank:customer_1"}`))
	})
	token, err := client.CreateSDKToken(t.Context(), ApplicantInput{
		ExternalUserID: "neobank:customer_1", Email: "person@example.com", Phone: "+85255555555",
	}, 600)
	if err != nil {
		t.Fatal(err)
	}
	if token.Token != "opaque-token" {
		t.Fatalf("token = %q", token.Token)
	}
}

func TestEnsureApplicantRecoversFromConflictByExternalID(t *testing.T) {
	requests := 0
	client := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method == http.MethodPost {
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"errorName":"applicant-already-exists"}`))
			return
		}
		if !strings.Contains(r.URL.RequestURI(), "externalUserId=neobank:customer_1") {
			t.Fatalf("unexpected recovery URI: %s", r.URL.RequestURI())
		}
		_, _ = w.Write([]byte(`{"id":"0123456789abcdef01234567","externalUserId":"neobank:customer_1"}`))
	})
	applicant, err := client.EnsureApplicant(t.Context(), ApplicantInput{
		ExternalUserID: "neobank:customer_1", Email: "person@example.com", Phone: "+85255555555", Country: "HKG",
	})
	if err != nil {
		t.Fatal(err)
	}
	if requests != 2 || applicant.ID != "0123456789abcdef01234567" {
		t.Fatalf("requests=%d applicant=%#v", requests, applicant)
	}
}

func TestCreateSDKTokenRejectsUnexpectedUser(t *testing.T) {
	client := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"token":"opaque-token","userId":"different-user"}`))
	})
	_, err := client.CreateSDKToken(t.Context(), ApplicantInput{ExternalUserID: "expected-user"}, 600)
	if err == nil || !strings.Contains(err.Error(), "invalid") {
		t.Fatalf("expected invalid response error, got %v", err)
	}
}

func TestGetRequiredStepsPreservesOnlyStructuredFields(t *testing.T) {
	client := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{
			"IDENTITY":{"reviewResult":{"reviewAnswer":"GREEN"},"country":"HKG","idDocType":"PASSPORT"},
			"SELFIE":{"reviewResult":{"reviewAnswer":"GREEN"},"idDocType":"SELFIE"},
			"PROOF_OF_RESIDENCE":{"reviewResult":{"reviewAnswer":"GREEN"},"country":"HKG","idDocType":"UTILITY_BILL"}
		}`))
	})
	steps, err := client.GetRequiredSteps(t.Context(), "0123456789abcdef01234567")
	if err != nil {
		t.Fatal(err)
	}
	if steps["IDENTITY"].IDDocType != "PASSPORT" || steps["PROOF_OF_RESIDENCE"].ReviewResult.ReviewAnswer != "GREEN" {
		t.Fatalf("unexpected steps: %#v", steps)
	}
}
