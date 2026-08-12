package cregis

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSignMatchesPublishedCregisAlgorithm(t *testing.T) {
	client := &Client{secret: "f502a9ac9ca54327986f29c03b271491"}
	payload := map[string]any{
		"pid":            int64(1382528827416576),
		"currency":       "195@195",
		"address":        "TXsmKpEuW7qWnXzJLGP9eDLvWPR2GRn1FS",
		"amount":         "1.1",
		"remark":         "payout",
		"third_party_id": "c9231e604da54469a735af3f449c880f",
		"callback_url":   "http://192.168.2.29:9099/callback",
		"nonce":          "hwlkk6",
		"timestamp":      int64(1688004243314),
	}
	// The prose page shows a conflicting intermediate digest. The final request
	// example and the official Go SDK both produce this value.
	if actual := client.Sign(payload); actual != "d6eef2de79e39f434a38efb910213ba6" {
		t.Fatalf("unexpected signature: %s", actual)
	}
}

func TestVerifyPreservesLargeJSONNumbers(t *testing.T) {
	client := &Client{secret: "test-secret-for-signing"}
	payload := map[string]any{
		"pid":       json.Number("1463535767997152"),
		"cid":       json.Number("1463535767997999"),
		"status":    json.Number("6"),
		"timestamp": json.Number("1688004243314"),
		"nonce":     "abc123",
	}
	payload["sign"] = client.Sign(payload)
	if !client.Verify(payload) {
		t.Fatal("expected callback signature to verify")
	}
	payload["status"] = json.Number("7")
	if client.Verify(payload) {
		t.Fatal("tampered callback must not verify")
	}
}

func TestCallUsesAuthenticatedRelayWithoutChangingCregisPayload(t *testing.T) {
	var receivedBody []byte
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/address/create" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		for _, header := range []string{"X-Neobank-Relay-Timestamp", "X-Neobank-Relay-Nonce", "X-Neobank-Relay-Signature"} {
			if r.Header.Get(header) == "" {
				t.Errorf("missing relay header %s", header)
			}
		}
		receivedBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"code":"00000","msg":"ok","data":{}}`)
	}))
	defer server.Close()

	client, err := New(Config{
		BaseURL:     "https://t-wsmbuuhb.cregis.io",
		ProjectID:   "1463535767997152",
		Secret:      "cregis-test-secret",
		RelayURL:    server.URL,
		RelaySecret: strings.Repeat("r", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	client.httpClient = server.Client()
	if _, err := client.Call(context.Background(), "/api/v1/address/create", map[string]any{"currency": "195@195"}); err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(receivedBody, &payload); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"pid", "currency", "nonce", "timestamp", "sign"} {
		if _, ok := payload[key]; !ok {
			t.Fatalf("Cregis payload missing %s", key)
		}
	}
}
