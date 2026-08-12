PRAGMA foreign_keys = ON;

-- Existing wallet rows predate the Cregis ownership-verification gate. They
-- intentionally remain unverified and therefore cannot expose a deposit
-- address until a newly allocated address passes /api/v1/address/inner.
ALTER TABLE cregis_wallets ADD COLUMN custody_provider TEXT
  CHECK (custody_provider IS NULL OR custody_provider = 'cregis');
ALTER TABLE cregis_wallets ADD COLUMN ownership_verified_at TEXT;

CREATE INDEX IF NOT EXISTS idx_cregis_wallets_deposit_ready
  ON cregis_wallets (tenant_id, customer_id, status, custody_provider, ownership_verified_at);
