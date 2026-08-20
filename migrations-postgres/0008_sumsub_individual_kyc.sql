CREATE TABLE IF NOT EXISTS customer_onboarding_sessions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_onboarding_sessions_customer
  ON customer_onboarding_sessions (customer_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_onboarding_sessions_active
  ON customer_onboarding_sessions (token_hash, expires_at, idle_expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS customer_kyc_verifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL DEFAULT 'sumsub' CHECK (provider = 'sumsub'),
  external_user_id TEXT NOT NULL,
  applicant_id TEXT,
  level_name TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  status TEXT NOT NULL DEFAULT 'initializing'
    CHECK (status IN (
      'initializing', 'awaiting_applicant', 'provider_reviewing',
      'resubmission_required', 'provider_rejected',
      'ready_for_admin_review', 'provider_error'
    )),
  review_status TEXT,
  review_answer TEXT CHECK (review_answer IS NULL OR review_answer IN ('GREEN', 'RED', 'YELLOW')),
  review_reject_type TEXT CHECK (review_reject_type IS NULL OR review_reject_type IN ('FINAL', 'RETRY')),
  reject_labels_json TEXT NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(reject_labels_json::jsonb) = 'array'),
  moderation_comment TEXT,
  client_comment TEXT,
  provider_created_at TEXT,
  provider_reviewed_at TEXT,
  last_event_at TEXT,
  last_synced_at TEXT,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, customer_id),
  UNIQUE (tenant_id, external_user_id),
  UNIQUE (provider, applicant_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_kyc_verifications_queue
  ON customer_kyc_verifications (tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS customer_kyc_steps (
  verification_id TEXT NOT NULL REFERENCES customer_kyc_verifications(id) ON DELETE CASCADE,
  step_type TEXT NOT NULL CHECK (step_type IN ('IDENTITY', 'SELFIE', 'PROOF_OF_RESIDENCE')),
  review_answer TEXT CHECK (review_answer IS NULL OR review_answer IN ('GREEN', 'RED', 'YELLOW')),
  review_reject_type TEXT CHECK (review_reject_type IS NULL OR review_reject_type IN ('FINAL', 'RETRY')),
  document_type TEXT,
  document_country TEXT,
  reject_labels_json TEXT NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(reject_labels_json::jsonb) = 'array'),
  moderation_comment TEXT,
  client_comment TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (verification_id, step_type)
);

CREATE TABLE IF NOT EXISTS sumsub_webhook_events (
  id TEXT PRIMARY KEY,
  verification_id TEXT NOT NULL REFERENCES customer_kyc_verifications(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL UNIQUE,
  applicant_id TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  sandbox_mode BOOLEAN NOT NULL,
  occurred_at TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sumsub_webhook_events_verification
  ON sumsub_webhook_events (verification_id, received_at DESC);

CREATE TABLE IF NOT EXISTS sumsub_sync_jobs (
  id TEXT PRIMARY KEY,
  verification_id TEXT NOT NULL UNIQUE REFERENCES customer_kyc_verifications(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  run_after TEXT NOT NULL,
  locked_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sumsub_sync_jobs_ready
  ON sumsub_sync_jobs (status, run_after, updated_at);

INSERT INTO neobank_schema_migrations (version)
VALUES ('0008_sumsub_individual_kyc')
ON CONFLICT (version) DO NOTHING;
