PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_setup' CHECK (status IN ('pending_setup', 'active', 'suspended', 'closed')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant_status
  ON customers (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_credentials (
  customer_id TEXT PRIMARY KEY,
  password_salt TEXT,
  password_hash TEXT,
  password_iterations INTEGER NOT NULL DEFAULT 210000,
  totp_secret_ciphertext TEXT,
  setup_token_hash TEXT,
  setup_expires_at TEXT,
  setup_consumed_at TEXT,
  enrollment_token_hash TEXT,
  enrollment_expires_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  credential_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS customer_login_challenges (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_login_challenges_customer
  ON customer_login_challenges (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  credential_version INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer
  ON customer_sessions (customer_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS customer_recovery_codes (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  UNIQUE (customer_id, code_hash)
);

CREATE TABLE IF NOT EXISTS customer_auth_audit_events (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_auth_audit_customer
  ON customer_auth_audit_events (customer_id, created_at DESC);
