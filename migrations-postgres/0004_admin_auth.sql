CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  password_salt TEXT,
  password_hash TEXT,
  password_algorithm TEXT NOT NULL DEFAULT 'argon2id-v1' CHECK (password_algorithm = 'argon2id-v1'),
  password_memory_kib INTEGER NOT NULL DEFAULT 19456 CHECK (password_memory_kib = 19456),
  password_time_cost INTEGER NOT NULL DEFAULT 2 CHECK (password_time_cost = 2),
  password_parallelism INTEGER NOT NULL DEFAULT 1 CHECK (password_parallelism = 1),
  totp_secret_ciphertext TEXT,
  totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  totp_last_counter BIGINT NOT NULL DEFAULT -1 CHECK (totp_last_counter >= -1),
  enrollment_token_hash TEXT,
  enrollment_expires_at TEXT,
  credential_version BIGINT NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TEXT,
  setup_completed_at TEXT,
  password_changed_at TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((password_salt IS NULL) = (password_hash IS NULL)),
  CHECK (NOT totp_enabled OR (totp_secret_ciphertext IS NOT NULL AND setup_completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email_lower ON admin_users (LOWER(email));

CREATE TABLE IF NOT EXISTS admin_setup_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_setup_tokens_user ON admin_setup_tokens (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_login_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  credential_version BIGINT NOT NULL CHECK (credential_version >= 1),
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_login_challenges_user ON admin_login_challenges (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  credential_version BIGINT NOT NULL CHECK (credential_version >= 1),
  expires_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_active
  ON admin_sessions (token_hash, expires_at, idle_expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS admin_auth_audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES admin_users(id),
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata_json::jsonb) = 'object'),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_auth_audit_user
  ON admin_auth_audit_events (user_id, created_at DESC);

INSERT INTO neobank_schema_migrations (version)
VALUES ('0004_admin_auth')
ON CONFLICT (version) DO NOTHING;
