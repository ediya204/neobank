-- Preserve the migration 0004 compatibility rule for historical fund records:
-- pre-multichain USDT activity belongs to the TRON balance bucket. Only rows
-- whose asset/type/decimals already form a valid USDT record are backfilled.
DROP TRIGGER IF EXISTS fund_transactions_v1_integrity_insert;
DROP TRIGGER IF EXISTS fund_transactions_v1_integrity_update;

UPDATE fund_transactions
SET network = 'TRON'
WHERE type IN ('usdt_deposit', 'usdt_withdrawal')
  AND asset = 'USDT'
  AND asset_decimals = 6
  AND COALESCE(trim(network), '') = '';

CREATE TRIGGER fund_transactions_v1_integrity_insert
BEFORE INSERT ON fund_transactions
FOR EACH ROW
WHEN
  NOT (
    (
      NEW.type IN ('fiat_deposit', 'fiat_withdrawal')
      AND NEW.asset = 'USD'
      AND NEW.asset_decimals = 2
      AND COALESCE(trim(NEW.network), '') = ''
    )
    OR
    (
      NEW.type IN ('usdt_deposit', 'usdt_withdrawal')
      AND NEW.asset = 'USDT'
      AND NEW.asset_decimals = 6
      AND COALESCE(upper(trim(NEW.network)), '') IN ('TRON', 'ETHEREUM', 'SOLANA', 'BSC')
    )
  )
  OR (
    NEW.type = 'fiat_withdrawal'
    AND (
      NEW.beneficiary_name IS NULL OR trim(NEW.beneficiary_name) = ''
      OR NEW.beneficiary_address IS NULL OR trim(NEW.beneficiary_address) = ''
      OR NEW.bank_name IS NULL OR trim(NEW.bank_name) = ''
      OR NEW.bank_account_number IS NULL OR trim(NEW.bank_account_number) = ''
      OR NEW.swift_bic IS NULL OR trim(NEW.swift_bic) = ''
    )
  )
  OR (
    NEW.type = 'usdt_withdrawal'
    AND (NEW.destination IS NULL OR trim(NEW.destination) = '')
  )
  OR (
    NEW.type IN ('fiat_deposit', 'usdt_deposit')
    AND NEW.fee_amount_minor <> 0
  )
  OR (
    NEW.type IN ('fiat_withdrawal', 'usdt_withdrawal')
    AND (
      NEW.fee_amount_minor < 0
      OR NEW.fee_amount_minor >= NEW.amount_minor
    )
  )
  OR NEW.idempotency_key IS NULL
  OR trim(NEW.idempotency_key) = ''
  OR NEW.request_fingerprint IS NULL
  OR length(NEW.request_fingerprint) <> 64
  OR lower(NEW.request_fingerprint) GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'fund_transaction_v1_integrity');
END;

CREATE TRIGGER fund_transactions_v1_integrity_update
BEFORE UPDATE OF
  type, asset, asset_decimals, network, destination,
  beneficiary_name, beneficiary_address, bank_name,
  bank_account_number, swift_bic, amount_minor, fee_amount_minor
ON fund_transactions
FOR EACH ROW
WHEN
  NOT (
    (
      NEW.type IN ('fiat_deposit', 'fiat_withdrawal')
      AND NEW.asset = 'USD'
      AND NEW.asset_decimals = 2
      AND COALESCE(trim(NEW.network), '') = ''
    )
    OR
    (
      NEW.type IN ('usdt_deposit', 'usdt_withdrawal')
      AND NEW.asset = 'USDT'
      AND NEW.asset_decimals = 6
      AND COALESCE(upper(trim(NEW.network)), '') IN ('TRON', 'ETHEREUM', 'SOLANA', 'BSC')
    )
  )
  OR (
    NEW.type = 'fiat_withdrawal'
    AND (
      NEW.beneficiary_name IS NULL OR trim(NEW.beneficiary_name) = ''
      OR NEW.beneficiary_address IS NULL OR trim(NEW.beneficiary_address) = ''
      OR NEW.bank_name IS NULL OR trim(NEW.bank_name) = ''
      OR NEW.bank_account_number IS NULL OR trim(NEW.bank_account_number) = ''
      OR NEW.swift_bic IS NULL OR trim(NEW.swift_bic) = ''
    )
  )
  OR (
    NEW.type = 'usdt_withdrawal'
    AND (NEW.destination IS NULL OR trim(NEW.destination) = '')
  )
  OR (
    NEW.type IN ('fiat_deposit', 'usdt_deposit')
    AND NEW.fee_amount_minor <> 0
  )
  OR (
    NEW.type IN ('fiat_withdrawal', 'usdt_withdrawal')
    AND (
      NEW.fee_amount_minor < 0
      OR NEW.fee_amount_minor >= NEW.amount_minor
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'fund_transaction_v1_integrity');
END;

-- Existing malformed pending rows are never guessed or silently repaired. They
-- may be cancelled/rejected for operator review, but cannot enter processing or
-- write a ledger entry.
CREATE TRIGGER fund_transactions_v1_status_integrity
BEFORE UPDATE OF status ON fund_transactions
FOR EACH ROW
WHEN NEW.status IN ('processing', 'completed')
  AND (
    NEW.idempotency_key IS NULL
    OR trim(NEW.idempotency_key) = ''
    OR NEW.request_fingerprint IS NULL
    OR length(NEW.request_fingerprint) <> 64
    OR lower(NEW.request_fingerprint) GLOB '*[^0-9a-f]*'
    OR
    NOT (
      (
        NEW.type IN ('fiat_deposit', 'fiat_withdrawal')
        AND NEW.asset = 'USD'
        AND NEW.asset_decimals = 2
        AND COALESCE(trim(NEW.network), '') = ''
      )
      OR
      (
        NEW.type IN ('usdt_deposit', 'usdt_withdrawal')
        AND NEW.asset = 'USDT'
        AND NEW.asset_decimals = 6
        AND COALESCE(upper(trim(NEW.network)), '') IN ('TRON', 'ETHEREUM', 'SOLANA', 'BSC')
      )
    )
    OR (
      NEW.type = 'fiat_withdrawal'
      AND (
        NEW.beneficiary_name IS NULL OR trim(NEW.beneficiary_name) = ''
        OR NEW.beneficiary_address IS NULL OR trim(NEW.beneficiary_address) = ''
        OR NEW.bank_name IS NULL OR trim(NEW.bank_name) = ''
        OR NEW.bank_account_number IS NULL OR trim(NEW.bank_account_number) = ''
        OR NEW.swift_bic IS NULL OR trim(NEW.swift_bic) = ''
      )
    )
    OR (
      NEW.type = 'usdt_withdrawal'
      AND (NEW.destination IS NULL OR trim(NEW.destination) = '')
    )
    OR (
      NEW.type IN ('fiat_deposit', 'usdt_deposit')
      AND NEW.fee_amount_minor <> 0
    )
    OR (
      NEW.type IN ('fiat_withdrawal', 'usdt_withdrawal')
      AND (
        NEW.fee_amount_minor < 0
        OR NEW.fee_amount_minor >= NEW.amount_minor
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'fund_transaction_legacy_integrity_review');
END;

CREATE TRIGGER fund_transactions_terminal_status
BEFORE UPDATE OF status ON fund_transactions
FOR EACH ROW
WHEN OLD.status IN ('completed', 'rejected', 'cancelled')
  AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'fund_transaction_terminal_status');
END;

CREATE TRIGGER otc_orders_v1_status_integrity
BEFORE UPDATE OF status ON otc_orders
FOR EACH ROW
WHEN NEW.status IN ('processing', 'completed')
  AND (
    NEW.idempotency_key IS NULL
    OR trim(NEW.idempotency_key) = ''
    OR NEW.request_fingerprint IS NULL
    OR length(NEW.request_fingerprint) <> 64
    OR lower(NEW.request_fingerprint) GLOB '*[^0-9a-f]*'
    OR
    NOT (
      (
        NEW.sell_asset = 'USD'
        AND NEW.sell_decimals = 2
        AND COALESCE(trim(NEW.sell_network), '') = ''
        AND NEW.buy_asset = 'USDT'
        AND NEW.buy_decimals = 6
        AND COALESCE(upper(trim(NEW.buy_network)), '') IN ('TRON', 'ETHEREUM', 'SOLANA', 'BSC')
      )
      OR
      (
        NEW.sell_asset = 'USDT'
        AND NEW.sell_decimals = 6
        AND COALESCE(upper(trim(NEW.sell_network)), '') IN ('TRON', 'ETHEREUM', 'SOLANA', 'BSC')
        AND NEW.buy_asset = 'USD'
        AND NEW.buy_decimals = 2
        AND COALESCE(trim(NEW.buy_network), '') = ''
      )
    )
    OR trim(NEW.exchange_rate) = ''
    OR CAST(NEW.exchange_rate AS REAL) <= 0
    OR NEW.fee_bps <> 50
    OR NEW.fee_amount_minor < 0
    OR NEW.fee_amount_minor >= NEW.buy_amount_minor
  )
BEGIN
  SELECT RAISE(ABORT, 'otc_order_legacy_integrity_review');
END;

CREATE TRIGGER otc_orders_terminal_status
BEFORE UPDATE OF status ON otc_orders
FOR EACH ROW
WHEN OLD.status IN ('completed', 'rejected', 'cancelled')
  AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'otc_order_terminal_status');
END;
