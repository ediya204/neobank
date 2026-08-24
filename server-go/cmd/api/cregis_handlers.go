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
	tronTxID        = regexp.MustCompile(`^[A-Fa-f0-9]{64}$`)
)

type walletProvisionError struct {
	status int
	code   string
	cause  error
}

func walletReservationCanRetryOwnership(status string) bool {
	return status == "error" || status == "active"
}

func (err *walletProvisionError) Error() string {
	if err.cause != nil {
		return err.code + ": " + err.cause.Error()
	}
	return err.code
}

const (
	usdtTRC20ChainID  = "195"
	usdtTRC20TokenID  = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
	usdtTRC20Currency = usdtTRC20ChainID + "@" + usdtTRC20TokenID
	cregisPayoutPath  = "/api/v2/payout"

	approveWithdrawalSQL = `WITH accounting AS (
	    SELECT withdrawal_id FROM cregis_withdrawal_accounting
	    WHERE withdrawal_id=? AND tenant_id=? AND status='reserved'
	    FOR UPDATE
	  ), approved AS (
	    UPDATE cregis_withdrawals SET status='approved', checker_id=?, approved_at=?, updated_at=?
	    WHERE id=? AND tenant_id=? AND status='submitted'
	      AND EXISTS (SELECT 1 FROM accounting)
	    RETURNING id
	  )
	  UPDATE cregis_withdrawal_accounting a
	  SET status='pending_approval', next_attempt_at=NOW(), updated_at=NOW()
	  FROM approved WHERE a.withdrawal_id=approved.id AND a.status='reserved'
	  RETURNING a.withdrawal_id`
	rejectWithdrawalSQL = `WITH accounting AS (
	    SELECT withdrawal_id, core_operation_id FROM cregis_withdrawal_accounting
	    WHERE withdrawal_id=? AND tenant_id=?
	      AND status IN ('pending_reservation','reserving','reserved')
	    FOR UPDATE
	  ), rejected AS (
	    UPDATE cregis_withdrawals SET status='rejected', checker_id=?, rejection_reason=?, updated_at=?
	    WHERE id=? AND tenant_id=? AND status='submitted'
	      AND EXISTS (SELECT 1 FROM accounting)
	    RETURNING id
	  )
	  UPDATE cregis_withdrawal_accounting a
	  SET status=CASE WHEN a.core_operation_id IS NULL THEN 'released' ELSE 'pending_release' END,
	      released_at=CASE WHEN a.core_operation_id IS NULL THEN NOW() ELSE NULL END,
	      next_attempt_at=NOW(), locked_at=NULL, updated_at=NOW()
	  FROM rejected WHERE a.withdrawal_id=rejected.id
	  RETURNING a.withdrawal_id`
	startWithdrawalExecutionSQL = `UPDATE cregis_withdrawals SET status='executing', operator_id=?, updated_at=?
	      WHERE id=? AND tenant_id=? AND status='approved' AND checker_id IS NOT NULL
	        AND EXISTS (SELECT 1 FROM cregis_withdrawal_accounting a
	          WHERE a.withdrawal_id=cregis_withdrawals.id AND a.tenant_id=cregis_withdrawals.tenant_id
	            AND a.status='approved')`
	persistWithdrawalSubmissionSQL = `UPDATE cregis_withdrawals
    SET status='submitted_to_cregis', cregis_cid=?, submitted_at=?, updated_at=?
	      WHERE id=? AND status='executing'
	        AND EXISTS (SELECT 1 FROM cregis_withdrawal_accounting a
	          WHERE a.withdrawal_id=cregis_withdrawals.id AND a.status='approved')`
	resetWalletOwnershipVerificationSQL = `WITH reset AS (
      UPDATE cregis_wallets SET status='creating', updated_at=?
      WHERE id=? AND tenant_id=? AND status IN ('error', 'active')
      RETURNING id
    ) SELECT id FROM reset`
	activateVerifiedWalletSQL = `WITH activated AS (
      UPDATE cregis_wallets
      SET address=?, custody_provider='cregis', ownership_verified_at=?, status='active', updated_at=?
      WHERE id=? AND tenant_id=? AND status='creating'
      RETURNING id
    ) SELECT id FROM activated`
	failWalletOwnershipVerificationSQL = `UPDATE cregis_wallets
      SET address=?, status='error', updated_at=? WHERE id=? AND tenant_id=? AND status='creating'`
	reserveWithdrawalSQL = `INSERT OR IGNORE INTO cregis_withdrawals
    (id, tenant_id, customer_id, wallet_id, idempotency_key, third_party_id, currency, amount_text, amount_minor,
     fee_amount_text, fee_amount_minor, net_amount_text, net_amount_minor, fee_rule_id, fee_rule_version,
     from_address, to_address, withdrawal_address_id, memo, remark, status, maker_id, created_at, updated_at)
    SELECT ?, ?, ?, w.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      w.address, a.address, a.id, ?, ?, 'submitted', ?, ?, ?
    FROM cregis_wallets w
    JOIN customers c ON c.id=w.customer_id AND c.tenant_id=w.tenant_id
    JOIN customer_withdrawal_addresses a
      ON a.id=? AND a.tenant_id=w.tenant_id AND a.customer_id=c.id
      AND a.currency=w.currency AND a.network='TRON' AND a.status='active'
    WHERE w.id=? AND w.tenant_id=? AND w.customer_id=? AND w.chain_id=? AND w.token_id=? AND w.currency=?
      AND w.status='active' AND w.custody_provider='cregis' AND w.ownership_verified_at IS NOT NULL
      AND c.status='active' AND c.kyc_status='approved' AND c.operations_status='active'
	      AND ? <= COALESCE((
	        SELECT CAST(FLOOR(core_wallet."availableBalance" * 1000000) AS BIGINT)
	        FROM "CryptoWallet" core_wallet
	        WHERE core_wallet."customerId"=c.id AND core_wallet.asset='USDT'
	          AND core_wallet.network='TRON' AND core_wallet.status='ACTIVE'
	      ), 0) - COALESCE((
	        SELECT SUM(x.amount_minor) FROM cregis_withdrawals x
	        JOIN cregis_withdrawal_accounting a ON a.withdrawal_id=x.id AND a.tenant_id=x.tenant_id
	        WHERE x.tenant_id=w.tenant_id AND x.wallet_id=w.id AND x.customer_id=c.id
	          AND a.status IN ('pending_reservation','reserving')
	      ), 0)`
	walletBalancesSQL = `SELECT
	    CAST(COALESCE(FLOOR(core_wallet."availableBalance" * 1000000), 0) AS TEXT) AS available_minor,
	    CAST(COALESCE(FLOOR(core_wallet."frozenBalance" * 1000000), 0) AS TEXT) AS frozen_minor
	  FROM cregis_wallets wallet
	  LEFT JOIN "CryptoWallet" core_wallet
	    ON core_wallet."customerId"=wallet.customer_id
	    AND core_wallet.asset='USDT' AND core_wallet.network='TRON'
	    AND core_wallet.status='ACTIVE' AND core_wallet."walletAddress"=wallet.address
	  WHERE wallet.tenant_id=? AND wallet.id=? AND wallet.customer_id=?
	    AND wallet.status='active' AND wallet.custody_provider='cregis'
	    AND wallet.ownership_verified_at IS NOT NULL`
	reconcileWithdrawalSubmittedSQL = `UPDATE cregis_withdrawals
    SET status='submitted_to_cregis', cregis_cid=?, reconciliation_note=?, reconciled_by=?, reconciled_at=?, updated_at=?
    WHERE id=? AND tenant_id=? AND status='exception'`
	failWithdrawalForReleaseSQL = `WITH failed AS (
	  UPDATE cregis_withdrawals SET status='failed', updated_at=?
	  WHERE id=? AND tenant_id=? AND status='executing'
	    AND EXISTS (
	      SELECT 1 FROM cregis_withdrawal_accounting a
	      WHERE a.withdrawal_id=cregis_withdrawals.id
	        AND a.tenant_id=cregis_withdrawals.tenant_id AND a.status='approved'
	    )
	  RETURNING id, tenant_id
	)
	UPDATE cregis_withdrawal_accounting a
	SET status='pending_release', next_attempt_at=NOW(), locked_at=NULL, updated_at=NOW()
	FROM failed
	WHERE a.withdrawal_id=failed.id AND a.tenant_id=failed.tenant_id AND a.status='approved'
	RETURNING a.withdrawal_id`
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
	wallet, status, provisionErr := app.provisionCregisWallet(r.Context(), input.CustomerID,
		input.Alias, input.Idempotency, edgeUser(r))
	if provisionErr != nil {
		app.writeWalletProvisionError(w, provisionErr)
		return
	}
	writeJSON(w, status, wallet)
}

func (app *application) writeWalletProvisionError(w http.ResponseWriter, provisionErr *walletProvisionError) {
	if provisionErr.cause != nil {
		app.logger.Error("Cregis wallet provisioning failed", "code", provisionErr.code, "error", provisionErr.cause)
	}
	writeJSON(w, provisionErr.status, map[string]any{"error": map[string]string{"code": provisionErr.code}})
}

func (app *application) provisionCregisWallet(ctx context.Context, customerID, alias, idempotency, actor string) (map[string]any, int, *walletProvisionError) {
	if !app.cregisLive || app.cregis == nil {
		return nil, 0, &walletProvisionError{status: http.StatusServiceUnavailable, code: "cregis_not_enabled"}
	}
	customerRows, err := app.db.Query(ctx, `SELECT id FROM customers
    WHERE id=? AND tenant_id=? AND status IN ('active', 'pending_setup')
      AND kyc_status='approved' AND operations_status='active'`, customerID, app.tenantID)
	if err != nil {
		return nil, 0, &walletProvisionError{status: http.StatusInternalServerError, code: "database_error", cause: err}
	}
	if len(customerRows) != 1 {
		return nil, 0, &walletProvisionError{status: http.StatusConflict, code: "customer_account_not_available"}
	}
	existing, err := app.db.Query(ctx, `SELECT id, customer_id, chain_id, token_id, currency, address, status,
      custody_provider, ownership_verified_at, created_at
    FROM cregis_wallets WHERE tenant_id=? AND customer_id=? AND chain_id=? AND token_id=?
      AND status='active' AND custody_provider='cregis' AND ownership_verified_at IS NOT NULL
      AND address IS NOT NULL ORDER BY created_at ASC LIMIT 1`, app.tenantID, customerID,
		usdtTRC20ChainID, usdtTRC20TokenID)
	if err != nil {
		return nil, 0, &walletProvisionError{status: http.StatusInternalServerError, code: "database_error", cause: err}
	}
	if len(existing) == 1 {
		existing[0]["deposit_enabled"] = true
		return existing[0], http.StatusOK, nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	id := randomID("wallet")
	reservation, err := app.db.Batch(ctx,
		d1.Statement{SQL: `INSERT OR IGNORE INTO cregis_wallets
      (id, tenant_id, customer_id, idempotency_key, chain_id, token_id, currency, alias, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'creating', ?, ?, ?)`, Params: []any{id, app.tenantID,
			customerID, idempotency, usdtTRC20ChainID, usdtTRC20TokenID,
			usdtTRC20Currency, nullIfEmpty(alias), actor, now, now}},
		d1.Statement{SQL: `SELECT id, customer_id, chain_id, token_id, currency, address, status,
        custody_provider, ownership_verified_at, created_at
      FROM cregis_wallets WHERE tenant_id=? AND customer_id=? AND idempotency_key=?`, Params: []any{app.tenantID, customerID, idempotency}},
	)
	if err != nil {
		return nil, 0, &walletProvisionError{status: http.StatusInternalServerError, code: "database_error", cause: err}
	}
	if len(reservation) != 2 || len(reservation[1].Results) != 1 {
		return nil, 0, &walletProvisionError{status: http.StatusInternalServerError, code: "database_error", cause: fmt.Errorf("wallet reservation was not readable")}
	}
	reserved := reservation[1].Results[0]
	if resultChanges(reservation[:1]) == 0 {
		if text(reserved["status"]) == "active" && text(reserved["custody_provider"]) == "cregis" &&
			text(reserved["ownership_verified_at"]) != "" && text(reserved["address"]) != "" {
			reserved["deposit_enabled"] = true
			return reserved, http.StatusOK, nil
		}
		if !walletReservationCanRetryOwnership(text(reserved["status"])) {
			return nil, 0, &walletProvisionError{status: http.StatusConflict, code: "wallet_creation_in_progress"}
		}
		reset, resetErr := app.db.Query(ctx, resetWalletOwnershipVerificationSQL,
			now, text(reserved["id"]), app.tenantID)
		if resetErr != nil || len(reset) != 1 {
			if resetErr == nil {
				resetErr = errors.New("wallet retry reservation failed")
			}
			return nil, 0, &walletProvisionError{status: http.StatusInternalServerError, code: "database_error", cause: resetErr}
		}
		id = text(reserved["id"])
	}
	provisionCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	address := text(reserved["address"])
	if address == "" {
		response, createErr := app.cregis.Call(provisionCtx, "/api/v1/address/create", map[string]any{
			"chain_id":     usdtTRC20ChainID,
			"alias":        alias,
			"callback_url": app.publicURL + "/api/v1/callbacks/cregis/deposit",
		})
		if createErr != nil {
			_, _ = app.db.Query(ctx, `UPDATE cregis_wallets SET status='error', updated_at=? WHERE id=? AND status='creating'`, now, id)
			return nil, 0, &walletProvisionError{status: http.StatusBadGateway, code: "cregis_address_create_failed", cause: fmt.Errorf("code=%s: %w", responseCode(response), createErr)}
		}
		var data struct {
			Address string `json:"address"`
		}
		if decodeErr := json.Unmarshal(response.Data, &data); decodeErr != nil || data.Address == "" {
			_, _ = app.db.Query(ctx, `UPDATE cregis_wallets SET status='error', updated_at=? WHERE id=? AND status='creating'`, now, id)
			if decodeErr == nil {
				decodeErr = errors.New("Cregis response did not include an address")
			}
			return nil, 0, &walletProvisionError{status: http.StatusBadGateway, code: "invalid_cregis_response", cause: decodeErr}
		}
		address = data.Address
	}
	ownershipResponse, ownershipErr := app.cregis.Call(provisionCtx, "/api/v1/address/inner", map[string]any{
		"chain_id": usdtTRC20ChainID,
		"address":  address,
	})
	ownership := struct {
		Result bool `json:"result"`
	}{}
	verifiedAt := time.Now().UTC().Format(time.RFC3339Nano)
	if ownershipErr != nil || ownershipResponse == nil ||
		json.Unmarshal(ownershipResponse.Data, &ownership) != nil || !ownership.Result {
		_, _ = app.db.Query(ctx, failWalletOwnershipVerificationSQL,
			address, verifiedAt, id, app.tenantID)
		if ownershipErr == nil {
			ownershipErr = errors.New("Cregis did not confirm wallet ownership")
		}
		return nil, 0, &walletProvisionError{status: http.StatusBadGateway,
			code:  "cregis_address_ownership_verification_failed",
			cause: fmt.Errorf("wallet_id=%s code=%s: %w", id, responseCode(ownershipResponse), ownershipErr)}
	}
	stored, err := app.db.Query(ctx, activateVerifiedWalletSQL,
		address, verifiedAt, verifiedAt, id, app.tenantID)
	if err != nil {
		return nil, 0, &walletProvisionError{status: http.StatusInternalServerError, code: "wallet_persistence_failed", cause: err}
	}
	if len(stored) != 1 {
		return nil, 0, &walletProvisionError{status: http.StatusConflict, code: "wallet_activation_state_conflict"}
	}
	return map[string]any{
		"id": id, "customer_id": customerID, "chain_id": usdtTRC20ChainID,
		"token_id": usdtTRC20TokenID, "currency": usdtTRC20Currency, "address": address,
		"status": "active", "custody_provider": "cregis",
		"ownership_verified_at": verifiedAt, "deposit_enabled": true, "created_at": now,
	}, http.StatusCreated, nil
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
	if !app.withdrawalAccounting {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": map[string]string{"code": "withdrawal_accounting_not_enabled"}})
		return
	}
	var input struct {
		CustomerID          string `json:"customer_id"`
		WalletID            string `json:"wallet_id"`
		Currency            string `json:"currency"`
		Amount              string `json:"amount"`
		FromAddress         string `json:"from_address"`
		WithdrawalAddressID string `json:"withdrawal_address_id"`
		Idempotency         string `json:"idempotency_key"`
		Memo                string `json:"memo"`
		Remark              string `json:"remark"`
		ExpectedFeeAmount   string `json:"expected_fee_amount"`
		ExpectedFeeVersion  string `json:"expected_fee_rule_version"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	amountMinor, amountOK := parseUSDTMicroUnits(input.Amount)
	if !safeIdentifier.MatchString(input.CustomerID) || !safeIdentifier.MatchString(input.WalletID) ||
		!safeIdentifier.MatchString(input.WithdrawalAddressID) ||
		(input.Currency != "" && input.Currency != usdtTRC20Currency) ||
		!safeIdentifier.MatchString(input.Idempotency) ||
		!amountOK ||
		len(input.Memo) > 128 || len(input.Remark) > 256 {
		validationError(w)
		return
	}
	existingRows, err := app.db.Query(r.Context(), `SELECT x.id, x.status, x.third_party_id, x.wallet_id,
    amount_text, fee_amount_text, net_amount_text, fee_rule_id,
	CAST(fee_rule_version AS TEXT) AS fee_rule_version, to_address, withdrawal_address_id, x.created_at,
	COALESCE(a.status, 'missing') AS accounting_status, a.core_operation_id
	FROM cregis_withdrawals x
	LEFT JOIN cregis_withdrawal_accounting a ON a.withdrawal_id=x.id AND a.tenant_id=x.tenant_id
	WHERE x.tenant_id=? AND x.customer_id=? AND x.idempotency_key=?`,
		app.tenantID, input.CustomerID, input.Idempotency)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(existingRows) == 1 {
		existing := existingRows[0]
		if text(existing["accounting_status"]) == "missing" {
			conflict(w, "withdrawal_accounting_missing")
			return
		}
		if text(existing["wallet_id"]) != input.WalletID || text(existing["amount_text"]) != input.Amount ||
			text(existing["withdrawal_address_id"]) != input.WithdrawalAddressID {
			conflict(w, "idempotency_payload_mismatch")
			return
		}
		writeJSON(w, http.StatusOK, existing)
		return
	}
	if len(existingRows) > 1 {
		databaseError(app, w, errors.New("duplicate withdrawal idempotency records"))
		return
	}
	feeRule, err := app.activeWithdrawalFee(r.Context(), input.CustomerID, "CRYPTO", "USDT", "ON_CHAIN", "CREGIS", "TRON")
	if err != nil {
		if errors.Is(err, errWithdrawalFeeMissing) {
			conflict(w, "fee_configuration_missing")
			return
		}
		databaseError(app, w, err)
		return
	}
	if input.ExpectedFeeVersion != "" && input.ExpectedFeeVersion != strconv.FormatInt(feeRule.Version, 10) {
		conflict(w, "withdrawal_fee_changed")
		return
	}
	if input.ExpectedFeeAmount != "" {
		expectedFeeMinor, ok := parseUSDTMicroUnitsAllowZero(input.ExpectedFeeAmount)
		if !ok || expectedFeeMinor != feeRule.AmountMinor {
			conflict(w, "withdrawal_fee_changed")
			return
		}
	}
	if feeRule.Decimals != 6 {
		databaseError(app, w, errors.New("USDT withdrawal fee must use six decimals"))
		return
	}
	if amountMinor <= feeRule.AmountMinor {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": map[string]string{"code": "withdrawal_amount_too_low"}})
		return
	}
	feeAmountText := formatUSDTMicroUnits(feeRule.AmountMinor)
	netAmountMinor := amountMinor - feeRule.AmountMinor
	netAmountText := formatUSDTMicroUnits(netAmountMinor)
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
		feeAmountText, feeRule.AmountMinor, netAmountText, netAmountMinor, feeRule.ID, feeRule.Version,
		nullIfEmpty(input.Memo), nullIfEmpty(input.Remark), edgeUser(r), now, now, input.WithdrawalAddressID,
		input.WalletID, app.tenantID, input.CustomerID, usdtTRC20ChainID, usdtTRC20TokenID, usdtTRC20Currency, amountMinor}},
		d1.Statement{SQL: `INSERT OR IGNORE INTO cregis_withdrawal_accounting
		(withdrawal_id, tenant_id, customer_id, status, enqueue_source, enqueued_by,
		 attempt_count, next_attempt_at, created_at, updated_at)
		SELECT id, tenant_id, customer_id, 'pending_reservation', 'customer_request',
		 'customer_request', 0, ?, ?, ?
		FROM cregis_withdrawals
		WHERE id=? AND tenant_id=? AND customer_id=? AND idempotency_key=?`,
			Params: []any{now, now, now, id, app.tenantID, input.CustomerID, input.Idempotency}},
		d1.Statement{SQL: `SELECT id, status, third_party_id, wallet_id, amount_text, fee_amount_text,
      net_amount_text, fee_rule_id, CAST(fee_rule_version AS TEXT) AS fee_rule_version,
	  to_address, withdrawal_address_id, created_at,
	  (SELECT status FROM cregis_withdrawal_accounting a
	   WHERE a.withdrawal_id=cregis_withdrawals.id AND a.tenant_id=cregis_withdrawals.tenant_id) AS accounting_status
	  FROM cregis_withdrawals
	  WHERE tenant_id=? AND customer_id=? AND idempotency_key=?`, Params: []any{app.tenantID, input.CustomerID, input.Idempotency}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 3 {
		databaseError(app, w, fmt.Errorf("withdrawal reservation result invalid"))
		return
	}
	if len(results[2].Results) != 1 || text(results[2].Results[0]["accounting_status"]) == "" {
		conflict(w, "withdrawal_address_unavailable_or_insufficient_balance")
		return
	}
	reserved := results[2].Results[0]
	if text(reserved["wallet_id"]) != input.WalletID || text(reserved["amount_text"]) != input.Amount || text(reserved["withdrawal_address_id"]) != input.WithdrawalAddressID {
		conflict(w, "idempotency_payload_mismatch")
		return
	}
	statusCode := http.StatusCreated
	if resultChanges(results[:1]) == 0 {
		statusCode = http.StatusOK
	}
	writeJSON(w, statusCode, results[2].Results[0])
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
	if input.Resolution != "submitted_to_cregis" || !safeIdentifier.MatchString(input.CregisCID) {
		validationError(w)
		return
	}
	statement := d1.Statement{SQL: reconcileWithdrawalSubmittedSQL, Params: []any{input.CregisCID, note, actor, now, now, id, app.tenantID}}
	result, err := app.db.Batch(r.Context(), statement)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(result) != 1 || resultChanges(result) != 1 {
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
	rows, err := app.db.Query(r.Context(), approveWithdrawalSQL,
		id, app.tenantID, edgeUser(r), now, now, id, app.tenantID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
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
	rows, err := app.db.Query(r.Context(), rejectWithdrawalSQL,
		id, app.tenantID, edgeUser(r), input.Reason, now, id, app.tenantID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
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
		d1.Statement{SQL: `SELECT id, third_party_id, currency, net_amount_text, to_address, memo, remark
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
	legalResponse, legalErr := app.cregis.Call(ctx, "/api/v1/address/legal", map[string]any{
		"chain_id": usdtTRC20ChainID,
		"address":  text(row["to_address"]),
	})
	legal := struct {
		Result bool `json:"result"`
	}{}
	if legalErr != nil || legalResponse == nil || json.Unmarshal(legalResponse.Data, &legal) != nil || !legal.Result {
		if !app.markWithdrawalFailedForRelease(r.Context(), id, now) {
			http.Error(w, "retry", http.StatusServiceUnavailable)
			return
		}
		app.logger.Warn("Cregis payout address rejected", "withdrawal_id", id, "code", responseCode(legalResponse), "error", legalErr)
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": map[string]string{"code": "invalid_payout_address"}})
		return
	}
	response, callErr := app.cregis.Call(ctx, cregisPayoutPath, cregisDefaultWalletPayout(row, app.publicURL))
	if callErr != nil {
		if responseCode(response) == "E0008" {
			if !app.markWithdrawalFailedForRelease(r.Context(), id, now) {
				http.Error(w, "retry", http.StatusServiceUnavailable)
				return
			}
			app.logger.Warn("Cregis payout address rejected", "withdrawal_id", id, "code", responseCode(response))
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": map[string]string{"code": "invalid_payout_address"}})
			return
		}
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

func cregisDefaultWalletPayout(row map[string]any, publicURL string) map[string]any {
	// Customer sub-addresses identify deposits and ledger ownership only. Funds are
	// collected separately; omitting source selectors makes WaaS use the project's
	// configured default payout wallet.
	return map[string]any{
		"currency":       text(row["currency"]),
		"amount":         text(row["net_amount_text"]),
		"to_address":     text(row["to_address"]),
		"memo":           text(row["memo"]),
		"remark":         text(row["remark"]),
		"third_party_id": text(row["third_party_id"]),
		"callback_url":   publicURL + "/api/v1/callbacks/cregis/payout",
	}
}

func (app *application) markWithdrawalFailedForRelease(ctx context.Context, id, now string) bool {
	rows, err := app.db.Query(ctx, failWithdrawalForReleaseSQL, now, id, app.tenantID)
	if err != nil || len(rows) != 1 {
		app.logger.Error("queue Cregis withdrawal release failed", "withdrawal_id", id, "error", err)
		return false
	}
	return true
}

func (app *application) listCregisHistory(w http.ResponseWriter, r *http.Request) {
	customerID := r.URL.Query().Get("customer_id")
	if customerID != "" && !safeIdentifier.MatchString(customerID) {
		validationError(w)
		return
	}
	filter := "x.tenant_id=?"
	params := []any{app.tenantID}
	if customerID != "" {
		filter += " AND x.customer_id=?"
		params = append(params, customerID)
	}
	withdrawals, err := app.db.Query(r.Context(), `SELECT x.id, x.customer_id, c.display_name AS customer_name,
	'withdrawal' AS direction, x.currency, x.amount_text AS amount,
    x.fee_amount_text AS fee_amount, x.net_amount_text AS net_amount,
	CAST(x.fee_rule_version AS TEXT) AS fee_rule_version,
	CASE
	  WHEN a.withdrawal_id IS NULL AND EXISTS (
	    SELECT 1 FROM cregis_callback_events e
	    WHERE e.event_type='payout' AND e.cregis_cid=x.cregis_cid AND e.status IN ('2', '4')
	  ) THEN 'provider_rejected'
	  WHEN a.withdrawal_id IS NULL THEN 'exception'
	  WHEN a.status='settled' THEN 'completed'
	  WHEN a.status='released' THEN x.status
	  WHEN a.status='exception' THEN 'exception'
	  ELSE 'processing'
	END AS status,
	x.status AS custody_status, COALESCE(a.status, 'not_accounted') AS accounting_status,
	a.core_operation_id, a.core_transfer_id,
	x.to_address AS address, x.txid, x.cregis_cid, x.maker_id, x.checker_id, x.operator_id,
	x.approved_at, x.submitted_at, x.completed_at, x.created_at
	FROM cregis_withdrawals x
	LEFT JOIN customers c ON c.id=x.customer_id AND c.tenant_id=x.tenant_id
	LEFT JOIN cregis_withdrawal_accounting a ON a.withdrawal_id=x.id AND a.tenant_id=x.tenant_id
	WHERE `+filter+` ORDER BY x.created_at DESC LIMIT 200`, params...)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	depositSQL := `SELECT d.id, w.customer_id, c.display_name AS customer_name,
		'deposit' AS direction, d.currency, d.amount_text AS amount,
		CASE
		  WHEN d.status='failed' THEN 'failed'
		  WHEN a.deposit_id IS NULL THEN 'exception'
		  WHEN a.status='posted' THEN 'completed'
		  WHEN a.status='exception' THEN 'exception'
		  ELSE 'processing'
		END AS status,
		d.status AS custody_status, COALESCE(a.status, 'not_posted') AS accounting_status,
		d.address, d.from_address, d.txid, d.cregis_cid, d.received_at AS created_at
    FROM cregis_deposits d JOIN cregis_wallets w ON w.id=d.wallet_id
	LEFT JOIN customers c ON c.id=w.customer_id AND c.tenant_id=w.tenant_id
	LEFT JOIN cregis_deposit_accounting a ON a.deposit_id=d.id AND a.tenant_id=d.tenant_id
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
	txid := text(payload["txid"])
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
	fromAddress := ""
	if finalStatus == "completed" {
		cid, parseErr := strconv.ParseInt(cregisCID, 10, 64)
		if parseErr != nil || txid == "" {
			http.Error(w, "invalid callback", http.StatusUnprocessableEntity)
			return
		}
		trade, tradeErr := app.cregis.DepositTrade(r.Context(), cid, txid, usdtTRC20ChainID, usdtTRC20TokenID)
		tradeAmountMinor, tradeAmountOK := parseUSDTMicroUnits(trade.Amount)
		if tradeErr != nil || trade.ToAddress != address || tradeAmountMinor != amountMinor || !tradeAmountOK ||
			trade.Status != 1 || !validTronAddress(trade.FromAddress) {
			app.logger.Error("verify Cregis deposit source address failed", "cid", cregisCID, "error", tradeErr)
			http.Error(w, "retry", http.StatusServiceUnavailable)
			return
		}
		fromAddress = trade.FromAddress
	}
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `INSERT OR IGNORE INTO cregis_callback_events
      (id, event_type, cregis_cid, status, payload_sha256, received_at) VALUES (?, 'deposit', ?, ?, ?, ?)`, Params: []any{callbackID, cregisCID, status, hash, now}},
		d1.Statement{SQL: `INSERT OR IGNORE INTO cregis_deposits
		(id, tenant_id, wallet_id, cregis_cid, chain_id, token_id, currency, address, from_address,
		 amount_text, amount_minor, status, txid, block_height, block_time, received_at, raw_sha256)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, Params: []any{randomID("deposit"), app.tenantID, walletID, cregisCID,
			usdtTRC20ChainID, usdtTRC20TokenID, usdtTRC20Currency, address,
			nullIfEmpty(fromAddress), amountText, amountMinor, finalStatus, nullIfEmpty(txid), nullIfEmpty(text(payload["block_height"])),
			nullIfEmpty(text(payload["block_time"])), now, hash}},
		d1.Statement{SQL: `INSERT OR IGNORE INTO cregis_deposit_accounting
		(deposit_id, tenant_id, customer_id, status, enqueue_source, enqueued_by,
		 attempt_count, next_attempt_at, created_at, updated_at)
		SELECT d.id, d.tenant_id, w.customer_id, 'pending', 'callback', 'cregis_callback', 0, ?, ?, ?
		FROM cregis_deposits d
		JOIN cregis_wallets w ON w.id=d.wallet_id AND w.tenant_id=d.tenant_id
		WHERE d.tenant_id=? AND d.cregis_cid=? AND d.status='completed' AND d.txid IS NOT NULL`,
			Params: []any{now, now, now, app.tenantID, cregisCID}},
	)
	if err != nil {
		app.logger.Error("store Cregis deposit callback failed", "error", err)
		http.Error(w, "retry", http.StatusServiceUnavailable)
		return
	}
	if len(results) != 3 {
		app.logger.Error("store Cregis deposit callback returned invalid result count")
		http.Error(w, "retry", http.StatusServiceUnavailable)
		return
	}
	if resultChanges(results[1:2]) != 1 {
		rows, lookupErr := app.db.Query(r.Context(), `SELECT wallet_id, chain_id, token_id, currency, address, from_address,
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
		existingSource := text(existing["from_address"])
		if existingSource != "" && existingSource != fromAddress {
			http.Error(w, "deposit source conflict", http.StatusConflict)
			return
		}
		if existingSource == "" && fromAddress != "" {
			updated, updateErr := app.db.Batch(r.Context(), d1.Statement{SQL: `UPDATE cregis_deposits SET from_address=?
      WHERE tenant_id=? AND cregis_cid=? AND from_address IS NULL`, Params: []any{fromAddress, app.tenantID, cregisCID}})
			if updateErr != nil || resultChanges(updated) != 1 {
				app.logger.Error("backfill Cregis deposit source address failed", "cid", cregisCID, "error", updateErr)
				http.Error(w, "retry", http.StatusServiceUnavailable)
				return
			}
		}
	}
	if finalStatus == "completed" {
		accountingRows, accountingErr := app.db.Query(r.Context(), `SELECT a.status
		FROM cregis_deposit_accounting a
		JOIN cregis_deposits d ON d.id=a.deposit_id AND d.tenant_id=a.tenant_id
		WHERE a.tenant_id=? AND d.cregis_cid=? AND a.customer_id=(
		  SELECT customer_id FROM cregis_wallets WHERE id=d.wallet_id AND tenant_id=d.tenant_id
		)`, app.tenantID, cregisCID)
		if accountingErr != nil || len(accountingRows) != 1 {
			app.logger.Error("verify Cregis deposit accounting intent failed", "cid", cregisCID, "error", accountingErr)
			http.Error(w, "retry", http.StatusServiceUnavailable)
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
	txid := text(payload["txid"])
	if cregisCID == "" || thirdPartyID == "" || text(payload["chain_id"]) != usdtTRC20ChainID ||
		text(payload["token_id"]) != usdtTRC20TokenID || (target == "completed" && !tronTxID.MatchString(txid)) {
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
		d1.Statement{SQL: `UPDATE cregis_withdrawals
		SET cregis_cid=?, submitted_at=COALESCE(submitted_at, ?), updated_at=?
		WHERE tenant_id=? AND third_party_id=?
		  AND status IN ('submitted_to_cregis', 'executing', 'exception')
		  AND (cregis_cid IS NULL OR cregis_cid=?)`, Params: []any{
			cregisCID, now, now, app.tenantID, thirdPartyID, cregisCID,
		}},
		d1.Statement{SQL: `WITH terminal AS (
		UPDATE cregis_withdrawals
		SET status=?, cregis_cid=?, txid=?, block_height=?, block_time=?, completed_at=?, updated_at=?
		WHERE tenant_id=? AND third_party_id=?
		  AND status IN ('submitted_to_cregis', 'executing', 'exception')
		  AND cregis_cid=?
		  AND EXISTS (
		    SELECT 1 FROM cregis_withdrawal_accounting a
		    WHERE a.withdrawal_id=cregis_withdrawals.id
		      AND a.tenant_id=cregis_withdrawals.tenant_id AND a.status='approved'
		  )
		RETURNING id, tenant_id
	)
	UPDATE cregis_withdrawal_accounting a
	SET status=CASE WHEN ?='completed' THEN 'pending_settlement' ELSE 'pending_release' END,
	    next_attempt_at=NOW(), locked_at=NULL, updated_at=NOW()
	FROM terminal
	WHERE a.withdrawal_id=terminal.id AND a.tenant_id=terminal.tenant_id AND a.status='approved'
	RETURNING a.withdrawal_id`, Params: []any{
			target, cregisCID, nullIfEmpty(txid), nullIfEmpty(text(payload["block_height"])), nullIfEmpty(text(payload["block_time"])),
			completedAt, now, app.tenantID, thirdPartyID, cregisCID, target,
		}},
	)
	if err != nil {
		app.logger.Error("store Cregis payout callback failed", "error", err)
		http.Error(w, "retry", http.StatusServiceUnavailable)
		return
	}
	if len(results) != 3 || len(results[2].Results) != 1 {
		rows, lookupErr := app.db.Query(r.Context(), `SELECT x.status, x.cregis_cid, COALESCE(a.status, 'missing') AS accounting_status
		FROM cregis_withdrawals x
		LEFT JOIN cregis_withdrawal_accounting a ON a.withdrawal_id=x.id AND a.tenant_id=x.tenant_id
		WHERE x.tenant_id=? AND x.third_party_id=?`, app.tenantID, thirdPartyID)
		if lookupErr != nil {
			app.logger.Error("verify Cregis payout callback state failed", "error", lookupErr)
			http.Error(w, "retry", http.StatusServiceUnavailable)
			return
		}
		accountingStatus := ""
		if len(rows) == 1 {
			accountingStatus = text(rows[0]["accounting_status"])
		}
		settlementQueued := target == "completed" && (accountingStatus == "pending_settlement" || accountingStatus == "settling" || accountingStatus == "settled")
		releaseQueued := target != "completed" && (accountingStatus == "pending_release" || accountingStatus == "releasing" || accountingStatus == "released")
		if len(rows) == 1 && text(rows[0]["status"]) == target && text(rows[0]["cregis_cid"]) == cregisCID && (settlementQueued || releaseQueued) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			_, _ = w.Write([]byte("success"))
			return
		}
		providerRejectionRecorded := len(rows) == 1 && target == "rejected" && accountingStatus == "missing" &&
			(text(rows[0]["status"]) == "exception" || text(rows[0]["status"]) == "submitted_to_cregis") &&
			text(rows[0]["cregis_cid"]) == cregisCID
		if providerRejectionRecorded {
			app.logger.Warn("Cregis rejection recorded for historical withdrawal pending reconciliation",
				"third_party_id", thirdPartyID, "cregis_cid", cregisCID)
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
	minor, ok := parseUSDTMicroUnitsAllowZero(value)
	return minor, ok && minor > 0
}

func parseUSDTMicroUnitsAllowZero(value string) (int64, bool) {
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
	return minor, minor >= 0
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
