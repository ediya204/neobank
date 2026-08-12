CREATE TABLE IF NOT EXISTS api_security_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ip_allowlist_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (ip_allowlist_enabled IN (0, 1)),
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO api_security_settings
  (id, ip_allowlist_enabled, updated_at)
VALUES
  (1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE IF NOT EXISTS api_ip_allowlist (
  id TEXT PRIMARY KEY,
  cidr TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (length(cidr) BETWEEN 3 AND 64),
  label TEXT CHECK (label IS NULL OR length(label) BETWEEN 1 AND 120),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_ip_allowlist_created_at
  ON api_ip_allowlist(created_at DESC);
