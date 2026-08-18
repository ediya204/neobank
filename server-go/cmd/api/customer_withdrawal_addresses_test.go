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
