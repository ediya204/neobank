package main

import (
	"context"
	"errors"
	"strconv"
)

type withdrawalFeeRule struct {
	ID          string
	AmountMinor int64
	Decimals    int
	Version     int64
}

var errWithdrawalFeeMissing = errors.New("withdrawal fee configuration missing")

func (app *application) activeWithdrawalFee(
	ctx context.Context,
	assetClass, currency, method, channelCode, network string,
) (withdrawalFeeRule, error) {
	rows, err := app.db.Query(ctx, `SELECT id, CAST(fee_amount_minor AS TEXT) AS fee_amount_minor,
    fee_decimals, CAST(version AS TEXT) AS version
    FROM withdrawal_fee_rules
    WHERE scope_id=? AND asset_class=? AND currency=? AND method=?
      AND channel_code=? AND network=? AND active=TRUE`,
		app.tenantID, assetClass, currency, method, channelCode, network)
	if err != nil {
		return withdrawalFeeRule{}, err
	}
	if len(rows) != 1 {
		return withdrawalFeeRule{}, errWithdrawalFeeMissing
	}
	amountMinor, amountErr := strconv.ParseInt(text(rows[0]["fee_amount_minor"]), 10, 64)
	decimals, decimalsErr := strconv.Atoi(text(rows[0]["fee_decimals"]))
	version, versionErr := strconv.ParseInt(text(rows[0]["version"]), 10, 64)
	if amountErr != nil || decimalsErr != nil || versionErr != nil || amountMinor < 0 || decimals < 0 || decimals > 8 || version < 1 {
		return withdrawalFeeRule{}, errors.New("invalid withdrawal fee configuration")
	}
	return withdrawalFeeRule{
		ID: text(rows[0]["id"]), AmountMinor: amountMinor, Decimals: decimals, Version: version,
	}, nil
}
