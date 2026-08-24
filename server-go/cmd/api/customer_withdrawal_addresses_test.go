package main

import (
	"strings"
	"testing"
)

func TestValidTronWithdrawalAddressUsesBase58Check(t *testing.T) {
	valid := "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
	if !validTronAddress(valid) {
		t.Fatalf("expected known USDT TRON address to pass: %s", valid)
	}
	for _, invalid := range []string{
		"",
		"0x0000000000000000000000000000000000000000",
		"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj60",
		"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u",
	} {
		if validTronAddress(invalid) {
			t.Fatalf("invalid TRON address accepted: %s", invalid)
		}
	}
}

func TestWithdrawalReservationRequiresAnActiveCustomerWhitelistAddress(t *testing.T) {
	for _, required := range []string{
		"withdrawal_address_id",
		"JOIN customer_withdrawal_addresses",
		"a.customer_id=c.id",
		"a.currency=w.currency",
		"a.network='TRON'",
		"a.status='active'",
		"a.address",
	} {
		if !strings.Contains(reserveWithdrawalSQL, required) {
			t.Fatalf("withdrawal reservation must contain %q", required)
		}
	}
	if strings.Contains(reserveWithdrawalSQL, "to_address, ?,") {
		t.Fatal("withdrawal reservation must not accept a client-supplied destination address")
	}
}

func TestNormalizeFiatBeneficiaryInput(t *testing.T) {
	input, ok := normalizeFiatBeneficiaryInput(customerFiatBeneficiaryInput{
		Name:           "  Example Supplier  ",
		Currency:       "usd",
		BankName:       "  Example Bank ",
		AccountNumber:  " 1234-5678 ",
		SwiftBIC:       "abcd hk hh",
		IBAN:           "GB82 WEST 1234 5698 7654 32",
		BankAddress:    "  Central, Hong Kong ",
		CountryCode:    "hk",
		StepUpToken:    "stepup_token",
		IdempotencyKey: "request-key",
	})
	if !ok {
		t.Fatal("expected supported fiat beneficiary input")
	}
	if input.Name != "Example Supplier" || input.Currency != "USD" || input.CountryCode != "HK" {
		t.Fatalf("unexpected normalized identity: %#v", input)
	}
	if input.SwiftBIC != "ABCDHKHH" || input.IBAN != "GB82WEST12345698765432" {
		t.Fatalf("unexpected normalized bank identifiers: %#v", input)
	}
	if normalizedBankAccount(input.AccountNumber) != "12345678" {
		t.Fatalf("unexpected account comparison value: %q", normalizedBankAccount(input.AccountNumber))
	}
}

func TestNormalizeFiatBeneficiaryInputRejectsUnsupportedOrMalformedDestinations(t *testing.T) {
	base := customerFiatBeneficiaryInput{
		Name:           "Supplier",
		Currency:       "USD",
		BankName:       "Example Bank",
		AccountNumber:  "12345678",
		CountryCode:    "HK",
		StepUpToken:    "stepup_token",
		IdempotencyKey: "request-key",
	}
	for name, mutate := range map[string]func(*customerFiatBeneficiaryInput){
		"unsupported currency": func(value *customerFiatBeneficiaryInput) { value.Currency = "EUR" },
		"invalid country":      func(value *customerFiatBeneficiaryInput) { value.CountryCode = "HKG" },
		"invalid swift":        func(value *customerFiatBeneficiaryInput) { value.SwiftBIC = "NOT-A-BIC" },
		"invalid iban":         func(value *customerFiatBeneficiaryInput) { value.IBAN = "1234" },
		"short account":        func(value *customerFiatBeneficiaryInput) { value.AccountNumber = "123" },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := base
			mutate(&candidate)
			if _, ok := normalizeFiatBeneficiaryInput(candidate); ok {
				t.Fatalf("expected %s to be rejected", name)
			}
		})
	}
}

func TestFiatBeneficiaryIDIsIdempotentAndCustomerScoped(t *testing.T) {
	first := fiatBeneficiaryID("customer_1", "request_1")
	if first != fiatBeneficiaryID("customer_1", "request_1") {
		t.Fatal("same customer and idempotency key must produce the same beneficiary id")
	}
	if first == fiatBeneficiaryID("customer_2", "request_1") {
		t.Fatal("beneficiary id must be customer scoped")
	}
	if !safeIdentifier.MatchString(first) {
		t.Fatalf("beneficiary id must be safe for routes: %q", first)
	}
}

func TestWithdrawalDestinationRouteIDRejectsNestedPaths(t *testing.T) {
	if got := withdrawalDestinationRouteID(
		"/api/v1/customer/fiat-beneficiaries/beneficiary_1/revoke",
		"/api/v1/customer/fiat-beneficiaries/",
	); got != "beneficiary_1" {
		t.Fatalf("unexpected beneficiary route id: %q", got)
	}
	if got := withdrawalDestinationRouteID(
		"/api/v1/customer/fiat-beneficiaries/customer_2/beneficiary_1/revoke",
		"/api/v1/customer/fiat-beneficiaries/",
	); got != "" {
		t.Fatalf("nested customer route must be rejected: %q", got)
	}
}
