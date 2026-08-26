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
	"strconv"
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
	queries      [][]map[string]any
	queryIndex   int
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
	results := make([]d1.Result, len(statements))
	for index := range results {
		results[index] = d1.Result{Meta: map[string]any{"changes": float64(1)}}
	}
	return results, nil
}

func (db *callbackDatabase) Query(context.Context, string, ...any) ([]map[string]any, error) {
	if db.queries != nil {
		index := db.queryIndex
		db.queryIndex++
		if index >= len(db.queries) {
			return nil, nil
		}
		return db.queries[index], nil
	}
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
		"currency":       "USDT",
		"amount":         "1.20",
		"address":        "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
		"status":         4,
		"timestamp":      int64(1_800_000_000_000),
		"nonce":          "abc123",
	}
	payload["sign"] = client.Sign(payload)
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	expected := []map[string]any{{
		"id": "historical-withdrawal", "currency": usdtTRC20Currency,
		"net_amount_text": "1.20", "to_address": payload["address"], "cregis_cid": "1463535767997999",
	}}
	db := &callbackDatabase{queries: [][]map[string]any{expected, {{
		"status": "exception", "cregis_cid": "1463535767997999", "accounting_status": "missing",
	}}}}
	app := &application{
		db: db, cregis: &callbackCregisClient{Client: client, payout: cregis.PayoutOrder{
			ChainID: usdtTRC20ChainID, TokenID: usdtTRC20TokenID, Currency: "USDT",
			Address: text(payload["address"]), Amount: "1.20", Status: 4,
			ThirdPartyID: "historical-withdrawal",
		}}, cregisLive: true, tenantID: "tenant_test",
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
	trade     cregis.Trade
	tradeErr  error
	payout    cregis.PayoutOrder
	payoutErr error
}

func (client *callbackCregisClient) DepositTrade(context.Context, int64, string, string, string) (cregis.Trade, error) {
	return client.trade, client.tradeErr
}

func (client *callbackCregisClient) PayoutOrder(context.Context, int64) (cregis.PayoutOrder, error) {
	return client.payout, client.payoutErr
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
		"currency":       "USDT",
		"amount":         "1.20",
		"address":        "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
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
		{name: "provider order mismatch is held", wantStatus: http.StatusOK},
		{name: "conflicting payout", rows: []map[string]any{{"status": "exception", "cregis_cid": "", "accounting_status": "approved"}}, wantStatus: http.StatusOK},
		{name: "exact idempotent callback", rows: []map[string]any{{"status": "completed", "cregis_cid": "1463535767997999", "accounting_status": "settled"}}, wantStatus: http.StatusOK},
	} {
		t.Run(test.name, func(t *testing.T) {
			expected := []map[string]any{{
				"id": "withdrawal_test", "currency": usdtTRC20Currency,
				"net_amount_text": "1.20", "to_address": payload["address"], "cregis_cid": "1463535767997999",
			}}
			queries := [][]map[string]any{expected, test.rows}
			if test.name == "unknown payout" {
				queries = [][]map[string]any{{}}
			}
			payoutStatus := 6
			if test.name == "provider order mismatch is held" {
				payoutStatus = 4
			}
			db := &callbackDatabase{queries: queries}
			app := &application{
				db: db,
				cregis: &callbackCregisClient{Client: client, payout: cregis.PayoutOrder{
					ChainID: usdtTRC20ChainID, TokenID: usdtTRC20TokenID, Currency: "USDT",
					Address: text(payload["address"]), Amount: "1.20", Status: payoutStatus,
					ThirdPartyID: "third-party-test", TXID: strings.Repeat("a", 64),
				}},
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
			if test.name == "provider order mismatch is held" &&
				(len(db.batches) != 1 || len(db.batches[0]) != 2 || !strings.Contains(db.batches[0][1].SQL, "status='exception'")) {
				t.Fatalf("provider mismatch must be recorded and held: %#v", db.batches)
			}
		})
	}
}

func TestUSDTTRC20IdentifierAliases(t *testing.T) {
	for _, value := range []string{"USDT", "USDT-TRC20", usdtTRC20Currency} {
		if !isUSDTTRC20Identifier(value) {
			t.Fatalf("expected %q to be accepted", value)
		}
	}
	for _, value := range []string{"", "TRX", "USDT-ERC20", "60@token"} {
		if isUSDTTRC20Identifier(value) {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
}

func TestVerifyPayoutOrderAcceptsV2EquivalentFields(t *testing.T) {
	const destination = "TFbXZoaXDCWq318W2HghRmrXktCvCzoX9K"
	const thirdPartyID = "withdrawal-v2-test"
	const cid = int64(1463535767997999)
	const txid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	db := &callbackDatabase{rows: []map[string]any{{
		"id": "withdrawal_test", "currency": usdtTRC20Currency,
		"net_amount_text": "1.20", "to_address": destination, "cregis_cid": strconv.FormatInt(cid, 10),
	}}}
	app := &application{
		db: db,
		cregis: &callbackCregisClient{payout: cregis.PayoutOrder{
			ChainID: usdtTRC20ChainID, TokenID: usdtTRC20TokenID, Currency: usdtTRC20Currency,
			ToAddress: destination, Amount: "1.2", Status: 6, ThirdPartyID: thirdPartyID, TXID: txid,
		}},
		tenantID: "tenant_test",
	}
	payload := map[string]any{
		"third_party_id": thirdPartyID, "amount": "1.20", "address": destination,
		"currency": "USDT-TRC20", "status": 6, "txid": txid,
	}
	withdrawalID, exact, err := app.verifyPayoutOrder(context.Background(), payload, cid)
	if err != nil {
		t.Fatal(err)
	}
	if withdrawalID != "withdrawal_test" || !exact {
		t.Fatalf("withdrawalID=%q exact=%v; want v2-equivalent payout evidence accepted", withdrawalID, exact)
	}
}

func TestProviderQuerySettlementRequiresExactEvidenceAndSettlesCore(t *testing.T) {
	const destination = "TXf2Rf731cNW44SBLCXUWvRJAKuTLjMnRR"
	const thirdPartyID = "nbbb363014355b53589dbcfcbcb7065a29"
	const cid = "1464508746800128"
	const txid = "9f70741956ed2d27e459285cb92025d1cffc2874c9ded13f09103bc372ff8302"
	db := &callbackDatabase{
		rows: []map[string]any{{
			"id": "withdrawal_test", "third_party_id": thirdPartyID, "currency": usdtTRC20Currency,
			"net_amount_text": "1", "to_address": destination, "cregis_cid": cid,
			"status": "exception", "accounting_status": "approved",
		}},
		batchResults: []d1.Result{{Results: []map[string]any{{"withdrawal_id": "withdrawal_test"}}}},
	}
	core := &fakeCoreAccounting{withdrawalResult: coreaccounting.Result{ID: "withdrawal_test", Status: "settled"}}
	app := &application{
		db: db,
		cregis: &callbackCregisClient{payout: cregis.PayoutOrder{
			ChainID: usdtTRC20ChainID, TokenID: usdtTRC20TokenID, Currency: "USDT-TRC20",
			ToAddress: destination, Amount: "1.000000", Status: 6, ThirdPartyID: thirdPartyID,
			TXID: txid, BlockHeight: "123456", BlockTime: cregis.ScalarText("1800000000000"),
		}},
		coreAccounting: core, directAccounting: true, tenantID: "tenant_test",
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	body := `{"resolution":"completed_from_provider","note":"matched Cregis transaction evidence","cregis_cid":"` + cid + `","txid":"` + txid + `"}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/crypto/withdrawals/withdrawal_test/reconcile", strings.NewReader(body))
	response := httptest.NewRecorder()
	app.reconcileCregisWithdrawal(response, request, "withdrawal_test")
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%q", response.Code, response.Body.String())
	}
	if core.action != "settle" || core.recordID != "withdrawal_test" {
		t.Fatalf("Core action=%q record=%q; want exact settlement", core.action, core.recordID)
	}
	if len(db.batches) != 1 || len(db.batches[0]) != 1 || db.batches[0][0].SQL != reconcileWithdrawalCompletedSQL {
		t.Fatalf("unexpected settlement statements: %#v", db.batches)
	}
}

func TestProviderQuerySettlementRejectsTransactionHashMismatch(t *testing.T) {
	const expectedTXID = "9f70741956ed2d27e459285cb92025d1cffc2874c9ded13f09103bc372ff8302"
	db := &callbackDatabase{rows: []map[string]any{{
		"id": "withdrawal_test", "third_party_id": "third-party", "currency": usdtTRC20Currency,
		"net_amount_text": "1", "to_address": "destination", "cregis_cid": "1464508746800128",
		"status": "exception", "accounting_status": "approved",
	}}}
	core := &fakeCoreAccounting{}
	app := &application{
		db: db,
		cregis: &callbackCregisClient{payout: cregis.PayoutOrder{
			ChainID: usdtTRC20ChainID, TokenID: usdtTRC20TokenID, Currency: "USDT",
			Address: "destination", Amount: "1", Status: 6, ThirdPartyID: "third-party",
			TXID: strings.Repeat("a", 64),
		}},
		coreAccounting: core, directAccounting: true, tenantID: "tenant_test",
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	body := `{"resolution":"completed_from_provider","note":"manual evidence","cregis_cid":"1464508746800128","txid":"` + expectedTXID + `"}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/crypto/withdrawals/withdrawal_test/reconcile", strings.NewReader(body))
	response := httptest.NewRecorder()
	app.reconcileCregisWithdrawal(response, request, "withdrawal_test")
	if response.Code != http.StatusConflict || len(db.batches) != 0 || core.action != "" {
		t.Fatalf("status=%d batches=%d core_action=%q", response.Code, len(db.batches), core.action)
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
