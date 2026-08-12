-- Canonicalize accounting buckets before enforcing exact values. Historical
-- malformed rows are not otherwise guessed or rewritten; they may still be
-- rejected/cancelled for operator review.
DROP TRIGGER IF EXISTS fund_transactions_v1_integrity_insert;
DROP TRIGGER IF EXISTS fund_transactions_v1_integrity_update;
DROP TRIGGER IF EXISTS fund_transactions_v1_status_integrity;
DROP TRIGGER IF EXISTS fund_transactions_terminal_status;
DROP TRIGGER IF EXISTS otc_orders_v1_integrity_insert;
DROP TRIGGER IF EXISTS otc_orders_v1_integrity_update;
DROP TRIGGER IF EXISTS otc_orders_v1_status_integrity;
DROP TRIGGER IF EXISTS otc_orders_terminal_status;

UPDATE fund_transactions
SET network = NULL
WHERE type IN ('fiat_deposit', 'fiat_withdrawal');

UPDATE fund_transactions
SET network = upper(trim(COALESCE(network, '')))
WHERE type IN ('usdt_deposit', 'usdt_withdrawal');

UPDATE otc_orders
SET sell_network = CASE
      WHEN sell_asset = 'USD' THEN ''
      ELSE upper(trim(COALESCE(sell_network, '')))
    END,
    buy_network = CASE
      WHEN buy_asset = 'USD' THEN ''
      ELSE upper(trim(COALESCE(buy_network, '')))
    END;

UPDATE ledger_entries
SET network = CASE
      WHEN asset = 'USD' THEN ''
      ELSE upper(trim(COALESCE(network, '')))
    END;

-- New fund transactions must be complete, canonical, and independently
-- replay-safe. Admin-recorded deposits require an external bank/chain
-- reference.
CREATE TRIGGER fund_transactions_v1_integrity_insert
BEFORE INSERT ON fund_transactions
FOR EACH ROW
WHEN
  NOT (
    (
      NEW.type IN ('fiat_deposit', 'fiat_withdrawal')
      AND NEW.asset = 'USD'
      AND NEW.asset_decimals = 2
      AND COALESCE(NEW.network, '') = ''
    )
    OR
    (
      NEW.type IN ('usdt_deposit', 'usdt_withdrawal')
      AND NEW.asset = 'USDT'
      AND NEW.asset_decimals = 6
      AND NEW.network IN ('TRON', 'ETHEREUM', 'SOLANA', 'BSC')
    )
  )
  OR (
    NEW.type IN ('fiat_deposit', 'usdt_deposit')
    AND (
      NEW.external_reference IS NULL
      OR trim(NEW.external_reference) = ''
      OR NEW.fee_amount_minor <> 0
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
  application_id, external_reference, idempotency_key, request_fingerprint,
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
      AND COALESCE(NEW.network, '') = ''
    )
    OR
    (
      NEW.type IN ('usdt_deposit', 'usdt_withdrawal')
      AND NEW.asset = 'USDT'
      AND NEW.asset_decimals = 6
      AND NEW.network IN ('TRON', 'ETHEREUM', 'SOLANA', 'BSC')
    )
  )
  OR (
    NEW.type IN ('fiat_deposit', 'usdt_deposit')
    AND (
      NEW.external_reference IS NULL
      OR trim(NEW.external_reference) = ''
      OR NEW.fee_amount_minor <> 0
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

-- A non-unique lookup index remains compatible with historical duplicates.
-- New references are unique across all customer accounts for the same
-- transaction type and network. Fiat and hex-chain references are compared
-- case-insensitively; Solana signatures retain their case-sensitive base58
-- identity.
CREATE INDEX IF NOT EXISTS idx_fund_transactions_deposit_reference
  ON fund_transactions(type, network, external_reference);

CREATE TRIGGER fund_transactions_deposit_reference_unique_insert
BEFORE INSERT ON fund_transactions
FOR EACH ROW
WHEN NEW.type IN ('fiat_deposit', 'usdt_deposit')
  AND EXISTS (
    SELECT 1
    FROM fund_transactions AS existing
    WHERE existing.id <> NEW.id
      AND existing.type = NEW.type
      AND COALESCE(existing.network, '') = COALESCE(NEW.network, '')
      AND (
        CASE
          WHEN existing.type = 'usdt_deposit'
            AND existing.network = 'SOLANA'
            THEN trim(existing.external_reference)
          ELSE lower(trim(existing.external_reference))
        END
      ) = (
        CASE
          WHEN NEW.type = 'usdt_deposit' AND NEW.network = 'SOLANA'
            THEN trim(NEW.external_reference)
          ELSE lower(trim(NEW.external_reference))
        END
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'duplicate_deposit_reference');
END;

CREATE TRIGGER fund_transactions_deposit_reference_unique_update
BEFORE UPDATE OF application_id, type, network, external_reference
ON fund_transactions
FOR EACH ROW
WHEN NEW.type IN ('fiat_deposit', 'usdt_deposit')
  AND EXISTS (
    SELECT 1
    FROM fund_transactions AS existing
    WHERE existing.id <> NEW.id
      AND existing.type = NEW.type
      AND COALESCE(existing.network, '') = COALESCE(NEW.network, '')
      AND (
        CASE
          WHEN existing.type = 'usdt_deposit'
            AND existing.network = 'SOLANA'
            THEN trim(existing.external_reference)
          ELSE lower(trim(existing.external_reference))
        END
      ) = (
        CASE
          WHEN NEW.type = 'usdt_deposit' AND NEW.network = 'SOLANA'
            THEN trim(NEW.external_reference)
          ELSE lower(trim(NEW.external_reference))
        END
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'duplicate_deposit_reference');
END;

-- Existing duplicate or otherwise malformed pending records can be
-- rejected/cancelled, but cannot progress into an accounting state.
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
    OR NOT (
      (
        NEW.type IN ('fiat_deposit', 'fiat_withdrawal')
        AND NEW.asset = 'USD'
        AND NEW.asset_decimals = 2
        AND COALESCE(NEW.network, '') = ''
      )
      OR
      (
        NEW.type IN ('usdt_deposit', 'usdt_withdrawal')
        AND NEW.asset = 'USDT'
        AND NEW.asset_decimals = 6
        AND NEW.network IN ('TRON', 'ETHEREUM', 'SOLANA', 'BSC')
      )
    )
    OR (
      NEW.type IN ('fiat_deposit', 'usdt_deposit')
      AND (
        NEW.external_reference IS NULL
        OR trim(NEW.external_reference) = ''
        OR NEW.fee_amount_minor <> 0
        OR EXISTS (
          SELECT 1
          FROM fund_transactions AS existing
          WHERE existing.id <> NEW.id
            AND existing.type = NEW.type
            AND COALESCE(existing.network, '') = COALESCE(NEW.network, '')
            AND (
              CASE
                WHEN existing.type = 'usdt_deposit'
                  AND existing.network = 'SOLANA'
                  THEN trim(existing.external_reference)
                ELSE lower(trim(existing.external_reference))
              END
            ) = (
              CASE
                WHEN NEW.type = 'usdt_deposit' AND NEW.network = 'SOLANA'
                  THEN trim(NEW.external_reference)
                ELSE lower(trim(NEW.external_reference))
              END
            )
        )
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

-- OTC is limited to USD/USDT. USDT is always tied to one exact supported
-- chain. fee_amount_minor is rounded half-up to the buy asset's smallest unit:
-- round(buy_amount_minor * 0.5%) = floor(buy_amount_minor / 200 + 0.5).
CREATE TRIGGER otc_orders_v1_integrity_insert
BEFORE INSERT ON otc_orders
FOR EACH ROW
WHEN
  NOT (
    (
      NEW.sell_asset = 'USD'
      AND NEW.sell_decimals = 2
      AND NEW.sell_network = ''
      AND NEW.buy_asset = 'USDT'
      AND NEW.buy_decimals = 6
      AND NEW.buy_network IN ('TRON', 'ETHEREUM', 'SOLANA', 'BSC')
    )
    OR
    (
      NEW.sell_asset = 'USDT'
      AND NEW.sell_decimals = 6
      AND NEW.sell_network IN ('TRON', 'ETHEREUM', 'SOLANA', 'BSC')
      AND NEW.buy_asset = 'USD'
      AND NEW.buy_decimals = 2
      AND NEW.buy_network = ''
    )
  )
  OR trim(NEW.exchange_rate) = ''
  OR CAST(NEW.exchange_rate AS REAL) <= 0
  OR NEW.fee_bps <> 50
  OR NEW.fee_amount_minor <> (
    CAST(NEW.buy_amount_minor / 200 AS INTEGER)
    + CASE WHEN NEW.buy_amount_minor % 200 >= 100 THEN 1 ELSE 0 END
  )
  OR NEW.fee_amount_minor < 0
  OR NEW.fee_amount_minor >= NEW.buy_amount_minor
  OR NEW.idempotency_key IS NULL
  OR trim(NEW.idempotency_key) = ''
  OR NEW.request_fingerprint IS NULL
  OR length(NEW.request_fingerprint) <> 64
  OR lower(NEW.request_fingerprint) GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'otc_order_v1_integrity');
END;

CREATE TRIGGER otc_orders_v1_integrity_update
BEFORE UPDATE OF
  application_id, idempotency_key, request_fingerprint,
  sell_asset, sell_amount_minor, sell_decimals, sell_network,
  buy_asset, buy_amount_minor, buy_decimals, buy_network,
  exchange_rate, fee_bps, fee_amount_minor
ON otc_orders
FOR EACH ROW
WHEN
  NOT (
    (
      NEW.sell_asset = 'USD'
      AND NEW.sell_decimals = 2
      AND NEW.sell_network = ''
      AND NEW.buy_asset = 'USDT'
      AND NEW.buy_decimals = 6
      AND NEW.buy_network IN ('TRON', 'ETHEREUM', 'SOLANA', 'BSC')
    )
    OR
    (
      NEW.sell_asset = 'USDT'
      AND NEW.sell_decimals = 6
      AND NEW.sell_network IN ('TRON', 'ETHEREUM', 'SOLANA', 'BSC')
      AND NEW.buy_asset = 'USD'
      AND NEW.buy_decimals = 2
      AND NEW.buy_network = ''
    )
  )
  OR trim(NEW.exchange_rate) = ''
  OR CAST(NEW.exchange_rate AS REAL) <= 0
  OR NEW.fee_bps <> 50
  OR NEW.fee_amount_minor <> (
    CAST(NEW.buy_amount_minor / 200 AS INTEGER)
    + CASE WHEN NEW.buy_amount_minor % 200 >= 100 THEN 1 ELSE 0 END
  )
  OR NEW.fee_amount_minor < 0
  OR NEW.fee_amount_minor >= NEW.buy_amount_minor
  OR NEW.idempotency_key IS NULL
  OR trim(NEW.idempotency_key) = ''
  OR NEW.request_fingerprint IS NULL
  OR length(NEW.request_fingerprint) <> 64
  OR lower(NEW.request_fingerprint) GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'otc_order_v1_integrity');
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
    OR NOT (
      (
        NEW.sell_asset = 'USD'
        AND NEW.sell_decimals = 2
        AND NEW.sell_network = ''
        AND NEW.buy_asset = 'USDT'
        AND NEW.buy_decimals = 6
        AND NEW.buy_network IN ('TRON', 'ETHEREUM', 'SOLANA', 'BSC')
      )
      OR
      (
        NEW.sell_asset = 'USDT'
        AND NEW.sell_decimals = 6
        AND NEW.sell_network IN ('TRON', 'ETHEREUM', 'SOLANA', 'BSC')
        AND NEW.buy_asset = 'USD'
        AND NEW.buy_decimals = 2
        AND NEW.buy_network = ''
      )
    )
    OR trim(NEW.exchange_rate) = ''
    OR CAST(NEW.exchange_rate AS REAL) <= 0
    OR NEW.fee_bps <> 50
    OR NEW.fee_amount_minor <> (
      CAST(NEW.buy_amount_minor / 200 AS INTEGER)
      + CASE WHEN NEW.buy_amount_minor % 200 >= 100 THEN 1 ELSE 0 END
    )
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

-- Every new ledger entry must match a valid bucket, the source application,
-- source asset/network/decimals, exact amount, and expected debit/credit
-- direction. Completed sources are accepted for controlled recovery of a
-- missing ledger row.
CREATE TRIGGER ledger_entries_accounting_integrity_insert
BEFORE INSERT ON ledger_entries
FOR EACH ROW
WHEN
  NEW.amount_minor = 0
  OR trim(NEW.entry_type) = ''
  OR NOT (
    (
      NEW.asset = 'USD'
      AND NEW.asset_decimals = 2
      AND NEW.network = ''
    )
    OR
    (
      NEW.asset = 'USDT'
      AND NEW.asset_decimals = 6
      AND NEW.network IN ('TRON', 'ETHEREUM', 'SOLANA', 'BSC')
    )
  )
  OR NOT (
    (
      NEW.source_type = 'fund_transaction'
      AND EXISTS (
        SELECT 1
        FROM fund_transactions AS source
        WHERE source.id = NEW.source_id
          AND source.application_id = NEW.application_id
          AND source.asset = NEW.asset
          AND source.asset_decimals = NEW.asset_decimals
          AND COALESCE(source.network, '') = NEW.network
          AND source.status IN ('submitted', 'processing', 'completed')
          AND NEW.entry_type = source.type
          AND (
            (
              source.type IN ('fiat_deposit', 'usdt_deposit')
              AND NEW.amount_minor = source.amount_minor
            )
            OR
            (
              source.type IN ('fiat_withdrawal', 'usdt_withdrawal')
              AND NEW.amount_minor = -source.amount_minor
            )
          )
      )
    )
    OR
    (
      NEW.source_type = 'otc_order'
      AND NEW.entry_type = 'otc_sell'
      AND EXISTS (
        SELECT 1
        FROM otc_orders AS source
        WHERE source.id = NEW.source_id
          AND source.application_id = NEW.application_id
          AND source.status IN ('submitted', 'processing', 'completed')
          AND source.sell_asset = NEW.asset
          AND source.sell_decimals = NEW.asset_decimals
          AND source.sell_network = NEW.network
          AND NEW.amount_minor = -source.sell_amount_minor
          AND source.fee_bps = 50
          AND source.fee_amount_minor = (
            CAST(source.buy_amount_minor / 200 AS INTEGER)
            + CASE
                WHEN source.buy_amount_minor % 200 >= 100 THEN 1
                ELSE 0
              END
          )
      )
    )
    OR
    (
      NEW.source_type = 'otc_order'
      AND NEW.entry_type = 'otc_buy_net'
      AND EXISTS (
        SELECT 1
        FROM otc_orders AS source
        WHERE source.id = NEW.source_id
          AND source.application_id = NEW.application_id
          AND source.status IN ('submitted', 'processing', 'completed')
          AND source.buy_asset = NEW.asset
          AND source.buy_decimals = NEW.asset_decimals
          AND source.buy_network = NEW.network
          AND NEW.amount_minor =
            source.buy_amount_minor - source.fee_amount_minor
          AND source.fee_bps = 50
          AND source.fee_amount_minor = (
            CAST(source.buy_amount_minor / 200 AS INTEGER)
            + CASE
                WHEN source.buy_amount_minor % 200 >= 100 THEN 1
                ELSE 0
              END
          )
          AND EXISTS (
            SELECT 1
            FROM ledger_entries AS sell_entry
            WHERE sell_entry.source_type = 'otc_order'
              AND sell_entry.source_id = source.id
              AND sell_entry.application_id = source.application_id
              AND sell_entry.asset = source.sell_asset
              AND sell_entry.network = source.sell_network
              AND sell_entry.entry_type = 'otc_sell'
              AND sell_entry.amount_minor = -source.sell_amount_minor
          )
      )
    )
    OR
    (
      NEW.source_type = 'adjustment'
      AND (
        (NEW.entry_type = 'adjustment_credit' AND NEW.amount_minor > 0)
        OR
        (NEW.entry_type = 'adjustment_debit' AND NEW.amount_minor < 0)
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'ledger_entry_accounting_integrity');
END;

CREATE TRIGGER ledger_entries_immutable_update
BEFORE UPDATE ON ledger_entries
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'ledger_entry_immutable');
END;

CREATE TRIGGER ledger_entries_immutable_delete
BEFORE DELETE ON ledger_entries
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'ledger_entry_immutable');
END;
