ALTER TABLE fund_transactions
  ADD COLUMN settlement_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (settlement_status IN ('pending', 'cleared', 'exception'));

ALTER TABLE fund_transactions
  ADD COLUMN conversion_otc_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_transactions_conversion_otc
  ON fund_transactions(conversion_otc_id)
  WHERE conversion_otc_id IS NOT NULL;

ALTER TABLE otc_orders
  ADD COLUMN pricing_model TEXT NOT NULL DEFAULT 'standard_fee'
    CHECK (pricing_model IN ('standard_fee', 'net_rate'));

ALTER TABLE otc_orders
  ADD COLUMN source_fund_transaction_id TEXT;

-- The legacy table-level CHECK keeps `fee_bps` at 50. This authoritative
-- snapshot records the fee that was actually applied to the order.
ALTER TABLE otc_orders
  ADD COLUMN applied_fee_bps INTEGER NOT NULL DEFAULT 50
    CHECK (applied_fee_bps IN (0, 50));

CREATE UNIQUE INDEX IF NOT EXISTS idx_otc_orders_source_fund
  ON otc_orders(source_fund_transaction_id)
  WHERE source_fund_transaction_id IS NOT NULL;

DROP TRIGGER IF EXISTS otc_orders_v1_integrity_insert;
DROP TRIGGER IF EXISTS otc_orders_v1_integrity_update;
DROP TRIGGER IF EXISTS otc_orders_v1_status_integrity;

CREATE TRIGGER otc_orders_v1_integrity_insert
BEFORE INSERT ON otc_orders
FOR EACH ROW
WHEN
  NOT (
    (NEW.sell_asset = 'USD' AND NEW.sell_decimals = 2 AND NEW.sell_network = ''
      AND NEW.buy_asset = 'USDT' AND NEW.buy_decimals = 6
      AND NEW.buy_network IN ('TRON', 'ETHEREUM', 'SOLANA', 'BSC'))
    OR
    (NEW.sell_asset = 'USDT' AND NEW.sell_decimals = 6
      AND NEW.sell_network IN ('TRON', 'ETHEREUM', 'SOLANA', 'BSC')
      AND NEW.buy_asset = 'USD' AND NEW.buy_decimals = 2 AND NEW.buy_network = '')
  )
  OR trim(NEW.exchange_rate) = ''
  OR CAST(NEW.exchange_rate AS REAL) <= 0
  OR NEW.fee_bps <> 50
  OR (
    NEW.pricing_model = 'standard_fee'
    AND (
      NEW.applied_fee_bps <> 50
      OR NEW.fee_amount_minor <> (
        CAST(NEW.buy_amount_minor / 200 AS INTEGER)
        + CASE WHEN NEW.buy_amount_minor % 200 >= 100 THEN 1 ELSE 0 END
      )
    )
  )
  OR (
    NEW.pricing_model = 'net_rate'
    AND (
      NEW.fee_amount_minor <> 0
      OR NEW.applied_fee_bps <> 0
      OR NEW.source_fund_transaction_id IS NULL
      OR NEW.sell_asset <> 'USD'
      OR NEW.buy_asset <> 'USDT'
      OR NEW.buy_network <> 'TRON'
    )
  )
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
  exchange_rate, fee_bps, fee_amount_minor, pricing_model,
  source_fund_transaction_id, applied_fee_bps
ON otc_orders
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'otc_order_accounting_fields_immutable');
END;

CREATE TABLE IF NOT EXISTS conversion_settings (
  id TEXT PRIMARY KEY CHECK (id = 'usd_usdt_tron'),
  exchange_rate TEXT NOT NULL CHECK (
    length(exchange_rate) BETWEEN 1 AND 32
    AND CAST(exchange_rate AS REAL) > 0
  ),
  version INTEGER NOT NULL CHECK (version > 0),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversion_setting_versions (
  id TEXT PRIMARY KEY,
  setting_id TEXT NOT NULL CHECK (setting_id = 'usd_usdt_tron'),
  exchange_rate TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  changed_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(setting_id, version)
);

INSERT OR IGNORE INTO conversion_settings (
  id, exchange_rate, version, updated_by, created_at, updated_at
) VALUES (
  'usd_usdt_tron', '0.995', 1, 'system',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT OR IGNORE INTO conversion_setting_versions (
  id, setting_id, exchange_rate, version, changed_by, created_at
) VALUES (
  'rate_usd_usdt_tron_v1', 'usd_usdt_tron', '0.995', 1, 'system',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

CREATE TABLE IF NOT EXISTS sweep_settings (
  id TEXT PRIMARY KEY CHECK (id = 'ethan_tron_address'),
  tron_address TEXT,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO sweep_settings (
  id, tron_address, version, updated_by, created_at, updated_at
) VALUES (
  'ethan_tron_address', NULL, 0, 'system',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

CREATE TABLE IF NOT EXISTS sweep_setting_versions (
  id TEXT PRIMARY KEY,
  setting_id TEXT NOT NULL CHECK (setting_id = 'ethan_tron_address'),
  tron_address TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  changed_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(setting_id, version)
);

CREATE TABLE IF NOT EXISTS usdt_sweep_batches (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'locked'
    CHECK (status IN ('locked', 'submitted', 'completed', 'cancelled')),
  network TEXT NOT NULL DEFAULT 'TRON' CHECK (network = 'TRON'),
  destination_address TEXT NOT NULL,
  destination_version INTEGER NOT NULL CHECK (destination_version > 0),
  total_amount_minor INTEGER NOT NULL CHECK (total_amount_minor > 0),
  asset_decimals INTEGER NOT NULL DEFAULT 6 CHECK (asset_decimals = 6),
  tx_hash TEXT,
  operator_note TEXT,
  created_by TEXT NOT NULL,
  submitted_by TEXT,
  completed_by TEXT,
  cancelled_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  CHECK (
    (status = 'locked' AND tx_hash IS NULL)
    OR (status = 'cancelled')
    OR (status IN ('submitted', 'completed') AND tx_hash IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usdt_sweep_batches_tx_hash
  ON usdt_sweep_batches(lower(tx_hash))
  WHERE tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usdt_sweep_batches_status
  ON usdt_sweep_batches(status, created_at DESC);

CREATE TABLE IF NOT EXISTS usdt_sweep_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  asset_decimals INTEGER NOT NULL DEFAULT 6 CHECK (asset_decimals = 6),
  ledger_entry_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(batch_id, application_id),
  UNIQUE(ledger_entry_id),
  FOREIGN KEY (batch_id) REFERENCES usdt_sweep_batches(id),
  FOREIGN KEY (application_id) REFERENCES va_applications(id)
);

CREATE INDEX IF NOT EXISTS idx_usdt_sweep_items_application
  ON usdt_sweep_items(application_id, created_at DESC);

CREATE TRIGGER usdt_sweep_items_available_balance
BEFORE INSERT ON usdt_sweep_items
FOR EACH ROW
WHEN (
  COALESCE((
    SELECT SUM(amount_minor) FROM ledger_entries
    WHERE application_id=NEW.application_id
      AND asset='USDT' AND network='TRON'
  ),0)
  - COALESCE((
    SELECT SUM(amount_minor) FROM fund_transactions
    WHERE application_id=NEW.application_id
      AND asset='USDT' AND network='TRON'
      AND type='usdt_withdrawal'
      AND status IN ('submitted','processing')
  ),0)
  - COALESCE((
    SELECT SUM(sell_amount_minor) FROM otc_orders
    WHERE application_id=NEW.application_id
      AND sell_asset='USDT' AND sell_network='TRON'
      AND status IN ('submitted','processing')
  ),0)
  - COALESCE((
    SELECT SUM(i.amount_minor)
    FROM usdt_sweep_items i
    JOIN usdt_sweep_batches b ON b.id=i.batch_id
    WHERE i.application_id=NEW.application_id
      AND b.status IN ('locked','submitted')
  ),0)
) < NEW.amount_minor
BEGIN
  SELECT RAISE(ABORT, 'insufficient_sweep_available_balance');
END;

DROP TABLE IF EXISTS webhook_deliveries_v2;

CREATE TABLE webhook_deliveries_v2 (
  id TEXT PRIMARY KEY,
  partner_key TEXT NOT NULL DEFAULT 'ethan' CHECK (partner_key = 'ethan'),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'application.status_changed',
    'va_account.activated',
    'fund_transaction.status_changed',
    'otc_order.status_changed',
    'fiat_deposit.cleared_and_converted',
    'usdt_sweep.locked',
    'usdt_sweep.completed',
    'usdt_sweep.cancelled',
    'webhook.test'
  )),
  resource_type TEXT NOT NULL CHECK (resource_type IN (
    'va_application',
    'va_account',
    'fund_transaction',
    'otc_order',
    'usdt_sweep_batch',
    'webhook'
  )),
  resource_id TEXT NOT NULL,
  application_id TEXT,
  resource_status TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  signing_secret_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'delivering', 'retry_scheduled',
      'delivered', 'dead_letter', 'suppressed'
    )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  next_attempt_at TEXT,
  last_attempt_at TEXT,
  response_status INTEGER,
  last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 500),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT
);

INSERT INTO webhook_deliveries_v2
SELECT * FROM webhook_deliveries;

DROP TABLE webhook_deliveries;
ALTER TABLE webhook_deliveries_v2 RENAME TO webhook_deliveries;

CREATE INDEX idx_webhook_deliveries_due
  ON webhook_deliveries(status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'retry_scheduled');

CREATE INDEX idx_webhook_deliveries_resource
  ON webhook_deliveries(resource_type, resource_id, created_at DESC);
