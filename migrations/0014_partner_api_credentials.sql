PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS partner_api_credentials (
  id TEXT PRIMARY KEY,
  partner_key TEXT NOT NULL DEFAULT 'ethan' CHECK (partner_key = 'ethan'),
  provider TEXT NOT NULL DEFAULT 'cloudflare_access'
    CHECK (provider = 'cloudflare_access'),
  service_token_id TEXT NOT NULL,
  client_id TEXT NOT NULL CHECK (length(client_id) BETWEEN 8 AND 200),
  client_secret_ciphertext TEXT,
  client_secret_iv TEXT,
  secret_version INTEGER NOT NULL DEFAULT 1 CHECK (secret_version >= 1),
  duration TEXT NOT NULL CHECK (length(duration) BETWEEN 1 AND 32),
  expires_at TEXT NOT NULL,
  previous_secret_expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked')),
  reveal_status TEXT NOT NULL DEFAULT 'available'
    CHECK (reveal_status IN ('available', 'revealed', 'unavailable')),
  source_request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revealed_at TEXT,
  CHECK (
    (client_secret_ciphertext IS NULL AND client_secret_iv IS NULL) OR
    (client_secret_ciphertext IS NOT NULL AND client_secret_iv IS NOT NULL)
  ),
  CHECK (
    (reveal_status = 'available' AND client_secret_ciphertext IS NOT NULL) OR
    (reveal_status <> 'available' AND client_secret_ciphertext IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_api_credentials_partner
  ON partner_api_credentials(partner_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_api_credentials_source_request
  ON partner_api_credentials(source_request_id)
  WHERE source_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS partner_api_credential_rotation_requests (
  id TEXT PRIMARY KEY,
  partner_key TEXT NOT NULL DEFAULT 'ethan' CHECK (partner_key = 'ethan'),
  service_token_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  migration_window_hours INTEGER NOT NULL DEFAULT 48
    CHECK (migration_window_hours BETWEEN 1 AND 168),
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

CREATE INDEX IF NOT EXISTS idx_partner_api_credential_rotation_status
  ON partner_api_credential_rotation_requests(status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_api_credential_rotation_pending
  ON partner_api_credential_rotation_requests(partner_key)
  WHERE status = 'pending';
