PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS partner_webhook_signing_keys (
  id TEXT PRIMARY KEY,
  partner_key TEXT NOT NULL DEFAULT 'ethan' CHECK (partner_key = 'ethan'),
  secret_ciphertext TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  secret_version INTEGER NOT NULL CHECK (secret_version >= 1),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'active', 'retiring', 'revoked')),
  reveal_status TEXT NOT NULL DEFAULT 'available'
    CHECK (reveal_status IN ('available', 'revealed')),
  source_request_id TEXT NOT NULL,
  overlap_hours INTEGER NOT NULL DEFAULT 48 CHECK (overlap_hours BETWEEN 1 AND 168),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revealed_at TEXT,
  activated_at TEXT,
  retiring_at TEXT,
  expires_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_signing_keys_partner_version
  ON partner_webhook_signing_keys(partner_key, secret_version);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_signing_keys_source_request
  ON partner_webhook_signing_keys(source_request_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_signing_keys_active
  ON partner_webhook_signing_keys(partner_key)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS partner_webhook_signing_key_requests (
  id TEXT PRIMARY KEY,
  partner_key TEXT NOT NULL DEFAULT 'ethan' CHECK (partner_key = 'ethan'),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  overlap_hours INTEGER NOT NULL DEFAULT 48 CHECK (overlap_hours BETWEEN 1 AND 168),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by TEXT NOT NULL DEFAULT 'partner' CHECK (requested_by = 'partner'),
  requested_via TEXT NOT NULL CHECK (requested_via IN ('portal', 'api')),
  reviewed_by TEXT,
  review_note TEXT CHECK (review_note IS NULL OR length(review_note) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_signing_key_requests_status
  ON partner_webhook_signing_key_requests(status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_signing_key_requests_pending
  ON partner_webhook_signing_key_requests(partner_key)
  WHERE status = 'pending';
