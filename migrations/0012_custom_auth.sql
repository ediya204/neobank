PRAGMA foreign_keys = ON;

-- Human identities are provisioned only through the bootstrap setup-token flow.
-- There is intentionally no public registration table or endpoint.
CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (length(email) BETWEEN 3 AND 254),
  role TEXT NOT NULL CHECK (role IN ('admin', 'partner')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  password_hash TEXT,
  password_salt TEXT,
  password_iterations INTEGER
    CHECK (password_iterations IS NULL OR password_iterations >= 100000),
  totp_secret_ciphertext TEXT,
  totp_secret_iv TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0 CHECK (totp_enabled IN (0, 1)),
  last_totp_counter INTEGER NOT NULL DEFAULT -1
    CHECK (last_totp_counter >= -1),
  recovery_codes_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(recovery_codes_json)),
  failed_password_attempts INTEGER NOT NULL DEFAULT 0
    CHECK (failed_password_attempts >= 0),
  locked_until TEXT,
  setup_completed_at TEXT,
  password_changed_at TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (password_hash IS NULL AND password_salt IS NULL AND password_iterations IS NULL) OR
    (password_hash IS NOT NULL AND password_salt IS NOT NULL AND password_iterations IS NOT NULL)
  ),
  CHECK (
    (totp_enabled = 0) OR
    (
      totp_secret_ciphertext IS NOT NULL AND
      totp_secret_iv IS NOT NULL AND
      setup_completed_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_auth_users_role_status
  ON auth_users(role, status);

CREATE TABLE IF NOT EXISTS auth_setup_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_setup_tokens_user
  ON auth_setup_tokens(user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_setup_tokens_expiry
  ON auth_setup_tokens(expires_at)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_totp_enrollments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  secret_ciphertext TEXT,
  secret_iv TEXT,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE,
  CHECK (
    (secret_ciphertext IS NULL AND secret_iv IS NULL) OR
    (secret_ciphertext IS NOT NULL AND secret_iv IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_auth_totp_enrollments_user
  ON auth_totp_enrollments(user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_totp_enrollments_expiry
  ON auth_totp_enrollments(expires_at)
  WHERE verified_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_login_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  consumed_at TEXT,
  ip_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_login_challenges_user
  ON auth_login_challenges(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_login_challenges_expiry
  ON auth_login_challenges(expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  ip_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
  ON auth_sessions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_active
  ON auth_sessions(token_hash, expires_at, idle_expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
  ON auth_sessions(expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  blocked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_cleanup
  ON auth_rate_limits(updated_at);

CREATE TABLE IF NOT EXISTS auth_audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  email_hash TEXT,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  result TEXT NOT NULL CHECK (result IN ('success', 'failure', 'blocked')),
  ip_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_events_created
  ON auth_audit_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_audit_events_user
  ON auth_audit_events(user_id, created_at DESC);
