package main

import (
	"crypto/rand"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRelayAuthenticationAndReplayProtection(t *testing.T) {
	now := time.Date(2026, 8, 13, 0, 0, 0, 0, time.UTC)
	app := &relay{
		secret: []byte("0123456789abcdef0123456789abcdef"),
		now:    func() time.Time { return now },
		nonces: make(map[string]time.Time),
	}
	body := []byte(`{"pid":1463535767997152}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/address/create", strings.NewReader(string(body)))
	timestamp := now.UnixMilli()
	nonce := "abcdefghijklmnopqrstuvwx"
	request.Header.Set("X-Neobank-Relay-Timestamp", "1786579200000")
	request.Header.Set("X-Neobank-Relay-Nonce", nonce)
	request.Header.Set("X-Neobank-Relay-Signature", hex.EncodeToString(relaySignature(app.secret, "1786579200000", nonce, request.Method, request.URL.Path, body)))

	if err := app.authenticate(request, body); err != nil {
		t.Fatalf("valid request rejected: %v (timestamp=%d)", err, timestamp)
	}
	if err := app.authenticate(request, body); err == nil || err.Error() != "replayed nonce" {
		t.Fatalf("expected replay rejection, got %v", err)
	}
}

func TestRelayAuthenticationRejectsTamperedBody(t *testing.T) {
	now := time.UnixMilli(1786579200000)
	secret := make([]byte, 32)
	_, _ = rand.Read(secret)
	app := &relay{secret: secret, now: func() time.Time { return now }, nonces: make(map[string]time.Time)}
	original := []byte(`{"amount":"1"}`)
	tampered := []byte(`{"amount":"2"}`)
	timestampMillis := "1786579200000"
	nonce := "unique-nonce-123456789"
	request := httptest.NewRequest(http.MethodPost, "/api/v2/payout", strings.NewReader(string(tampered)))
	request.Header.Set("X-Neobank-Relay-Timestamp", timestampMillis)
	request.Header.Set("X-Neobank-Relay-Nonce", nonce)
	request.Header.Set("X-Neobank-Relay-Signature", hex.EncodeToString(relaySignature(secret, timestampMillis, nonce, request.Method, request.URL.Path, original)))

	if err := app.authenticate(request, tampered); err == nil || err.Error() != "signature mismatch" {
		t.Fatalf("expected signature mismatch, got %v", err)
	}
}

func TestRelayRoutesAddressOwnershipThroughAuthentication(t *testing.T) {
	app := &relay{
		secret: []byte("0123456789abcdef0123456789abcdef"),
		now:    time.Now,
		nonces: make(map[string]time.Time),
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/address/inner", strings.NewReader(`{}`))
	response := httptest.NewRecorder()

	app.routes().ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("ownership route must reach relay authentication, got status %d", response.Code)
	}
}

func TestRelayRoutesTradeQueryThroughAuthentication(t *testing.T) {
	app := &relay{
		secret: []byte("0123456789abcdef0123456789abcdef"),
		now:    time.Now,
		nonces: make(map[string]time.Time),
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/trade/page", strings.NewReader(`{}`))
	response := httptest.NewRecorder()

	app.routes().ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("trade query route must reach relay authentication, got status %d", response.Code)
	}
}

func TestValidateUpstreamIsPinned(t *testing.T) {
	valid, err := validateUpstream(defaultUpstreamURL)
	if err != nil || valid.String() != defaultUpstreamURL {
		t.Fatalf("valid upstream rejected: %v", err)
	}
	for _, candidate := range []string{
		"http://t-wsmbuuhb.cregis.io",
		"https://t-wsmbuuhb.cregis.io.evil.example",
		"https://user@t-wsmbuuhb.cregis.io",
		"https://t-wsmbuuhb.cregis.io/api",
	} {
		if _, err := validateUpstream(candidate); err == nil {
			t.Fatalf("unsafe upstream accepted: %s", candidate)
		}
	}
}
