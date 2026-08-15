package main

import (
	"math"
	"strings"
	"testing"
)

func TestSelectColumnsCastsIntegersToText(t *testing.T) {
	table := tableSpec{Name: "example", Columns: []string{"id", "amount_minor", "credential_version"}}
	query := selectColumns(table)
	for _, expected := range []string{
		"id",
		"CAST(amount_minor AS TEXT) AS amount_minor",
		"CAST(credential_version AS TEXT) AS credential_version",
	} {
		if !strings.Contains(query, expected) {
			t.Fatalf("expected %q in %q", expected, query)
		}
	}
}

func TestNormalizeDatabaseValuePreservesInt64Precision(t *testing.T) {
	value, err := normalizeDatabaseValue("amount_minor", "9223372036854775807")
	if err != nil {
		t.Fatal(err)
	}
	if value != int64(math.MaxInt64) {
		t.Fatalf("unexpected value: %#v", value)
	}
	if _, err := normalizeDatabaseValue("amount_minor", float64(9_007_199_254_740_992)); err == nil {
		t.Fatal("floating-point source integers must fail closed")
	}
}
