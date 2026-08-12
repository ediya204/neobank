CREATE TABLE IF NOT EXISTS fund_transactions (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  external_reference TEXT,
  idempotency_key TEXT,
  type TEXT NOT NULL CHECK (type IN (
    'fiat_deposit', 'usdt_deposit', 'usdt_withdrawal', 'fiat_withdrawal'
  )),
  asset TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  asset_decimals INTEGER NOT NULL CHECK (asset_decimals BETWEEN 0 AND 8),
  network TEXT,
  destination TEXT,
  transaction_reference TEXT,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'processing', 'completed', 'rejected', 'cancelled')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (application_id) REFERENCES va_applications(id),
  UNIQUE(idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_fund_transactions_application
  ON fund_transactions(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fund_transactions_status
  ON fund_transactions(status, created_at DESC);

CREATE TABLE IF NOT EXISTS otc_orders (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  idempotency_key TEXT,
  sell_asset TEXT NOT NULL,
  sell_amount_minor INTEGER NOT NULL CHECK (sell_amount_minor > 0),
  sell_decimals INTEGER NOT NULL CHECK (sell_decimals BETWEEN 0 AND 8),
  buy_asset TEXT NOT NULL,
  buy_amount_minor INTEGER NOT NULL CHECK (buy_amount_minor > 0),
  buy_decimals INTEGER NOT NULL CHECK (buy_decimals BETWEEN 0 AND 8),
  exchange_rate TEXT NOT NULL,
  fee_bps INTEGER NOT NULL DEFAULT 50 CHECK (fee_bps = 50),
  fee_amount_minor INTEGER NOT NULL CHECK (fee_amount_minor >= 0),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'processing', 'completed', 'rejected', 'cancelled')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (application_id) REFERENCES va_applications(id),
  UNIQUE(idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_otc_orders_application
  ON otc_orders(application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('fund_transaction', 'otc_order', 'adjustment')),
  source_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  asset_decimals INTEGER NOT NULL CHECK (asset_decimals BETWEEN 0 AND 8),
  entry_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES va_applications(id),
  UNIQUE(source_type, source_id, asset, entry_type)
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_application
  ON ledger_entries(application_id, asset, created_at DESC);

CREATE TABLE IF NOT EXISTS api_request_keys (
  idempotency_key TEXT PRIMARY KEY,
  request_path TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
