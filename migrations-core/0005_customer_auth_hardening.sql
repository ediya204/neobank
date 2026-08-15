PRAGMA foreign_keys = ON;

-- Version password records so the Go service can transparently migrate the
-- legacy peppered PBKDF2 record to Argon2id after a successful password check.
ALTER TABLE customer_credentials ADD COLUMN password_algorithm TEXT NOT NULL
  DEFAULT 'pbkdf2-sha256-v1'
  CHECK (password_algorithm IN ('pbkdf2-sha256-v1', 'argon2id-v1'));
ALTER TABLE customer_credentials ADD COLUMN password_memory_kib INTEGER NOT NULL DEFAULT 0
  CHECK (password_memory_kib >= 0);
ALTER TABLE customer_credentials ADD COLUMN password_time_cost INTEGER NOT NULL DEFAULT 0
  CHECK (password_time_cost >= 0);
ALTER TABLE customer_credentials ADD COLUMN password_parallelism INTEGER NOT NULL DEFAULT 0
  CHECK (password_parallelism >= 0);
ALTER TABLE customer_credentials ADD COLUMN password_changed_at TEXT;

-- Reject reuse of an accepted TOTP time step across challenges or sessions.
ALTER TABLE customer_credentials ADD COLUMN totp_last_counter INTEGER NOT NULL DEFAULT -1
  CHECK (totp_last_counter >= -1);

-- Bind a password-complete challenge to the credential version that created it
-- and cap online TOTP/recovery-code guesses at the database boundary.
ALTER TABLE customer_login_challenges ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0
  CHECK (attempts BETWEEN 0 AND 8);
ALTER TABLE customer_login_challenges ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 1
  CHECK (credential_version >= 1);

-- Existing sessions retain their original absolute expiry as their first idle
-- expiry. New sessions receive a shorter sliding idle deadline from the API.
ALTER TABLE customer_sessions ADD COLUMN idle_expires_at TEXT;
UPDATE customer_sessions SET idle_expires_at=expires_at WHERE idle_expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_sessions_active
  ON customer_sessions (token_hash, expires_at, idle_expires_at)
  WHERE revoked_at IS NULL;
