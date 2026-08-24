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

func TestDepositTradeReturnsTheSingleExactTransaction(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/trade/page" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		for key, expected := range map[string]float64{
			"cid": 1463535767997001, "trade_type": 1, "business_type": 3, "page_num": 1, "page_size": 10,
		} {
			if payload[key] != expected {
				t.Errorf("%s = %v; want %v", key, payload[key], expected)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		// gitleaks:allow -- token_id is the public TRON USDT contract address used by the fixture.
		_, _ = io.WriteString(w, `{"code":"00000","msg":"ok","data":{"rows":[{"cid":1463535767997001,"chain_id":"195","token_id":"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t","to_address":"TFbXZoaXDCWq318W2HghRmrXktCvCzoX9K","from_address":"TXsmKpEuW7qWnXzJLGP9eDLvWPR2GRn1FS","amount":"0.1","status":1,"txid":"tx-deposit-1"}]}}`) // gitleaks:allow
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
	trade, err := client.DepositTrade(context.Background(), 1463535767997001, "tx-deposit-1", "195", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")
	if err != nil {
		t.Fatal(err)
	}
	if trade.FromAddress != "TXsmKpEuW7qWnXzJLGP9eDLvWPR2GRn1FS" {
		t.Fatalf("unexpected source address: %s", trade.FromAddress)
	}
}

func TestPayoutOrderQueriesTheExactWalletPayout(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/payout/query" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload["cid"] != float64(1463535767997999) {
			t.Fatalf("cid = %v", payload["cid"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"code":"00000","msg":"ok","data":{"chain_id":"195","token_id":"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t","currency":"USDT","from_address":"TXsmKpEuW7qWnXzJLGP9eDLvWPR2GRn1FS","address":"TFbXZoaXDCWq318W2HghRmrXktCvCzoX9K","amount":"1.2","status":6,"third_party_id":"withdrawal-test","txid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}`) // gitleaks:allow
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
	order, err := client.PayoutOrder(context.Background(), 1463535767997999)
	if err != nil {
		t.Fatal(err)
	}
	if order.Status != 6 || order.ThirdPartyID != "withdrawal-test" || order.Amount != "1.2" {
		t.Fatalf("unexpected payout order: %#v", order)
	}
}

func TestNewRequiresAuthenticatedRelay(t *testing.T) {
	base := Config{
		BaseURL:   "https://t-wsmbuuhb.cregis.io",
		ProjectID: "1463535767997152",
		Secret:    "cregis-test-secret",
	}
	for _, test := range []struct {
		name        string
		relayURL    string
		relaySecret string
	}{
		{name: "missing relay"},
		{name: "direct Cregis origin", relayURL: "https://t-wsmbuuhb.cregis.io", relaySecret: strings.Repeat("r", 32)},
		{name: "http relay", relayURL: "http://relay.example.com", relaySecret: strings.Repeat("r", 32)},
		{name: "relay path", relayURL: "https://relay.example.com/path", relaySecret: strings.Repeat("r", 32)},
		{name: "weak relay secret", relayURL: "https://relay.example.com", relaySecret: "short"},
	} {
		t.Run(test.name, func(t *testing.T) {
			config := base
			config.RelayURL = test.relayURL
			config.RelaySecret = test.relaySecret
			if _, err := New(config); err == nil {
				t.Fatal("expected unsafe relay configuration to fail")
			}
		})
	}
	base.RelayURL = "https://relay.example.com"
	base.RelaySecret = strings.Repeat("r", 32)
	if _, err := New(base); err != nil {
		t.Fatalf("expected authenticated HTTPS relay configuration to pass: %v", err)
	}
}
