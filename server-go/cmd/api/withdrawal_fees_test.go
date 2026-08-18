package main

import (
	"context"
	"errors"
	"testing"

	"github.com/ediya204/neobank/server-go/internal/d1"
)

type withdrawalFeeDatabase struct {
	rows   []map[string]any
	params []any
}

func (db *withdrawalFeeDatabase) Query(_ context.Context, _ string, params ...any) ([]map[string]any, error) {
	db.params = params
	return db.rows, nil
}

func (db *withdrawalFeeDatabase) Batch(context.Context, ...d1.Statement) ([]d1.Result, error) {
	return nil, errors.New("unexpected batch")
}

func TestActiveWithdrawalFeeIsTenantAndRouteScoped(t *testing.T) {
	db := &withdrawalFeeDatabase{rows: []map[string]any{{
		"id": "fee_cregis", "fee_amount_minor": "5000000", "fee_decimals": int64(6), "version": "4",
	}}}
	app := &application{db: db, tenantID: "neobank"}
	rule, err := app.activeWithdrawalFee(context.Background(), "CRYPTO", "USDT", "ON_CHAIN", "CREGIS", "TRON")
	if err != nil {
		t.Fatal(err)
	}
	if rule.ID != "fee_cregis" || rule.AmountMinor != 5_000_000 || rule.Decimals != 6 || rule.Version != 4 {
		t.Fatalf("unexpected fee rule: %#v", rule)
	}
	want := []any{"neobank", "CRYPTO", "USDT", "ON_CHAIN", "CREGIS", "TRON"}
	if len(db.params) != len(want) {
		t.Fatalf("unexpected scope parameter count: %v", db.params)
	}
	for index := range want {
		if db.params[index] != want[index] {
			t.Fatalf("scope parameter %d = %v; want %v", index, db.params[index], want[index])
		}
	}
}

func TestMissingWithdrawalFeeFailsClosed(t *testing.T) {
	app := &application{db: &withdrawalFeeDatabase{}, tenantID: "neobank"}
	_, err := app.activeWithdrawalFee(context.Background(), "CRYPTO", "USDT", "ON_CHAIN", "CREGIS", "TRON")
	if !errors.Is(err, errWithdrawalFeeMissing) {
		t.Fatalf("missing fee error = %v; want %v", err, errWithdrawalFeeMissing)
	}
}
