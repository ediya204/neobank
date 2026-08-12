ALTER TABLE api_ip_allowlist
  ADD COLUMN environment TEXT NOT NULL DEFAULT 'production'
    CHECK (environment IN ('production', 'disaster_recovery', 'development'));

ALTER TABLE api_ip_allowlist
  ADD COLUMN source_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_ip_allowlist_source_request
  ON api_ip_allowlist(source_request_id)
  WHERE source_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS api_ip_allowlist_requests (
  id TEXT PRIMARY KEY,
  partner_key TEXT NOT NULL DEFAULT 'ethan' CHECK (partner_key = 'ethan'),
  action TEXT NOT NULL CHECK (action IN ('add', 'remove')),
  target_entry_id TEXT,
  target_updated_at TEXT,
  cidr TEXT NOT NULL COLLATE NOCASE CHECK (length(cidr) BETWEEN 3 AND 64),
  label TEXT CHECK (label IS NULL OR length(label) BETWEEN 1 AND 120),
  environment TEXT NOT NULL DEFAULT 'production'
    CHECK (environment IN ('production', 'disaster_recovery', 'development')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by TEXT NOT NULL DEFAULT 'partner' CHECK (requested_by = 'partner'),
  requested_via TEXT NOT NULL CHECK (requested_via IN ('portal', 'api')),
  reviewed_by TEXT,
  review_note TEXT CHECK (review_note IS NULL OR length(review_note) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  CHECK (
    (action = 'add' AND target_entry_id IS NULL) OR
    (action = 'remove' AND target_entry_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_api_ip_allowlist_requests_status
  ON api_ip_allowlist_requests(status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_ip_allowlist_requests_pending_add
  ON api_ip_allowlist_requests(partner_key, cidr)
  WHERE action = 'add' AND status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_ip_allowlist_requests_pending_remove
  ON api_ip_allowlist_requests(partner_key, target_entry_id)
  WHERE action = 'remove' AND status = 'pending';

CREATE TABLE IF NOT EXISTS partner_webhook_settings (
  partner_key TEXT PRIMARY KEY CHECK (partner_key = 'ethan'),
  endpoint_url TEXT,
  events_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'disabled'
    CHECK (status IN ('active', 'paused', 'disabled')),
  signing_secret_version TEXT NOT NULL DEFAULT 'v1',
  source_request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (status = 'disabled') OR
    (endpoint_url IS NOT NULL AND length(endpoint_url) BETWEEN 10 AND 2048)
  )
);

INSERT OR IGNORE INTO partner_webhook_settings
  (partner_key, endpoint_url, events_json, status, signing_secret_version,
   source_request_id, created_at, updated_at)
VALUES
  ('ethan', NULL, '[]', 'disabled', 'v1', NULL,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE IF NOT EXISTS partner_webhook_requests (
  id TEXT PRIMARY KEY,
  partner_key TEXT NOT NULL DEFAULT 'ethan' CHECK (partner_key = 'ethan'),
  action TEXT NOT NULL CHECK (action IN ('upsert', 'disable')),
  endpoint_url TEXT,
  events_json TEXT NOT NULL DEFAULT '[]',
  target_updated_at TEXT,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by TEXT NOT NULL DEFAULT 'partner' CHECK (requested_by = 'partner'),
  requested_via TEXT NOT NULL CHECK (requested_via IN ('portal', 'api')),
  reviewed_by TEXT,
  review_note TEXT CHECK (review_note IS NULL OR length(review_note) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  CHECK (
    (action = 'upsert' AND endpoint_url IS NOT NULL AND length(endpoint_url) BETWEEN 10 AND 2048) OR
    action = 'disable'
  )
);

CREATE INDEX IF NOT EXISTS idx_partner_webhook_requests_status
  ON partner_webhook_requests(status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_webhook_requests_pending
  ON partner_webhook_requests(partner_key)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  partner_key TEXT NOT NULL DEFAULT 'ethan' CHECK (partner_key = 'ethan'),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'application.status_changed',
    'va_account.activated',
    'fund_transaction.status_changed',
    'otc_order.status_changed',
    'webhook.test'
  )),
  resource_type TEXT NOT NULL CHECK (resource_type IN (
    'va_application',
    'va_account',
    'fund_transaction',
    'otc_order',
    'webhook'
  )),
  resource_id TEXT NOT NULL,
  application_id TEXT,
  resource_status TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  signing_secret_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'delivering',
      'retry_scheduled',
      'delivered',
      'dead_letter',
      'suppressed'
    )),
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count BETWEEN 0 AND 5),
  next_attempt_at TEXT,
  last_attempt_at TEXT,
  response_status INTEGER,
  last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 500),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
  ON webhook_deliveries(status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'retry_scheduled');

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_resource
  ON webhook_deliveries(resource_type, resource_id, created_at DESC);
