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

INSERT INTO withdrawal_fee_rules (
  id, scope_id, organization_id, asset_class, currency, method,
  channel_code, network, fee_amount_minor, fee_decimals,
  active, version, created_by, updated_by
)
VALUES (
  'fee_neobank_usdt_cregis_tron', 'neobank', 'org_neobank', 'CRYPTO',
  'USDT', 'ON_CHAIN', 'CREGIS', 'TRON', 5000000, 6,
  TRUE, 1, 'migration:0006', 'migration:0006'
)
ON CONFLICT (scope_id, asset_class, currency, method, channel_code, network)
DO NOTHING;

ALTER TABLE cregis_withdrawals
  ADD COLUMN IF NOT EXISTS fee_amount_text TEXT,
  ADD COLUMN IF NOT EXISTS fee_amount_minor BIGINT,
  ADD COLUMN IF NOT EXISTS net_amount_text TEXT,
  ADD COLUMN IF NOT EXISTS net_amount_minor BIGINT,
  ADD COLUMN IF NOT EXISTS fee_rule_id TEXT,
  ADD COLUMN IF NOT EXISTS fee_rule_version BIGINT;

UPDATE cregis_withdrawals
SET fee_amount_text = COALESCE(fee_amount_text, '0'),
    fee_amount_minor = COALESCE(fee_amount_minor, 0),
    net_amount_text = COALESCE(net_amount_text, amount_text),
    net_amount_minor = COALESCE(net_amount_minor, amount_minor)
WHERE fee_amount_text IS NULL
   OR fee_amount_minor IS NULL
   OR net_amount_text IS NULL
   OR net_amount_minor IS NULL;

ALTER TABLE cregis_withdrawals
  ALTER COLUMN fee_amount_text SET NOT NULL,
  ALTER COLUMN fee_amount_minor SET NOT NULL,
  ALTER COLUMN net_amount_text SET NOT NULL,
  ALTER COLUMN net_amount_minor SET NOT NULL,
  ADD CONSTRAINT cregis_withdrawals_fee_nonnegative CHECK (fee_amount_minor >= 0),
  ADD CONSTRAINT cregis_withdrawals_net_positive CHECK (net_amount_minor > 0),
  ADD CONSTRAINT cregis_withdrawals_amount_breakdown
    CHECK (amount_minor = fee_amount_minor + net_amount_minor),
  ADD CONSTRAINT cregis_withdrawals_fee_rule_version
    CHECK (fee_rule_version IS NULL OR fee_rule_version >= 1);

INSERT INTO neobank_schema_migrations (version)
VALUES ('0006_withdrawal_fee_rules')
ON CONFLICT (version) DO NOTHING;
