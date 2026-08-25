package coreaccounting

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

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
