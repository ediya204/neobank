PRAGMA foreign_keys = ON;

-- Isolated Go customer onboarding has two independent manual gates. Existing
-- customers intentionally remain pending until an operator reviews them.
ALTER TABLE customers ADD COLUMN kyc_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (kyc_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE customers ADD COLUMN kyc_reviewed_by TEXT;
ALTER TABLE customers ADD COLUMN kyc_reviewed_at TEXT;
ALTER TABLE customers ADD COLUMN kyc_review_note TEXT;
ALTER TABLE customers ADD COLUMN operations_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (operations_status IN ('pending', 'active', 'suspended'));
ALTER TABLE customers ADD COLUMN activated_by TEXT;
ALTER TABLE customers ADD COLUMN activated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_tenant_onboarding
  ON customers (tenant_id, kyc_status, operations_status, status, created_at DESC);

-- USDT-TRC20 has six decimal places. Abort instead of rounding if historical
-- text is malformed, has non-zero precision beyond six places, is non-positive,
-- or would overflow a signed 64-bit micro-unit value.
CREATE TABLE migration_guard_0004 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO migration_guard_0004 (ok)
WITH amounts(amount_text) AS (
  SELECT amount_text FROM cregis_withdrawals
  UNION ALL
  SELECT amount_text FROM cregis_deposits
), parts AS (
  SELECT amount_text,
    CASE WHEN instr(amount_text, '.') = 0 THEN amount_text
      ELSE substr(amount_text, 1, instr(amount_text, '.') - 1) END AS whole_text,
    CASE WHEN instr(amount_text, '.') = 0 THEN ''
      ELSE substr(amount_text, instr(amount_text, '.') + 1) END AS fraction_text
  FROM amounts
)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM parts
  WHERE amount_text IS NULL OR amount_text = ''
    OR amount_text GLOB '*[^0-9.]*'
    OR substr(amount_text, 1, 1) = '.' OR substr(amount_text, -1, 1) = '.'
    OR length(amount_text) - length(replace(amount_text, '.', '')) > 1
    OR (length(whole_text) > 1 AND substr(whole_text, 1, 1) = '0')
    OR (length(fraction_text) > 6 AND trim(substr(fraction_text, 7), '0') <> '')
    OR (trim(whole_text, '0') = '' AND trim(substr(fraction_text || '000000', 1, 6), '0') = '')
    OR length(whole_text) > 13
    OR (length(whole_text) = 13 AND whole_text > '9223372036854')
    OR (whole_text = '9223372036854' AND substr(fraction_text || '000000', 1, 6) > '775807')
) THEN 0 ELSE 1 END;

CREATE TABLE cregis_withdrawals_v2 (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  wallet_id TEXT,
  idempotency_key TEXT NOT NULL,
  third_party_id TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL,
  amount_text TEXT NOT NULL,
  amount_minor INTEGER NOT NULL
    CHECK (typeof(amount_minor) = 'integer' AND amount_minor > 0),
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
  FOREIGN KEY (wallet_id) REFERENCES cregis_wallets(id),
  UNIQUE (tenant_id, customer_id, idempotency_key)
);

INSERT INTO cregis_withdrawals_v2 (
  id, tenant_id, customer_id, wallet_id, idempotency_key, third_party_id, currency,
  amount_text, amount_minor, from_address, to_address, memo, remark, status, cregis_cid,
  txid, block_height, block_time, maker_id, checker_id, operator_id, rejection_reason,
  created_at, approved_at, submitted_at, completed_at, updated_at
)
SELECT id, tenant_id, customer_id, wallet_id, idempotency_key, third_party_id, currency,
  amount_text,
  CAST(CASE WHEN instr(amount_text, '.') = 0 THEN amount_text
    ELSE substr(amount_text, 1, instr(amount_text, '.') - 1) END AS INTEGER) * 1000000
  + CAST(substr(CASE WHEN instr(amount_text, '.') = 0 THEN ''
    ELSE substr(amount_text, instr(amount_text, '.') + 1) END || '000000', 1, 6) AS INTEGER),
  from_address, to_address, memo, remark, status, cregis_cid, txid, block_height, block_time,
  maker_id, checker_id, operator_id, rejection_reason, created_at, approved_at, submitted_at,
  completed_at, updated_at
FROM cregis_withdrawals;

DROP TABLE cregis_withdrawals;
ALTER TABLE cregis_withdrawals_v2 RENAME TO cregis_withdrawals;
CREATE INDEX idx_cregis_withdrawals_customer
  ON cregis_withdrawals (tenant_id, customer_id, created_at DESC);
CREATE INDEX idx_cregis_withdrawals_status
  ON cregis_withdrawals (tenant_id, status, created_at DESC);
CREATE INDEX idx_cregis_withdrawals_wallet_funds
  ON cregis_withdrawals (tenant_id, customer_id, wallet_id, status, amount_minor);

CREATE TABLE cregis_deposits_v2 (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  wallet_id TEXT,
  cregis_cid TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  address TEXT NOT NULL,
  amount_text TEXT NOT NULL,
  amount_minor INTEGER NOT NULL
    CHECK (typeof(amount_minor) = 'integer' AND amount_minor > 0),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  txid TEXT,
  block_height TEXT,
  block_time TEXT,
  received_at TEXT NOT NULL,
  raw_sha256 TEXT NOT NULL,
  FOREIGN KEY (wallet_id) REFERENCES cregis_wallets(id),
  UNIQUE (tenant_id, cregis_cid)
);

INSERT INTO cregis_deposits_v2 (
  id, tenant_id, wallet_id, cregis_cid, chain_id, token_id, currency, address,
  amount_text, amount_minor, status, txid, block_height, block_time, received_at, raw_sha256
)
SELECT id, tenant_id, wallet_id, cregis_cid, chain_id, token_id, currency, address,
  amount_text,
  CAST(CASE WHEN instr(amount_text, '.') = 0 THEN amount_text
    ELSE substr(amount_text, 1, instr(amount_text, '.') - 1) END AS INTEGER) * 1000000
  + CAST(substr(CASE WHEN instr(amount_text, '.') = 0 THEN ''
    ELSE substr(amount_text, instr(amount_text, '.') + 1) END || '000000', 1, 6) AS INTEGER),
  status, txid, block_height, block_time, received_at, raw_sha256
FROM cregis_deposits;

DROP TABLE cregis_deposits;
ALTER TABLE cregis_deposits_v2 RENAME TO cregis_deposits;
CREATE INDEX idx_cregis_deposits_wallet
  ON cregis_deposits (tenant_id, wallet_id, received_at DESC);
CREATE INDEX idx_cregis_deposits_wallet_funds
  ON cregis_deposits (tenant_id, wallet_id, status, amount_minor);

DROP TABLE migration_guard_0004;
