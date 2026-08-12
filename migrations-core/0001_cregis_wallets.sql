PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cregis_wallets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  token_id TEXT,
  currency TEXT,
  address TEXT,
  alias TEXT,
  status TEXT NOT NULL DEFAULT 'creating' CHECK (status IN ('creating', 'active', 'error', 'frozen', 'closed')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, customer_id, idempotency_key),
  UNIQUE (tenant_id, chain_id, address)
);

CREATE INDEX IF NOT EXISTS idx_cregis_wallets_customer
  ON cregis_wallets (tenant_id, customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cregis_withdrawals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  wallet_id TEXT,
  idempotency_key TEXT NOT NULL,
  third_party_id TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL,
  amount_text TEXT NOT NULL,
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
  created_at TEXT NOT NULL,
  approved_at TEXT,
  submitted_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (wallet_id) REFERENCES cregis_wallets(id),
  UNIQUE (tenant_id, customer_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_cregis_withdrawals_customer
  ON cregis_withdrawals (tenant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cregis_withdrawals_status
  ON cregis_withdrawals (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS cregis_deposits (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  wallet_id TEXT,
  cregis_cid TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  address TEXT NOT NULL,
  amount_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  txid TEXT,
  block_height TEXT,
  block_time TEXT,
  received_at TEXT NOT NULL,
  raw_sha256 TEXT NOT NULL,
  FOREIGN KEY (wallet_id) REFERENCES cregis_wallets(id),
  UNIQUE (tenant_id, cregis_cid)
);

CREATE INDEX IF NOT EXISTS idx_cregis_deposits_wallet
  ON cregis_deposits (tenant_id, wallet_id, received_at DESC);

CREATE TABLE IF NOT EXISTS cregis_callback_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('deposit', 'payout')),
  cregis_cid TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (event_type, cregis_cid, status, payload_sha256)
);

-- D1's remote query API does not accept multi-statement CREATE TRIGGER bodies.
-- The signed D1 gateway therefore enforces an exact write-query allowlist and
-- rejects DELETE statements, while every state update below is conditional on
-- the expected prior state.
