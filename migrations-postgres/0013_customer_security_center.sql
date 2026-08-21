BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS withdrawals_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS withdrawals_locked_at TEXT,
  ADD COLUMN IF NOT EXISTS withdrawal_unlock_requested_at TEXT,
  ADD COLUMN IF NOT EXISTS withdrawal_unlock_available_at TEXT;

ALTER TABLE customer_credentials
  ADD COLUMN IF NOT EXISTS webauthn_user_handle TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_credentials_webauthn_handle
  ON customer_credentials (webauthn_user_handle)
  WHERE webauthn_user_handle IS NOT NULL;

ALTER TABLE customer_sessions
  ADD COLUMN IF NOT EXISTS source_ip_hash TEXT,
  ADD COLUMN IF NOT EXISTS user_agent_hash TEXT,
  ADD COLUMN IF NOT EXISTS device_label TEXT;

CREATE TABLE IF NOT EXISTS customer_passkeys (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  credential_ciphertext TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (char_length(display_name) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_customer_passkeys_customer
  ON customer_passkeys (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_webauthn_challenges (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES customer_sessions(id) ON DELETE CASCADE,
  ceremony TEXT NOT NULL CHECK (ceremony IN ('registration', 'login')),
  session_ciphertext TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    (ceremony = 'registration' AND customer_id IS NOT NULL AND session_id IS NOT NULL)
    OR (ceremony = 'login' AND customer_id IS NULL AND session_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_customer_webauthn_challenges_active
  ON customer_webauthn_challenges (ceremony, expires_at DESC)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS customer_email_change_requests (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  old_email TEXT NOT NULL,
  new_email TEXT NOT NULL,
  credential_version BIGINT NOT NULL CHECK (credential_version >= 1),
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  apply_after TEXT,
  applied_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (old_email <> new_email),
  CHECK (apply_after IS NULL OR verified_at IS NOT NULL),
  CHECK (applied_at IS NULL OR verified_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_email_change_new_email_active
  ON customer_email_change_requests (lower(new_email))
  WHERE applied_at IS NULL AND cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_email_change_customer
  ON customer_email_change_requests (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_account_closure_requests (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'cancelled', 'approved', 'rejected')),
  customer_reason TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  cancelled_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_note TEXT,
  CHECK (char_length(customer_reason) BETWEEN 10 AND 500)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_account_closure_pending
  ON customer_account_closure_requests (customer_id)
  WHERE status = 'pending';

ALTER TYPE "EmailTemplateKey" ADD VALUE IF NOT EXISTS 'CUSTOMER_EMAIL_CHANGE_VERIFICATION';
ALTER TYPE "EmailTemplateKey" ADD VALUE IF NOT EXISTS 'CUSTOMER_SECURITY_ALERT';

INSERT INTO neobank_schema_migrations (version)
VALUES ('0013_customer_security_center')
ON CONFLICT (version) DO NOTHING;

COMMIT;
