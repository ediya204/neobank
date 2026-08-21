package main

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	webauthnlib "github.com/go-webauthn/webauthn/webauthn"
)

func TestCustomerSecurityPayloadEncryptionIsPurposeBound(t *testing.T) {
	app := &application{
		tenantID:        "tenant_test",
		customerTOTPKey: []byte("0123456789abcdef0123456789abcdef"),
	}
	credential := webauthnlib.Credential{ID: []byte("credential-id"), PublicKey: []byte("public-key")}
	encrypted, err := app.encryptCustomerSecurityPayload("passkey-v1", credential)
	if err != nil || strings.Contains(encrypted, "credential-id") || strings.Contains(encrypted, "public-key") {
		t.Fatalf("passkey credential was not encrypted safely: %v", err)
	}
	var decoded webauthnlib.Credential
	if err := app.decryptCustomerSecurityPayload("passkey-v1", encrypted, &decoded); err != nil || string(decoded.ID) != "credential-id" {
		t.Fatalf("valid encrypted passkey failed: %#v %v", decoded, err)
	}
	if err := app.decryptCustomerSecurityPayload("webauthn-session-v1", encrypted, &decoded); err == nil {
		t.Fatal("encrypted passkey must not decrypt under a different purpose")
	}
}

func TestNewCustomerSessionStoresOnlyHashedContextAndSanitizedLabel(t *testing.T) {
	request := httptest.NewRequest("POST", "http://localhost/api/auth/customer/login", nil)
	request.Header.Set("X-Neobank-Source-IP-SHA256", strings.Repeat("a", 64))
	request.Header.Set("X-Neobank-User-Agent-SHA256", strings.Repeat("b", 64))
	request.Header.Set("X-Neobank-Device-Label", "Safari · macOS")
	_, _, _, statement := newCustomerSession(request, "customer_test", 3, time.Now().UTC())
	if len(statement.Params) != 12 {
		t.Fatalf("expected session metadata parameters, got %d", len(statement.Params))
	}
	if statement.Params[9] != strings.Repeat("a", 64) || statement.Params[10] != strings.Repeat("b", 64) || statement.Params[11] != "Safari · macOS" {
		t.Fatalf("unexpected session metadata: %#v", statement.Params[9:])
	}
	if strings.Contains(statement.SQL, "raw") {
		t.Fatal("session schema must not name or expose raw network context")
	}
}
