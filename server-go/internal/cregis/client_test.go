package cregis

import (
	"encoding/json"
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
