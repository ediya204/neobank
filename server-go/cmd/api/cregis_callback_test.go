package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ediya204/neobank/server-go/internal/cregis"
	"github.com/ediya204/neobank/server-go/internal/d1"
)

type callbackDatabase struct {
	rows []map[string]any
}

type depositCallbackDatabase struct {
	batchResults []d1.Result
	batches      [][]d1.Statement
	queries      [][]map[string]any
	queryErrorAt int
	queryIndex   int
}

func (db *depositCallbackDatabase) Batch(_ context.Context, statements ...d1.Statement) ([]d1.Result, error) {
	db.batches = append(db.batches, statements)
	return db.batchResults, nil
}

func (db *depositCallbackDatabase) Query(context.Context, string, ...any) ([]map[string]any, error) {
	index := db.queryIndex
	db.queryIndex++
	if db.queryErrorAt == index {
		return nil, errors.New("database unavailable")
	}
	if index >= len(db.queries) {
		return nil, nil
	}
	return db.queries[index], nil
}

func (db *callbackDatabase) Batch(context.Context, ...d1.Statement) ([]d1.Result, error) {
	return []d1.Result{
		{Meta: map[string]any{"changes": float64(1)}},
		{Meta: map[string]any{"changes": float64(0)}},
	}, nil
}

func (db *callbackDatabase) Query(context.Context, string, ...any) ([]map[string]any, error) {
	return db.rows, nil
}

type callbackCregisClient struct {
	*cregis.Client
	trade    cregis.Trade
	tradeErr error
}

func (client *callbackCregisClient) DepositTrade(context.Context, int64, string, string, string) (cregis.Trade, error) {
	return client.trade, client.tradeErr
}

func TestPayoutCallbackDoesNotAcknowledgeUnknownOrConflictingState(t *testing.T) {
	client, err := cregis.New(cregis.Config{
		BaseURL:     "https://t-wsmbuuhb.cregis.io",
		ProjectID:   "1463535767997152",
		Secret:      "cregis-test-secret",
		RelayURL:    "https://relay.example.test",
		RelaySecret: strings.Repeat("r", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	payload := map[string]any{
		"pid":            int64(1463535767997152),
		"cid":            int64(1463535767997999),
		"third_party_id": "third-party-test",
		"chain_id":       usdtTRC20ChainID,
		"token_id":       usdtTRC20TokenID,
		"status":         6,
		"txid":           strings.Repeat("a", 64),
		"timestamp":      int64(1_800_000_000_000),
		"nonce":          "abc123",
	}
	payload["sign"] = client.Sign(payload)
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}

	for _, test := range []struct {
		name       string
		rows       []map[string]any
		wantStatus int
	}{
		{name: "unknown payout", wantStatus: http.StatusUnprocessableEntity},
		{name: "conflicting payout", rows: []map[string]any{{"status": "exception", "cregis_cid": "", "accounting_status": "approved"}}, wantStatus: http.StatusConflict},
		{name: "exact idempotent callback", rows: []map[string]any{{"status": "completed", "cregis_cid": "1463535767997999", "accounting_status": "settled"}}, wantStatus: http.StatusOK},
	} {
		t.Run(test.name, func(t *testing.T) {
			app := &application{
				db:         &callbackDatabase{rows: test.rows},
				cregis:     client,
				cregisLive: true,
				tenantID:   "tenant_test",
				logger:     slog.New(slog.NewTextHandler(io.Discard, nil)),
			}
			request := httptest.NewRequest(http.MethodPost, "/api/v1/callbacks/cregis/payout", bytes.NewReader(body))
			response := httptest.NewRecorder()
			app.cregisPayoutCallback(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, body=%q; want %d", response.Code, response.Body.String(), test.wantStatus)
			}
			if test.wantStatus != http.StatusOK && response.Body.String() == "success" {
				t.Fatal("invalid callback state must never be acknowledged as success")
			}
		})
	}
}

func TestDepositCallbackOnlyAcknowledgesNewOrExactIdempotentEvent(t *testing.T) {
	client, err := cregis.New(cregis.Config{
		BaseURL:     "https://t-wsmbuuhb.cregis.io",
		ProjectID:   "1463535767997152",
		Secret:      "cregis-test-secret",
		RelayURL:    "https://relay.example.test",
		RelaySecret: strings.Repeat("r", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	payload := map[string]any{
		"pid":          int64(1463535767997152),
		"cid":          int64(1463535767997001),
		"chain_id":     usdtTRC20ChainID,
		"token_id":     usdtTRC20TokenID,
		"address":      "TDeposit1111111111111111111111111",
		"amount":       "1.25",
		"status":       1,
		"txid":         "tx-deposit-1",
		"block_height": "100",
		"block_time":   "1800000000",
		"timestamp":    int64(1_800_000_000_000),
		"nonce":        "abc123",
	}
	payload["sign"] = client.Sign(payload)
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	exact := map[string]any{
		"wallet_id": "wallet_deposit", "chain_id": usdtTRC20ChainID, "token_id": usdtTRC20TokenID,
		"currency": usdtTRC20Currency, "address": payload["address"], "amount_text": "1.25",
		"amount_minor": "1250000", "status": "completed", "txid": payload["txid"],
		"from_address": "TXsmKpEuW7qWnXzJLGP9eDLvWPR2GRn1FS",
		"block_height": payload["block_height"], "block_time": payload["block_time"],
		"raw_sha256": sha256Hex(body),
	}
	conflicting := make(map[string]any, len(exact))
	for key, value := range exact {
		conflicting[key] = value
	}
	conflicting["amount_text"] = "2"
	wallet := []map[string]any{{"id": "wallet_deposit"}}
	trade := cregis.Trade{
		CID: 1463535767997001, ChainID: usdtTRC20ChainID, TokenID: usdtTRC20TokenID,
		ToAddress: text(payload["address"]), FromAddress: "TXsmKpEuW7qWnXzJLGP9eDLvWPR2GRn1FS",
		Amount: "1.25", Status: 1, TXID: text(payload["txid"]),
	}

	for _, test := range []struct {
		name          string
		batchChanges  float64
		existing      []map[string]any
		tradeErr      error
		invalidTrade  bool
		missingIntent bool
		queryErrorAt  int
		wantStatus    int
	}{
		{name: "new deposit", batchChanges: 1, queryErrorAt: -1, wantStatus: http.StatusOK},
		{name: "new deposit without accounting intent", batchChanges: 1, missingIntent: true, queryErrorAt: -1, wantStatus: http.StatusServiceUnavailable},
		{name: "exact duplicate", existing: []map[string]any{exact}, queryErrorAt: -1, wantStatus: http.StatusOK},
		{name: "unknown duplicate", queryErrorAt: -1, wantStatus: http.StatusUnprocessableEntity},
		{name: "conflicting duplicate", existing: []map[string]any{conflicting}, queryErrorAt: -1, wantStatus: http.StatusConflict},
		{name: "lookup failure", queryErrorAt: 1, wantStatus: http.StatusServiceUnavailable},
		{name: "trade lookup failure", tradeErr: errors.New("trade unavailable"), queryErrorAt: -1, wantStatus: http.StatusServiceUnavailable},
		{name: "trade mismatch", invalidTrade: true, queryErrorAt: -1, wantStatus: http.StatusServiceUnavailable},
	} {
		t.Run(test.name, func(t *testing.T) {
			tradeResult := trade
			if test.invalidTrade {
				tradeResult.ToAddress = "TMismatchedDepositAddress11111111111"
			}
			queries := [][]map[string]any{wallet}
			if test.batchChanges == 0 && test.tradeErr == nil && !test.invalidTrade {
				queries = append(queries, test.existing)
			}
			if test.wantStatus == http.StatusOK && !test.missingIntent {
				queries = append(queries, []map[string]any{{"status": "pending"}})
			}
			db := &depositCallbackDatabase{
				batchResults: []d1.Result{
					{Meta: map[string]any{"changes": float64(1)}},
					{Meta: map[string]any{"changes": test.batchChanges}},
					{Meta: map[string]any{"changes": test.batchChanges}},
				},
				queries:      queries,
				queryErrorAt: test.queryErrorAt,
			}
			app := &application{
				db: db, cregis: &callbackCregisClient{Client: client, trade: tradeResult, tradeErr: test.tradeErr}, cregisLive: true, tenantID: "tenant_test",
				logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
			}
			request := httptest.NewRequest(http.MethodPost, "/api/v1/callbacks/cregis/deposit", bytes.NewReader(body))
			response := httptest.NewRecorder()
			app.cregisDepositCallback(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, body=%q; want %d", response.Code, response.Body.String(), test.wantStatus)
			}
			if test.wantStatus != http.StatusOK && response.Body.String() == "success" {
				t.Fatal("invalid deposit callback must never be acknowledged as success")
			}
			if test.name == "new deposit" {
				if len(db.batches) != 1 || len(db.batches[0]) != 3 || len(db.batches[0][1].Params) != 17 {
					t.Fatalf("unexpected deposit insert batch: %#v", db.batches)
				}
				if source := db.batches[0][1].Params[8]; source != trade.FromAddress {
					t.Fatalf("stored source address = %v; want %s", source, trade.FromAddress)
				}
				if !strings.Contains(db.batches[0][2].SQL, "cregis_deposit_accounting") {
					t.Fatal("completed deposit must persist a durable accounting intent")
				}
			}
		})
	}
}

func TestCustomerWalletFundsUseOnlyCoreMaterializedBalances(t *testing.T) {
	for name, sql := range map[string]string{"balance": walletBalancesSQL, "reservation": reserveWithdrawalSQL} {
		if !strings.Contains(sql, `"CryptoWallet"`) || !strings.Contains(sql, `"availableBalance"`) {
			t.Fatalf("%s SQL must read the Core wallet balance", name)
		}
		if strings.Contains(sql, "SUM(d.amount_minor)") {
			t.Fatalf("%s SQL must not infer money from custody deposits", name)
		}
	}
}
