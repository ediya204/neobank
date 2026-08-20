ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email_verified_at TEXT;

CREATE TABLE IF NOT EXISTS customer_email_verification_requests (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  email_snapshot TEXT NOT NULL,
  credential_version BIGINT NOT NULL CHECK (credential_version >= 1),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  cancelled_at TEXT,
  request_ip_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_email_verification_active
  ON customer_email_verification_requests (customer_id, expires_at DESC)
  WHERE consumed_at IS NULL AND cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS customer_password_reset_requests (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  email_snapshot TEXT NOT NULL,
  credential_version BIGINT NOT NULL CHECK (credential_version >= 1),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  cancelled_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  request_ip_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_password_reset_active
  ON customer_password_reset_requests (customer_id, expires_at DESC)
  WHERE consumed_at IS NULL AND cancelled_at IS NULL;

ALTER TYPE "EmailTemplateKey" ADD VALUE IF NOT EXISTS 'CUSTOMER_EMAIL_VERIFICATION';
ALTER TYPE "EmailTemplateKey" ADD VALUE IF NOT EXISTS 'CUSTOMER_PASSWORD_RESET_REQUESTED';
ALTER TYPE "EmailTemplateKey" ADD VALUE IF NOT EXISTS 'CUSTOMER_PASSWORD_RESET_COMPLETED';

INSERT INTO neobank_schema_migrations (version)
VALUES ('0012_customer_password_recovery')
ON CONFLICT (version) DO NOTHING;
