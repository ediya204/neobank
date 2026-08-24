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

	"github.com/ediya204/neobank/server-go/internal/coreaccounting"
	"github.com/ediya204/neobank/server-go/internal/cregis"
	"github.com/ediya204/neobank/server-go/internal/d1"
)

type fakeCoreAccounting struct {
	depositResult    coreaccounting.Result
	withdrawalResult coreaccounting.Result
	err              error
	action           string
	recordID         string
}

func (fake *fakeCoreAccounting) PostDeposit(context.Context, string) (coreaccounting.Result, error) {
	return fake.depositResult, fake.err
}

func (fake *fakeCoreAccounting) AdvanceWithdrawal(_ context.Context, recordID, action string) (coreaccounting.Result, error) {
	fake.recordID = recordID
	fake.action = action
	return fake.withdrawalResult, fake.err
}

type callbackDatabase struct {
	rows         []map[string]any
	batchResults []d1.Result
	batches      [][]d1.Statement
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

func (db *callbackDatabase) Batch(_ context.Context, statements ...d1.Statement) ([]d1.Result, error) {
	db.batches = append(db.batches, statements)
	if db.batchResults != nil {
		return db.batchResults, nil
	}
	return []d1.Result{
		{Meta: map[string]any{"changes": float64(1)}},
		{Meta: map[string]any{"changes": float64(1)}},
		{Meta: map[string]any{"changes": float64(0)}},
	}, nil
}

func (db *callbackDatabase) Query(context.Context, string, ...any) ([]map[string]any, error) {
	return db.rows, nil
}

func TestPayoutRejectionAcknowledgesHistoricalExceptionForReconciliation(t *testing.T) {
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
		"third_party_id": "historical-withdrawal",
		"chain_id":       usdtTRC20ChainID,
		"token_id":       usdtTRC20TokenID,
		"status":         4,
		"timestamp":      int64(1_800_000_000_000),
		"nonce":          "abc123",
	}
	payload["sign"] = client.Sign(payload)
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	db := &callbackDatabase{rows: []map[string]any{{
		"status": "exception", "cregis_cid": "1463535767997999", "accounting_status": "missing",
	}}}
	app := &application{
		db: db, cregis: client, cregisLive: true, tenantID: "tenant_test",
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/callbacks/cregis/payout", bytes.NewReader(body))
	response := httptest.NewRecorder()
	app.cregisPayoutCallback(response, request)
	if response.Code != http.StatusOK || response.Body.String() != "success" {
		t.Fatalf("status = %d, body=%q; want recorded provider rejection", response.Code, response.Body.String())
	}
	if len(db.batches) != 1 || len(db.batches[0]) != 3 {
		t.Fatalf("payout callback statements = %#v; want event, CID capture, and terminal transition", db.batches)
	}
	terminalSQL := db.batches[0][2].SQL
	if !strings.Contains(terminalSQL, "status IN ('submitted_to_cregis', 'executing', 'exception')") ||
		!strings.Contains(terminalSQL, "AND cregis_cid=?") {
		t.Fatalf("terminal transition does not safely handle callback races: %s", terminalSQL)
	}
}

type callbackCregisClient struct {
	*cregis.Client
	trade    cregis.Trade
	tradeErr error
}

func (client *callbackCregisClient) DepositTrade(context.Context, int64, string, string, string) (cregis.Trade, error) {
	return client.trade, client.tradeErr
}

func TestPayoutCallbackRetriesUnknownStateAndAcknowledgesDurableConflictEvidence(t *testing.T) {
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
		{name: "conflicting payout", rows: []map[string]any{{"status": "exception", "cregis_cid": "", "accounting_status": "approved"}}, wantStatus: http.StatusOK},
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
			if test.wantStatus == http.StatusOK && response.Body.String() != "success" {
				t.Fatal("durably recorded final callback must be acknowledged as success")
			}
		})
	}
}

func TestDirectPayoutAccountingRetriesTransientFailureAndAcknowledgesException(t *testing.T) {
	for _, test := range []struct {
		name       string
		result     coreaccounting.Result
		err        error
		wantStatus int
		wantBody   string
	}{
		{name: "transient", err: errors.New("Core unavailable"), wantStatus: http.StatusServiceUnavailable, wantBody: "retry\n"},
		{name: "permanent exception", result: coreaccounting.Result{ID: "withdrawal_test", Status: "exception"}, wantStatus: http.StatusOK, wantBody: "success"},
		{name: "settled", result: coreaccounting.Result{ID: "withdrawal_test", Status: "settled"}, wantStatus: http.StatusOK, wantBody: "success"},
	} {
		t.Run(test.name, func(t *testing.T) {
			core := &fakeCoreAccounting{withdrawalResult: test.result, err: test.err}
			app := &application{
				coreAccounting: core, directAccounting: true,
				logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
			}
			request := httptest.NewRequest(http.MethodPost, "/callback", nil)
			response := httptest.NewRecorder()
			app.finishPayoutAccounting(response, request, "withdrawal_test", "completed", "cid_test")
			if response.Code != test.wantStatus || response.Body.String() != test.wantBody {
				t.Fatalf("status=%d body=%q; want %d %q", response.Code, response.Body.String(), test.wantStatus, test.wantBody)
			}
			if core.recordID != "withdrawal_test" || core.action != "settle" {
				t.Fatalf("Core call = %q %q", core.recordID, core.action)
			}
		})
	}
}

func TestDepositCallbackRetriesTransientFailureAndAcknowledgesDurableConflictEvidence(t *testing.T) {
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
		{name: "unknown duplicate", queryErrorAt: -1, wantStatus: http.StatusOK},
		{name: "conflicting duplicate", existing: []map[string]any{conflicting}, queryErrorAt: -1, wantStatus: http.StatusOK},
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
			if test.wantStatus == http.StatusOK && response.Body.String() != "success" {
				t.Fatal("durably recorded final callback must be acknowledged as success")
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
		if !strings.Contains(sql, `"Account"`) || !strings.Contains(sql, `"availableBalance"`) {
			t.Fatalf("%s SQL must read the primary Core account balance", name)
		}
		if strings.Contains(sql, "SUM(d.amount_minor)") {
			t.Fatalf("%s SQL must not infer money from custody deposits", name)
		}
	}
	if !strings.Contains(walletBalancesSQL, `"CryptoWallet"`) ||
		!strings.Contains(walletBalancesSQL, "mirror_available_minor") {
		t.Fatal("wallet balance reads must validate the compatibility mirror")
	}
}

func TestCustomerWalletBalanceUsesAccountAndFailsClosedOnMirrorMismatch(t *testing.T) {
	matching := map[string]any{
		"account_id": "account_usdt", "mirror_wallet_id": "wallet_usdt",
		"available_minor": "1250000", "frozen_minor": "50000",
		"mirror_available_minor": "1250000", "mirror_frozen_minor": "50000",
	}
	app := &application{db: &callbackDatabase{rows: []map[string]any{matching}}, tenantID: "tenant_test"}
	request := httptest.NewRequest(http.MethodGet, "/wallet", nil)
	available, frozen, err := app.customerWalletBalances(request, "wallet_usdt", "customer_test")
	if err != nil || available != "1.25" || frozen != "0.05" {
		t.Fatalf("balances = %q %q, %v", available, frozen, err)
	}
	mismatched := map[string]any{}
	for key, value := range matching {
		mismatched[key] = value
	}
	mismatched["mirror_available_minor"] = "1249999"
	app.db = &callbackDatabase{rows: []map[string]any{mismatched}}
	if _, _, err := app.customerWalletBalances(request, "wallet_usdt", "customer_test"); err == nil {
		t.Fatal("Account and CryptoWallet mismatch must fail closed")
	}
}
