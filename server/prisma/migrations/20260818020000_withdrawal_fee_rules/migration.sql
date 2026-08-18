CREATE TABLE IF NOT EXISTS withdrawal_fee_rules (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  organization_id TEXT,
  asset_class TEXT NOT NULL CHECK (asset_class IN ('FIAT', 'CRYPTO')),
  currency TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('VA', 'POBO', 'PLATFORM', 'ON_CHAIN')),
  channel_code TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT '',
  fee_amount_minor BIGINT NOT NULL CHECK (fee_amount_minor >= 0),
  fee_decimals INTEGER NOT NULL CHECK (fee_decimals BETWEEN 0 AND 8),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT withdrawal_fee_rules_scope_key
    UNIQUE (scope_id, asset_class, currency, method, channel_code, network)
);

CREATE INDEX IF NOT EXISTS withdrawal_fee_rules_scope_asset_active_idx
  ON withdrawal_fee_rules (scope_id, asset_class, active);
