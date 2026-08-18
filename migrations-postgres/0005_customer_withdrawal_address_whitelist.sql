CREATE TABLE IF NOT EXISTS customer_step_up_challenges (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES customer_sessions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN (
    'add_withdrawal_address',
    'revoke_withdrawal_address'
  )),
  credential_version BIGINT NOT NULL CHECK (credential_version >= 1),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_step_up_challenges_customer
  ON customer_step_up_challenges (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_step_up_challenges_active
  ON customer_step_up_challenges (token_hash, expires_at)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS customer_withdrawal_addresses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  idempotency_key TEXT NOT NULL,
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 100),
  currency TEXT NOT NULL CHECK (currency = '195@TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'),
  network TEXT NOT NULL CHECK (network = 'TRON'),
  address TEXT NOT NULL CHECK (length(address) = 34),
  address_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'suspended')),
  credential_version BIGINT NOT NULL CHECK (credential_version >= 1),
  verified_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, customer_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_withdrawal_addresses_active_destination
  ON customer_withdrawal_addresses (tenant_id, customer_id, network, address_sha256)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_customer_withdrawal_addresses_customer
  ON customer_withdrawal_addresses (tenant_id, customer_id, status, created_at DESC);

ALTER TABLE cregis_withdrawals
  ADD COLUMN IF NOT EXISTS withdrawal_address_id TEXT
  REFERENCES customer_withdrawal_addresses(id);

CREATE INDEX IF NOT EXISTS idx_cregis_withdrawals_withdrawal_address
  ON cregis_withdrawals (withdrawal_address_id)
  WHERE withdrawal_address_id IS NOT NULL;

INSERT INTO neobank_schema_migrations (version)
VALUES ('0005_customer_withdrawal_address_whitelist')
ON CONFLICT (version) DO NOTHING;
