package main

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestRecoverySessionRequiresFreshlyConsumedCode(t *testing.T) {
	for _, required := range []string{"SELECT ?, ?, ?, ?, ?, ?, ?, ?", "customer_recovery_codes", "used_at=?"} {
		if !strings.Contains(recoveryCustomerSessionSQL, required) {
			t.Fatalf("recovery session SQL must contain %q", required)
		}
	}
}

func TestDatabaseTimestampSortsLexically(t *testing.T) {
	first := time.Date(2026, 8, 13, 10, 0, 0, 100_000_000, time.UTC)
	second := first.Add(20 * time.Millisecond)
	if databaseTimestamp(first) >= databaseTimestamp(second) {
		t.Fatal("database timestamps must preserve chronological text ordering")
	}
}

func TestConfiguredOriginValidation(t *testing.T) {
	if !validConfiguredOrigin("https://customer.example.com", false) {
		t.Fatal("expected HTTPS origin to pass")
	}
	if !validConfiguredOrigin("http://localhost:3000", true) {
		t.Fatal("expected explicitly allowed local HTTP origin to pass")
	}
	for _, value := range []string{"http://example.com", "https://user@example.com", "https://example.com/path", "https://example.com?token=x"} {
		if validConfiguredOrigin(value, false) {
			t.Fatalf("expected unsafe origin to fail: %s", value)
		}
	}
}

func TestCustomerPasswordPolicy(t *testing.T) {
	if !validCustomerPassword("Correct-Horse-7-Battery") {
		t.Fatal("expected strong password to pass")
	}
	for _, password := range []string{"short-A1!", "alllowercase-password-7!", "ALLUPPERCASE-PASSWORD-7!", "NoDigits-In-Password!"} {
		if validCustomerPassword(password) {
			t.Fatalf("expected password to fail policy: %q", password)
		}
	}
}

func TestCustomerPasswordDerivationUsesPepperAndSalt(t *testing.T) {
	app := &application{customerPasswordPepper: []byte("0123456789abcdef0123456789abcdef")}
	first, err := app.deriveCustomerPassword("Correct-Horse-7-Battery", []byte("0123456789abcdef"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := app.deriveCustomerPassword("Correct-Horse-7-Battery", []byte("fedcba9876543210"))
	if err != nil {
		t.Fatal(err)
	}
	if hmac.Equal(first, second) {
		t.Fatal("different salts must produce different hashes")
	}
}

func TestCustomerTOTPEncryptionRoundTrip(t *testing.T) {
	app := &application{
		tenantID:        "test-tenant",
		customerTOTPKey: []byte("0123456789abcdef0123456789abcdef"),
	}
	secret := "JBSWY3DPEHPK3PXP"
	encrypted, err := app.encryptCustomerTOTP(secret)
	if err != nil {
		t.Fatal(err)
	}
	if encrypted == secret {
		t.Fatal("TOTP secret must not be stored as plaintext")
	}
	decrypted, err := app.decryptCustomerTOTP(encrypted)
	if err != nil {
		t.Fatal(err)
	}
	if decrypted != secret {
		t.Fatalf("unexpected decrypted secret: %s", decrypted)
	}
}

func TestVerifyCustomerTOTPCode(t *testing.T) {
	secret := "JBSWY3DPEHPK3PXP"
	now := time.Unix(1_800_000_000, 0)
	code := totpCodeForTest(t, secret, now)
	if !verifyTOTPCode(secret, code, now) {
		t.Fatal("expected current TOTP code to verify")
	}
	if verifyTOTPCode(secret, "000000", now) && code != "000000" {
		t.Fatal("unexpected invalid TOTP acceptance")
	}
}

func totpCodeForTest(t *testing.T, secret string, now time.Time) string {
	t.Helper()
	decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	if err != nil {
		t.Fatal(err)
	}
	counter := uint64(now.Unix() / 30)
	message := make([]byte, 8)
	for index := 7; index >= 0; index-- {
		message[index] = byte(counter)
		counter >>= 8
	}
	mac := hmac.New(sha1.New, decoded)
	_, _ = mac.Write(message)
	digest := mac.Sum(nil)
	position := digest[len(digest)-1] & 0x0f
	value := (uint32(digest[position])&0x7f)<<24 | uint32(digest[position+1])<<16 | uint32(digest[position+2])<<8 | uint32(digest[position+3])
	return fmt.Sprintf("%06d", value%1_000_000)
}
