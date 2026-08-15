BEGIN;

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_setup'
    CHECK (status IN ('pending_setup', 'active', 'suspended', 'closed')),
  kyc_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (kyc_status IN ('pending', 'approved', 'rejected')),
  kyc_reviewed_by TEXT,
  kyc_reviewed_at TEXT,
  kyc_review_note TEXT,
  operations_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (operations_status IN ('pending', 'active', 'suspended')),
  activated_by TEXT,
  activated_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant_status
  ON customers (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_onboarding
  ON customers (tenant_id, kyc_status, operations_status, status, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_credentials (
  customer_id TEXT PRIMARY KEY REFERENCES customers(id),
  password_salt TEXT,
  password_hash TEXT,
  password_algorithm TEXT NOT NULL DEFAULT 'pbkdf2-sha256-v1'
    CHECK (password_algorithm IN ('pbkdf2-sha256-v1', 'argon2id-v1')),
  password_iterations INTEGER NOT NULL DEFAULT 210000 CHECK (password_iterations >= 0),
  password_memory_kib INTEGER NOT NULL DEFAULT 0 CHECK (password_memory_kib >= 0),
  password_time_cost INTEGER NOT NULL DEFAULT 0 CHECK (password_time_cost >= 0),
  password_parallelism INTEGER NOT NULL DEFAULT 0 CHECK (password_parallelism >= 0),
  password_changed_at TEXT,
  totp_secret_ciphertext TEXT,
  totp_last_counter BIGINT NOT NULL DEFAULT -1 CHECK (totp_last_counter >= -1),
  setup_token_hash TEXT,
  setup_expires_at TEXT,
  setup_consumed_at TEXT,
  enrollment_token_hash TEXT,
  enrollment_expires_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TEXT,
  credential_version BIGINT NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_login_challenges (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  credential_version BIGINT NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_login_challenges_customer
  ON customer_login_challenges (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  credential_version BIGINT NOT NULL,
  expires_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer
  ON customer_sessions (customer_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_active
  ON customer_sessions (token_hash, expires_at, idle_expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS customer_recovery_codes (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  code_hash TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (customer_id, code_hash)
);

CREATE TABLE IF NOT EXISTS customer_auth_audit_events (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(metadata_json::jsonb) = 'object'),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_auth_audit_customer
  ON customer_auth_audit_events (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cregis_wallets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  idempotency_key TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  token_id TEXT,
  currency TEXT,
  address TEXT,
  alias TEXT,
  status TEXT NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'active', 'error', 'frozen', 'closed')),
  custody_provider TEXT CHECK (custody_provider IS NULL OR custody_provider = 'cregis'),
  ownership_verified_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, customer_id, idempotency_key),
  UNIQUE (tenant_id, chain_id, address),
  CHECK ((custody_provider IS NULL AND ownership_verified_at IS NULL) OR
         (custody_provider = 'cregis' AND ownership_verified_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_cregis_wallets_customer
  ON cregis_wallets (tenant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cregis_wallets_customer_fk
  ON cregis_wallets (customer_id);

CREATE TABLE IF NOT EXISTS cregis_withdrawals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  wallet_id TEXT REFERENCES cregis_wallets(id),
  idempotency_key TEXT NOT NULL,
  third_party_id TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL,
  amount_text TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  from_address TEXT,
  to_address TEXT NOT NULL,
  memo TEXT,
  remark TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'submitted', 'approved', 'executing', 'submitted_to_cregis',
    'completed', 'rejected', 'failed', 'exception', 'cancelled'
  )),
  cregis_cid TEXT,
  txid TEXT,
  block_height TEXT,
  block_time TEXT,
  maker_id TEXT NOT NULL,
  checker_id TEXT,
  operator_id TEXT,
  rejection_reason TEXT,
  reconciliation_note TEXT,
  reconciled_by TEXT,
  reconciled_at TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  submitted_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, customer_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_cregis_withdrawals_customer
  ON cregis_withdrawals (tenant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cregis_withdrawals_status
  ON cregis_withdrawals (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cregis_withdrawals_wallet_funds
  ON cregis_withdrawals (tenant_id, customer_id, wallet_id, status, amount_minor);
CREATE INDEX IF NOT EXISTS idx_cregis_withdrawals_customer_fk
  ON cregis_withdrawals (customer_id);
CREATE INDEX IF NOT EXISTS idx_cregis_withdrawals_wallet_fk
  ON cregis_withdrawals (wallet_id);

CREATE TABLE IF NOT EXISTS cregis_deposits (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  wallet_id TEXT REFERENCES cregis_wallets(id),
  cregis_cid TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  address TEXT NOT NULL,
  amount_text TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  txid TEXT,
  block_height TEXT,
  block_time TEXT,
  received_at TEXT NOT NULL,
  raw_sha256 TEXT NOT NULL,
  UNIQUE (tenant_id, cregis_cid)
);

CREATE INDEX IF NOT EXISTS idx_cregis_deposits_wallet
  ON cregis_deposits (tenant_id, wallet_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_cregis_deposits_wallet_funds
  ON cregis_deposits (tenant_id, wallet_id, status, amount_minor);
CREATE INDEX IF NOT EXISTS idx_cregis_deposits_wallet_fk
  ON cregis_deposits (wallet_id);

CREATE TABLE IF NOT EXISTS cregis_callback_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('deposit', 'payout')),
  cregis_cid TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (event_type, cregis_cid, status, payload_sha256)
);

CREATE TABLE IF NOT EXISTS neobank_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO neobank_schema_migrations (version)
VALUES ('0001_neobank_core')
ON CONFLICT (version) DO NOTHING;

COMMIT;
