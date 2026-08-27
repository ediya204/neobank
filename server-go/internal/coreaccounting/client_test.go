package coreaccounting

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientCreatesSignedCustomerFiatPayout(t *testing.T) {
	secret := strings.Repeat("s", 32)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/internal/customer-payouts" {
			t.Fatalf("unexpected Core path: %s", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		var payload map[string]any
		if json.Unmarshal(body, &payload) != nil || payload["customerId"] != "customer_test" || payload["amount"] != "100" {
			t.Fatalf("unexpected payout payload: %s", body)
		}
		bodyHash := sha256.Sum256(body)
		canonical := strings.Join([]string{
			r.Header.Get("X-Core-Edge-Timestamp"), r.Method, r.URL.RequestURI(),
			r.Header.Get("X-Neobank-User"), hex.EncodeToString(bodyHash[:]),
		}, "\n")
		mac := hmac.New(sha256.New, []byte(secret))
		_, _ = mac.Write([]byte(canonical))
		if r.Header.Get("X-Core-Edge-Signature") != hex.EncodeToString(mac.Sum(nil)) {
			t.Fatal("customer payout signature mismatch")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"operation_test","reference":"OP-TEST","customerId":"customer_test","status":"PROCESSING","currency":"USD","amount":"100.00","feeAmount":"20"}`))
	}))
	defer server.Close()

	client, err := New(Config{BaseURL: server.URL, Secret: secret})
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.CreateCustomerPayout(context.Background(), CustomerPayoutRequest{
		CustomerID: "customer_test", CustomerEmail: "customer@example.com", Currency: "USD",
		Amount: "100", SourceAccountID: "account_test", BeneficiaryID: "beneficiary_test",
		ChannelID: "channel_test", PayoutMethod: "PLATFORM", ExpectedFeeAmount: "20",
		ExpectedFeeRuleVersion: "7", IdempotencyKey: "request_test",
	})
	if err != nil || result.ID != "operation_test" || result.Status != "PROCESSING" || result.FeeAmount != "20" {
		t.Fatalf("CreateCustomerPayout() = %#v, %v", result, err)
	}
}

func TestClientSignsExactCoreAccountingRequest(t *testing.T) {
	secret := strings.Repeat("s", 32)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		bodyHash := sha256.Sum256(body)
		canonical := strings.Join([]string{
			r.Header.Get("X-Core-Edge-Timestamp"), r.Method, r.URL.RequestURI(),
			r.Header.Get("X-Neobank-User"), hex.EncodeToString(bodyHash[:]),
		}, "\n")
		mac := hmac.New(sha256.New, []byte(secret))
		_, _ = mac.Write([]byte(canonical))
		if r.Header.Get("X-Neobank-User") != serviceIdentity ||
			r.Header.Get("X-Core-Edge-Signature") != hex.EncodeToString(mac.Sum(nil)) {
			t.Fatal("Core accounting request signature mismatch")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"withdrawal_test","action":"reserve","status":"reserved","idempotent":false}`))
	}))
	defer server.Close()

	client, err := New(Config{BaseURL: server.URL, Secret: secret})
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.AdvanceWithdrawal(context.Background(), "withdrawal_test", "reserve")
	if err != nil || result.Status != "reserved" {
		t.Fatalf("AdvanceWithdrawal() = %#v, %v", result, err)
	}
}

func TestClientRejectsWeakOrInsecureConfiguration(t *testing.T) {
	if _, err := New(Config{BaseURL: "https://core.example.com", Secret: "short"}); err == nil {
		t.Fatal("weak accounting secret accepted")
	}
	if _, err := New(Config{BaseURL: "http://core.example.com", Secret: strings.Repeat("s", 32)}); err == nil {
		t.Fatal("public cleartext Core origin accepted")
	}
	if _, err := New(Config{BaseURL: "http://neobank-core:10000", Secret: strings.Repeat("s", 32)}); err != nil {
		t.Fatalf("private single-label Core origin rejected: %v", err)
	}
}
