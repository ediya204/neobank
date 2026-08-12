package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
)

var (
	positiveDecimal = regexp.MustCompile(`^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$`)
	safeIdentifier  = regexp.MustCompile(`^[A-Za-z0-9_.:@-]{1,128}$`)
)

const (
	usdtTRC20ChainID  = "195"
	usdtTRC20TokenID  = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
	usdtTRC20Currency = usdtTRC20ChainID + "@" + usdtTRC20TokenID

	approveWithdrawalSQL = `UPDATE cregis_withdrawals
    SET status='approved', checker_id=?, approved_at=?, updated_at=?
    WHERE id=? AND tenant_id=? AND status='submitted'`
	rejectWithdrawalSQL = `UPDATE cregis_withdrawals
    SET status='rejected', checker_id=?, rejection_reason=?, updated_at=?
    WHERE id=? AND tenant_id=? AND status='submitted'`
	startWithdrawalExecutionSQL = `UPDATE cregis_withdrawals SET status='executing', operator_id=?, updated_at=?
      WHERE id=? AND tenant_id=? AND status='approved' AND checker_id IS NOT NULL`
	persistWithdrawalSubmissionSQL = `UPDATE cregis_withdrawals
    SET status='submitted_to_cregis', cregis_cid=?, submitted_at=?, updated_at=?
    WHERE id=? AND status='executing'`
	activateVerifiedWalletSQL = `UPDATE cregis_wallets
      SET address=?, custody_provider='cregis', ownership_verified_at=?, status='active', updated_at=?
      WHERE id=? AND tenant_id=? AND status='creating'`
	failWalletOwnershipVerificationSQL = `UPDATE cregis_wallets
      SET address=?, status='error', updated_at=? WHERE id=? AND tenant_id=? AND status='creating'`
	reserveWithdrawalSQL = `INSERT OR IGNORE INTO cregis_withdrawals
    (id, tenant_id, customer_id, wallet_id, idempotency_key, third_party_id, currency, amount_text, amount_minor,
     from_address, to_address, memo, remark, status, maker_id, created_at, updated_at)
    SELECT ?, ?, ?, w.id, ?, ?, ?, ?, ?, w.address, ?, ?, ?, 'submitted', ?, ?, ?
    FROM cregis_wallets w JOIN customers c ON c.id=w.customer_id AND c.tenant_id=w.tenant_id
    WHERE w.id=? AND w.tenant_id=? AND w.customer_id=? AND w.chain_id=? AND w.token_id=? AND w.currency=?
      AND w.status='active' AND w.custody_provider='cregis' AND w.ownership_verified_at IS NOT NULL
      AND c.status='active' AND c.kyc_status='approved' AND c.operations_status='active'
      AND ? <= COALESCE((SELECT SUM(d.amount_minor) FROM cregis_deposits d
        WHERE d.tenant_id=w.tenant_id AND d.wallet_id=w.id AND d.status='completed'), 0)
        - COALESCE((SELECT SUM(x.amount_minor) FROM cregis_withdrawals x
          WHERE x.tenant_id=w.tenant_id AND x.wallet_id=w.id AND x.customer_id=c.id
            AND x.status NOT IN ('rejected', 'failed', 'cancelled')), 0)`
	walletBalancesSQL = `SELECT
    CAST(COALESCE((SELECT SUM(d.amount_minor) FROM cregis_deposits d
      WHERE d.tenant_id=? AND d.wallet_id=? AND d.status='completed'), 0)
      - COALESCE((SELECT SUM(x.amount_minor) FROM cregis_withdrawals x
        WHERE x.tenant_id=? AND x.wallet_id=? AND x.customer_id=?
          AND x.status NOT IN ('rejected', 'failed', 'cancelled')), 0) AS TEXT) AS available_minor,
    CAST(COALESCE((SELECT SUM(x.amount_minor) FROM cregis_withdrawals x
      WHERE x.tenant_id=? AND x.wallet_id=? AND x.customer_id=?
        AND x.status IN ('submitted', 'approved', 'executing', 'submitted_to_cregis', 'exception')), 0) AS TEXT) AS frozen_minor`
	reconcileWithdrawalSubmittedSQL = `UPDATE cregis_withdrawals
    SET status='submitted_to_cregis', cregis_cid=?, reconciliation_note=?, reconciled_by=?, reconciled_at=?, updated_at=?
    WHERE id=? AND tenant_id=? AND status='exception'`
	reconcileWithdrawalFailedSQL = `UPDATE cregis_withdrawals
    SET status='failed', reconciliation_note=?, reconciled_by=?, reconciled_at=?, updated_at=?
    WHERE id=? AND tenant_id=? AND status='exception'`
	reconcileWithdrawalCancelledSQL = `UPDATE cregis_withdrawals
    SET status='cancelled', reconciliation_note=?, reconciled_by=?, reconciled_at=?, updated_at=?
    WHERE id=? AND tenant_id=? AND status='exception'`
)

func (app *application) routeCregis(w http.ResponseWriter, r *http.Request) bool {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/crypto/wallets":
		app.listCregisWallets(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/crypto/wallets":
		app.createCregisWallet(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/crypto/history":
		app.listCregisHistory(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/crypto/withdrawals":
		app.createCregisWithdrawal(w, r)
	case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/approve") && strings.HasPrefix(r.URL.Path, "/api/v1/crypto/withdrawals/"):
		app.approveCregisWithdrawal(w, r, routeID(r.URL.Path, "/approve"))
	case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/reject") && strings.HasPrefix(r.URL.Path, "/api/v1/crypto/withdrawals/"):
		app.rejectCregisWithdrawal(w, r, routeID(r.URL.Path, "/reject"))
	case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/execute") && strings.HasPrefix(r.URL.Path, "/api/v1/crypto/withdrawals/"):
		app.executeCregisWithdrawal(w, r, routeID(r.URL.Path, "/execute"))
	case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/reconcile") && strings.HasPrefix(r.URL.Path, "/api/v1/crypto/withdrawals/"):
		app.reconcileCregisWithdrawal(w, r, routeID(r.URL.Path, "/reconcile"))
	default:
		return false
	}
	return true
}

func (app *application) createCregisWallet(w http.ResponseWriter, r *http.Request) {
	if !app.requireCregis(w) {
		return
	}
	var input struct {
		CustomerID  string `json:"customer_id"`
		ChainID     string `json:"chain_id"`
		TokenID     string `json:"token_id"`
		Currency    string `json:"currency"`
		Alias       string `json:"alias"`
		Idempotency string `json:"idempotency_key"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if !safeIdentifier.MatchString(input.CustomerID) ||
		!safeIdentifier.MatchString(input.Idempotency) || len(input.Alias) > 100 ||
		(input.ChainID != "" && input.ChainID != usdtTRC20ChainID) ||
		(input.TokenID != "" && input.TokenID != usdtTRC20TokenID) ||
		(input.Currency != "" && input.Currency != usdtTRC20Currency) {
		validationError(w)
		return
	}
	customerRows, err := app.db.Query(r.Context(), `SELECT id FROM customers
    WHERE id=? AND tenant_id=? AND status='active' AND kyc_status='approved' AND operations_status='active'`, input.CustomerID, app.tenantID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(customerRows) != 1 {
		conflict(w, "customer_account_not_available")
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	id := randomID("wallet")
	reservation, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `INSERT OR IGNORE INTO cregis_wallets
      (id, tenant_id, customer_id, idempotency_key, chain_id, token_id, currency, alias, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'creating', ?, ?, ?)`, Params: []any{id, app.tenantID,
			input.CustomerID, input.Idempotency, usdtTRC20ChainID, usdtTRC20TokenID,
			usdtTRC20Currency, nullIfEmpty(input.Alias), edgeUser(r), now, now}},
		d1.Statement{SQL: `SELECT id, customer_id, chain_id, token_id, currency, address, status,
        custody_provider, ownership_verified_at, created_at
      FROM cregis_wallets WHERE tenant_id=? AND customer_id=? AND idempotency_key=?`, Params: []any{app.tenantID, input.CustomerID, input.Idempotency}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(reservation) != 2 || len(reservation[1].Results) != 1 {
		databaseError(app, w, fmt.Errorf("wallet reservation was not readable"))
		return
	}
	reserved := reservation[1].Results[0]
	if resultChanges(reservation[:1]) == 0 {
		if text(reserved["status"]) == "active" && text(reserved["custody_provider"]) == "cregis" &&
			text(reserved["ownership_verified_at"]) != "" && text(reserved["address"]) != "" {
			reserved["deposit_enabled"] = true
			writeJSON(w, http.StatusOK, reserved)
			return
		}
		conflict(w, "wallet_creation_not_retryable")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	response, err := app.cregis.Call(ctx, "/api/v1/address/create", map[string]any{
		"chain_id":     usdtTRC20ChainID,
		"alias":        input.Alias,
		"callback_url": app.publicURL + "/api/v1/callbacks/cregis/deposit",
	})
	if err != nil {
		_, _ = app.db.Query(r.Context(), `UPDATE cregis_wallets SET status='error', updated_at=? WHERE id=? AND status='creating'`, now, id)
		app.logger.Error("Cregis address creation failed", "code", responseCode(response), "error", err)
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": map[string]string{"code": "cregis_address_create_failed"}})
		return
	}
	var data struct {
		Address string `json:"address"`
	}
	if err := json.Unmarshal(response.Data, &data); err != nil || data.Address == "" {
		_, _ = app.db.Query(r.Context(), `UPDATE cregis_wallets SET status='error', updated_at=? WHERE id=? AND status='creating'`, now, id)
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": map[string]string{"code": "invalid_cregis_response"}})
		return
	}
	ownershipResponse, ownershipErr := app.cregis.Call(ctx, "/api/v1/address/inner", map[string]any{
		"chain_id": usdtTRC20ChainID,
		"address":  data.Address,
	})
	ownership := struct {
		Result bool `json:"result"`
	}{}
	verifiedAt := time.Now().UTC().Format(time.RFC3339Nano)
	if ownershipErr != nil || ownershipResponse == nil ||
		json.Unmarshal(ownershipResponse.Data, &ownership) != nil || !ownership.Result {
		_, _ = app.db.Query(r.Context(), failWalletOwnershipVerificationSQL,
			data.Address, verifiedAt, id, app.tenantID)
		app.logger.Error("Cregis wallet ownership verification failed", "wallet_id", id,
			"code", responseCode(ownershipResponse), "error", ownershipErr)
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": map[string]string{
			"code": "cregis_address_ownership_verification_failed",
		}})
		return
	}
	_, err = app.db.Query(ctx, activateVerifiedWalletSQL,
		data.Address, verifiedAt, verifiedAt, id, app.tenantID)
	if err != nil {
		app.logger.Error("store Cregis wallet failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]string{"code": "wallet_persistence_failed"}})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": id, "customer_id": input.CustomerID, "chain_id": usdtTRC20ChainID,
		"token_id": usdtTRC20TokenID, "currency": usdtTRC20Currency, "address": data.Address,
		"status": "active", "custody_provider": "cregis",
		"ownership_verified_at": verifiedAt, "deposit_enabled": true, "created_at": now,
	})
}

func (app *application) listCregisWallets(w http.ResponseWriter, r *http.Request) {
	params := []any{app.tenantID}
	where := "tenant_id = ?"
	if customerID := r.URL.Query().Get("customer_id"); customerID != "" {
		if !safeIdentifier.MatchString(customerID) {
			validationError(w)
			return
		}
		where += " AND customer_id = ?"
		params = append(params, customerID)
	}
	rows, err := app.db.Query(r.Context(), `SELECT id, customer_id, chain_id, token_id, currency,
    CASE WHEN status='active' AND custody_provider='cregis' AND ownership_verified_at IS NOT NULL
      THEN address ELSE NULL END AS address,
    alias, status, custody_provider, ownership_verified_at,
    CASE WHEN status='active' AND custody_provider='cregis' AND ownership_verified_at IS NOT NULL
      AND address IS NOT NULL THEN 1 ELSE 0 END AS deposit_enabled,
    created_at
    FROM cregis_wallets WHERE `+where+` ORDER BY created_at DESC LIMIT 200`, params...)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}

func (app *application) createCregisWithdrawal(w http.ResponseWriter, r *http.Request) {
	var input struct {
		CustomerID  string `json:"customer_id"`
		WalletID    string `json:"wallet_id"`
		Currency    string `json:"currency"`
		Amount      string `json:"amount"`
		FromAddress string `json:"from_address"`
		ToAddress   string `json:"to_address"`
		Idempotency string `json:"idempotency_key"`
		Memo        string `json:"memo"`
		Remark      string `json:"remark"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	amountMinor, amountOK := parseUSDTMicroUnits(input.Amount)
	if !safeIdentifier.MatchString(input.CustomerID) || !safeIdentifier.MatchString(input.WalletID) ||
		(input.Currency != "" && input.Currency != usdtTRC20Currency) ||
		!safeIdentifier.MatchString(input.Idempotency) ||
		!amountOK || len(input.ToAddress) < 8 || len(input.ToAddress) > 256 ||
		len(input.Memo) > 128 || len(input.Remark) > 256 {
		validationError(w)
		return
	}
	walletRows, err := app.db.Query(r.Context(), `SELECT w.id, w.address FROM cregis_wallets w
    JOIN customers c ON c.id=w.customer_id AND c.tenant_id=w.tenant_id
    WHERE w.id=? AND w.tenant_id=? AND w.customer_id=? AND w.chain_id=? AND w.token_id=? AND w.currency=?
      AND w.status='active' AND w.custody_provider='cregis' AND w.ownership_verified_at IS NOT NULL
      AND c.status='active' AND c.kyc_status='approved' AND c.operations_status='active'`,
		input.WalletID, app.tenantID, input.CustomerID, usdtTRC20ChainID, usdtTRC20TokenID, usdtTRC20Currency)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(walletRows) != 1 || text(walletRows[0]["address"]) == "" ||
		(input.FromAddress != "" && input.FromAddress != text(walletRows[0]["address"])) {
		conflict(w, "customer_not_operational_or_wallet_unavailable")
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	id := randomID("withdrawal")
	thirdPartyID := strings.ReplaceAll(randomID("nb"), "_", "")
	results, err := app.db.Batch(r.Context(), d1.Statement{SQL: reserveWithdrawalSQL, Params: []any{id, app.tenantID,
		input.CustomerID, input.Idempotency, thirdPartyID, usdtTRC20Currency, input.Amount, amountMinor,
		input.ToAddress, nullIfEmpty(input.Memo), nullIfEmpty(input.Remark), edgeUser(r), now, now,
		input.WalletID, app.tenantID, input.CustomerID, usdtTRC20ChainID, usdtTRC20TokenID, usdtTRC20Currency, amountMinor}},
		d1.Statement{SQL: `SELECT id, status, third_party_id, wallet_id, amount_text, to_address, created_at FROM cregis_withdrawals
      WHERE tenant_id=? AND customer_id=? AND idempotency_key=?`, Params: []any{app.tenantID, input.CustomerID, input.Idempotency}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 2 {
		databaseError(app, w, fmt.Errorf("withdrawal reservation result invalid"))
		return
	}
	if len(results[1].Results) != 1 {
		conflict(w, "insufficient_available_balance")
		return
	}
	reserved := results[1].Results[0]
	if text(reserved["wallet_id"]) != input.WalletID || text(reserved["amount_text"]) != input.Amount || text(reserved["to_address"]) != input.ToAddress {
		conflict(w, "idempotency_payload_mismatch")
		return
	}
	statusCode := http.StatusCreated
	if resultChanges(results[:1]) == 0 {
		statusCode = http.StatusOK
	}
	writeJSON(w, statusCode, results[1].Results[0])
}

func (app *application) reconcileCregisWithdrawal(w http.ResponseWriter, r *http.Request, id string) {
	var input struct {
		Resolution string `json:"resolution"`
		Note       string `json:"note"`
		CregisCID  string `json:"cregis_cid"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	note := strings.TrimSpace(input.Note)
	if !safeIdentifier.MatchString(id) || note == "" || len(note) > 1000 {
		validationError(w)
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	actor := edgeUser(r)
	var statement d1.Statement
	switch input.Resolution {
	case "submitted_to_cregis":
		if !safeIdentifier.MatchString(input.CregisCID) {
			validationError(w)
			return
		}
		statement = d1.Statement{SQL: reconcileWithdrawalSubmittedSQL, Params: []any{input.CregisCID, note, actor, now, now, id, app.tenantID}}
	case "failed":
		statement = d1.Statement{SQL: reconcileWithdrawalFailedSQL, Params: []any{note, actor, now, now, id, app.tenantID}}
	case "cancelled":
		statement = d1.Statement{SQL: reconcileWithdrawalCancelledSQL, Params: []any{note, actor, now, now, id, app.tenantID}}
	default:
		validationError(w)
		return
	}
	result, err := app.db.Batch(r.Context(), statement)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if resultChanges(result) != 1 {
		conflict(w, "withdrawal_not_reconcilable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": input.Resolution, "reconciled_by": actor, "reconciled_at": now})
}

func (app *application) approveCregisWithdrawal(w http.ResponseWriter, r *http.Request, id string) {
	if !safeIdentifier.MatchString(id) {
		validationError(w)
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := app.db.Batch(r.Context(), d1.Statement{SQL: approveWithdrawalSQL, Params: []any{edgeUser(r), now, now, id, app.tenantID}})
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if resultChanges(result) != 1 {
		conflict(w, "withdrawal_not_approvable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "approved"})
}

func (app *application) rejectCregisWithdrawal(w http.ResponseWriter, r *http.Request, id string) {
	var input struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if !safeIdentifier.MatchString(id) || strings.TrimSpace(input.Reason) == "" || len(input.Reason) > 500 {
		validationError(w)
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := app.db.Batch(r.Context(), d1.Statement{SQL: rejectWithdrawalSQL, Params: []any{edgeUser(r), input.Reason, now, id, app.tenantID}})
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if resultChanges(result) != 1 {
		conflict(w, "withdrawal_not_rejectable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "rejected"})
}

func (app *application) executeCregisWithdrawal(w http.ResponseWriter, r *http.Request, id string) {
	if !app.requireCregis(w) {
		return
	}
	if !safeIdentifier.MatchString(id) {
		validationError(w)
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: startWithdrawalExecutionSQL, Params: []any{edgeUser(r), now, id, app.tenantID}},
		d1.Statement{SQL: `SELECT id, third_party_id, currency, amount_text, from_address, to_address, memo, remark
      FROM cregis_withdrawals WHERE id=? AND tenant_id=?`, Params: []any{id, app.tenantID}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if resultChanges(results[:1]) != 1 || len(results) < 2 || len(results[1].Results) != 1 {
		conflict(w, "withdrawal_not_executable")
		return
	}
	row := results[1].Results[0]
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	currency := text(row["currency"])
	legalResponse, legalErr := app.cregis.Call(ctx, "/api/v1/address/legal", map[string]any{
		"chain_id": usdtTRC20ChainID,
		"address":  text(row["to_address"]),
	})
	legal := struct {
		Result bool `json:"result"`
	}{}
	if legalErr != nil || legalResponse == nil || json.Unmarshal(legalResponse.Data, &legal) != nil || !legal.Result {
		_, _ = app.db.Query(r.Context(), `UPDATE cregis_withdrawals SET status='failed', updated_at=? WHERE id=? AND status='executing'`, now, id)
		app.logger.Warn("Cregis payout address rejected", "withdrawal_id", id, "code", responseCode(legalResponse), "error", legalErr)
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": map[string]string{"code": "invalid_payout_address"}})
		return
	}
	response, callErr := app.cregis.Call(ctx, "/api/v2/payout", map[string]any{
		"currency": currency, "amount": text(row["amount_text"]),
		"from_address": text(row["from_address"]), "to_address": text(row["to_address"]),
		"memo": text(row["memo"]), "remark": text(row["remark"]),
		"third_party_id": text(row["third_party_id"]),
		"callback_url":   app.publicURL + "/api/v1/callbacks/cregis/payout",
	})
	if callErr != nil {
		_, _ = app.db.Query(r.Context(), `UPDATE cregis_withdrawals SET status='exception', updated_at=? WHERE id=? AND status='executing'`, now, id)
		app.logger.Error("Cregis payout submission failed", "withdrawal_id", id, "code", responseCode(response), "error", callErr)
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": map[string]string{"code": "cregis_payout_failed"}})
		return
	}
	var data struct {
		CID json.Number `json:"cid"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(response.Data)))
	decoder.UseNumber()
	if decoder.Decode(&data) != nil || data.CID.String() == "" {
		_, _ = app.db.Query(r.Context(), `UPDATE cregis_withdrawals SET status='exception', updated_at=? WHERE id=? AND status='executing'`, now, id)
		app.logger.Error("Cregis payout response requires reconciliation", "withdrawal_id", id)
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": map[string]string{"code": "invalid_cregis_response"}})
		return
	}
	persistence, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: persistWithdrawalSubmissionSQL, Params: []any{data.CID.String(), now, now, id}},
		d1.Statement{SQL: `SELECT status, cregis_cid FROM cregis_withdrawals WHERE id=? AND tenant_id=?`, Params: []any{id, app.tenantID}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(persistence) != 2 || len(persistence[1].Results) != 1 {
		databaseError(app, w, errors.New("withdrawal submission state was not readable"))
		return
	}
	stored := persistence[1].Results[0]
	storedStatus := text(stored["status"])
	if text(stored["cregis_cid"]) != data.CID.String() ||
		(resultChanges(persistence[:1]) != 1 && !isCregisFinalOrSubmittedStatus(storedStatus)) {
		conflict(w, "withdrawal_submission_state_conflict")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": storedStatus, "cregis_cid": data.CID.String()})
}

func (app *application) listCregisHistory(w http.ResponseWriter, r *http.Request) {
	customerID := r.URL.Query().Get("customer_id")
	if customerID != "" && !safeIdentifier.MatchString(customerID) {
		validationError(w)
		return
	}
	filter := "tenant_id=?"
	params := []any{app.tenantID}
	if customerID != "" {
		filter += " AND customer_id=?"
		params = append(params, customerID)
	}
	withdrawals, err := app.db.Query(r.Context(), `SELECT id, customer_id, 'withdrawal' AS direction, currency, amount_text AS amount,
    status, to_address AS address, txid, cregis_cid, maker_id, checker_id, operator_id,
    approved_at, submitted_at, completed_at, created_at
    FROM cregis_withdrawals WHERE `+filter+` ORDER BY created_at DESC LIMIT 200`, params...)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	depositSQL := `SELECT d.id, w.customer_id, 'deposit' AS direction, d.currency, d.amount_text AS amount,
    d.status, d.address, d.txid, d.cregis_cid, d.received_at AS created_at
    FROM cregis_deposits d JOIN cregis_wallets w ON w.id=d.wallet_id
    WHERE d.tenant_id=? AND w.status='active' AND w.custody_provider='cregis'
      AND w.ownership_verified_at IS NOT NULL`
	depositParams := []any{app.tenantID}
	if customerID != "" {
		depositSQL += " AND w.customer_id=?"
		depositParams = append(depositParams, customerID)
	}
	depositSQL += " ORDER BY d.received_at DESC LIMIT 200"
	deposits, err := app.db.Query(r.Context(), depositSQL, depositParams...)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"withdrawals": withdrawals, "deposits": deposits})
}

func (app *application) cregisDepositCallback(w http.ResponseWriter, r *http.Request) {
	if !app.requireCregis(w) {
		return
	}
	payload, raw, ok := app.readCregisCallback(w, r)
	if !ok {
		return
	}
	status := text(payload["status"])
	if status != "1" && status != "2" {
		http.Error(w, "invalid status", http.StatusUnprocessableEntity)
		return
	}
	cregisCID := text(payload["cid"])
	address := text(payload["address"])
	amountText := text(payload["amount"])
	amountMinor, amountOK := parseUSDTMicroUnits(amountText)
	if cregisCID == "" || address == "" || text(payload["chain_id"]) != usdtTRC20ChainID ||
		text(payload["token_id"]) != usdtTRC20TokenID || !amountOK {
		http.Error(w, "invalid callback", http.StatusUnprocessableEntity)
		return
	}
	walletRows, err := app.db.Query(r.Context(), `SELECT id FROM cregis_wallets
    WHERE tenant_id=? AND address=? AND chain_id=? AND token_id=? AND currency=? AND status='active'
      AND custody_provider='cregis' AND ownership_verified_at IS NOT NULL`,
		app.tenantID, address, usdtTRC20ChainID, usdtTRC20TokenID, usdtTRC20Currency)
	if err != nil {
		app.logger.Error("lookup Cregis deposit wallet failed", "error", err)
		http.Error(w, "retry", http.StatusServiceUnavailable)
		return
	}
	if len(walletRows) != 1 {
		http.Error(w, "unknown wallet", http.StatusUnprocessableEntity)
		return
	}
	walletID := text(walletRows[0]["id"])
	callbackID := randomID("callback")
	hash := sha256Hex(raw)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	finalStatus := "failed"
	if status == "1" {
		finalStatus = "completed"
	}
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `INSERT OR IGNORE INTO cregis_callback_events
      (id, event_type, cregis_cid, status, payload_sha256, received_at) VALUES (?, 'deposit', ?, ?, ?, ?)`, Params: []any{callbackID, cregisCID, status, hash, now}},
		d1.Statement{SQL: `INSERT OR IGNORE INTO cregis_deposits
      (id, tenant_id, wallet_id, cregis_cid, chain_id, token_id, currency, address, amount_text, amount_minor,
       status, txid, block_height, block_time, received_at, raw_sha256)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, Params: []any{randomID("deposit"), app.tenantID, walletID, cregisCID,
			usdtTRC20ChainID, usdtTRC20TokenID, usdtTRC20Currency, address,
			amountText, amountMinor, finalStatus, nullIfEmpty(text(payload["txid"])), nullIfEmpty(text(payload["block_height"])),
			nullIfEmpty(text(payload["block_time"])), now, hash}},
	)
	if err != nil {
		app.logger.Error("store Cregis deposit callback failed", "error", err)
		http.Error(w, "retry", http.StatusServiceUnavailable)
		return
	}
	if len(results) != 2 {
		app.logger.Error("store Cregis deposit callback returned invalid result count")
		http.Error(w, "retry", http.StatusServiceUnavailable)
		return
	}
	if resultChanges(results[1:2]) != 1 {
		rows, lookupErr := app.db.Query(r.Context(), `SELECT wallet_id, chain_id, token_id, currency, address,
      amount_text, CAST(amount_minor AS TEXT) AS amount_minor, status, txid, block_height, block_time, raw_sha256
      FROM cregis_deposits WHERE tenant_id=? AND cregis_cid=?`, app.tenantID, cregisCID)
		if lookupErr != nil {
			app.logger.Error("verify Cregis deposit callback state failed", "error", lookupErr)
			http.Error(w, "retry", http.StatusServiceUnavailable)
			return
		}
		if len(rows) == 0 {
			http.Error(w, "unknown deposit", http.StatusUnprocessableEntity)
			return
		}
		existing := rows[0]
		exact := len(rows) == 1 &&
			text(existing["wallet_id"]) == walletID &&
			text(existing["chain_id"]) == usdtTRC20ChainID &&
			text(existing["token_id"]) == usdtTRC20TokenID &&
			text(existing["currency"]) == usdtTRC20Currency &&
			text(existing["address"]) == address &&
			text(existing["amount_text"]) == amountText &&
			text(existing["amount_minor"]) == strconv.FormatInt(amountMinor, 10) &&
			text(existing["status"]) == finalStatus &&
			text(existing["txid"]) == text(payload["txid"]) &&
			text(existing["block_height"]) == text(payload["block_height"]) &&
			text(existing["block_time"]) == text(payload["block_time"]) &&
			text(existing["raw_sha256"]) == hash
		if !exact {
			http.Error(w, "deposit state conflict", http.StatusConflict)
			return
		}
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte("success"))
}

func (app *application) cregisPayoutCallback(w http.ResponseWriter, r *http.Request) {
	if !app.requireCregis(w) {
		return
	}
	payload, raw, ok := app.readCregisCallback(w, r)
	if !ok {
		return
	}
	status := text(payload["status"])
	target := map[string]string{"2": "rejected", "4": "rejected", "6": "completed", "7": "failed"}[status]
	if target == "" {
		http.Error(w, "invalid status", http.StatusUnprocessableEntity)
		return
	}
	cregisCID := text(payload["cid"])
	thirdPartyID := text(payload["third_party_id"])
	if cregisCID == "" || thirdPartyID == "" || text(payload["chain_id"]) != usdtTRC20ChainID ||
		text(payload["token_id"]) != usdtTRC20TokenID {
		http.Error(w, "invalid callback", http.StatusUnprocessableEntity)
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	completedAt := any(nil)
	if target == "completed" {
		completedAt = now
	}
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `INSERT OR IGNORE INTO cregis_callback_events
      (id, event_type, cregis_cid, status, payload_sha256, received_at) VALUES (?, 'payout', ?, ?, ?, ?)`, Params: []any{randomID("callback"), cregisCID, status, sha256Hex(raw), now}},
		d1.Statement{SQL: `UPDATE cregis_withdrawals SET status='submitted_to_cregis', cregis_cid=?, submitted_at=COALESCE(submitted_at, ?), updated_at=?
      WHERE tenant_id=? AND third_party_id=? AND status IN ('executing', 'exception')`, Params: []any{cregisCID, now, now, app.tenantID, thirdPartyID}},
		d1.Statement{SQL: `UPDATE cregis_withdrawals SET status=?, cregis_cid=?, txid=?, block_height=?, block_time=?, completed_at=?, updated_at=?
      WHERE tenant_id=? AND third_party_id=? AND status='submitted_to_cregis'`, Params: []any{target, cregisCID,
			nullIfEmpty(text(payload["txid"])), nullIfEmpty(text(payload["block_height"])), nullIfEmpty(text(payload["block_time"])),
			completedAt, now, app.tenantID, thirdPartyID}},
	)
	if err != nil {
		app.logger.Error("store Cregis payout callback failed", "error", err)
		http.Error(w, "retry", http.StatusServiceUnavailable)
		return
	}
	if len(results) != 3 || resultChanges(results[2:3]) != 1 {
		rows, lookupErr := app.db.Query(r.Context(), `SELECT status, cregis_cid FROM cregis_withdrawals
      WHERE tenant_id=? AND third_party_id=?`, app.tenantID, thirdPartyID)
		if lookupErr != nil {
			app.logger.Error("verify Cregis payout callback state failed", "error", lookupErr)
			http.Error(w, "retry", http.StatusServiceUnavailable)
			return
		}
		if len(rows) == 1 && text(rows[0]["status"]) == target && text(rows[0]["cregis_cid"]) == cregisCID {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			_, _ = w.Write([]byte("success"))
			return
		}
		if len(rows) == 0 {
			http.Error(w, "unknown payout", http.StatusUnprocessableEntity)
			return
		}
		http.Error(w, "payout state conflict", http.StatusConflict)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte("success"))
}

func (app *application) readCregisCallback(w http.ResponseWriter, r *http.Request) (map[string]any, []byte, bool) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 128*1024+1))
	if err != nil || len(raw) > 128*1024 {
		http.Error(w, "invalid callback", http.StatusBadRequest)
		return nil, nil, false
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	payload := map[string]any{}
	if decoder.Decode(&payload) != nil || !app.cregis.Verify(payload) || text(payload["pid"]) != fmt.Sprint(app.cregis.ProjectID()) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return nil, nil, false
	}
	return payload, raw, true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 128*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		validationError(w)
		return false
	}
	return true
}

func validationError(w http.ResponseWriter) {
	writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": map[string]string{"code": "validation_error"}})
}
func (app *application) requireCregis(w http.ResponseWriter) bool {
	if app.cregisLive && app.cregis != nil {
		return true
	}
	writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": map[string]string{"code": "cregis_not_enabled"}})
	return false
}
func conflict(w http.ResponseWriter, code string) {
	writeJSON(w, http.StatusConflict, map[string]any{"error": map[string]string{"code": code}})
}
func databaseError(app *application, w http.ResponseWriter, err error) {
	app.logger.Error("database operation failed", "error", err)
	writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]string{"code": "database_error"}})
}
func edgeUser(r *http.Request) string {
	value := strings.TrimSpace(r.Header.Get("X-Neobank-User"))
	if value == "" {
		return "unknown"
	}
	return value
}
func nullIfEmpty(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
func text(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(value)
}
func routeID(path, suffix string) string {
	return strings.TrimSuffix(strings.TrimPrefix(path, "/api/v1/crypto/withdrawals/"), suffix)
}
func randomID(prefix string) string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		panic("crypto/rand unavailable")
	}
	return prefix + "_" + hex.EncodeToString(bytes)
}
func sha256Hex(raw []byte) string { digest := sha256.Sum256(raw); return hex.EncodeToString(digest[:]) }
func isPositiveDecimal(value string) bool {
	_, ok := parseUSDTMicroUnits(value)
	return ok
}

func parseUSDTMicroUnits(value string) (int64, bool) {
	if !positiveDecimal.MatchString(value) {
		return 0, false
	}
	parts := strings.SplitN(value, ".", 2)
	whole, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, false
	}
	fractionText := ""
	if len(parts) == 2 {
		fractionText = parts[1]
	}
	fractionText += strings.Repeat("0", 6-len(fractionText))
	fraction, err := strconv.ParseInt(fractionText, 10, 64)
	if err != nil || whole > (int64(^uint64(0)>>1)-fraction)/1_000_000 {
		return 0, false
	}
	minor := whole*1_000_000 + fraction
	return minor, minor > 0
}

func formatUSDTMicroUnits(value int64) string {
	whole := value / 1_000_000
	fraction := value % 1_000_000
	if fraction == 0 {
		return strconv.FormatInt(whole, 10)
	}
	return strconv.FormatInt(whole, 10) + "." + strings.TrimRight(fmt.Sprintf("%06d", fraction), "0")
}
func isCregisFinalOrSubmittedStatus(status string) bool {
	switch status {
	case "submitted_to_cregis", "completed", "rejected", "failed":
		return true
	default:
		return false
	}
}
func responseCode(response interface{ GetCode() string }) string {
	if response == nil {
		return ""
	}
	return response.GetCode()
}
func resultChanges(results []d1.Result) int64 {
	if len(results) == 0 {
		return 0
	}
	value, ok := results[0].Meta["changes"].(float64)
	if !ok {
		return 0
	}
	return int64(value)
}
