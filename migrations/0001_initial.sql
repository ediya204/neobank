PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS va_applications (
  id TEXT PRIMARY KEY,
  phone_country_code TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  email TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN (
      'submitted',
      'kyc_link_ready',
      'kyc_approved',
      'va_processing',
      'active'
    )),
  kyc_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_va_applications_status
  ON va_applications(status);

CREATE INDEX IF NOT EXISTS idx_va_applications_created_at
  ON va_applications(created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_va_applications_email_active
  ON va_applications(lower(email))
  WHERE status != 'active';

CREATE TABLE IF NOT EXISTS va_accounts (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL UNIQUE,
  account_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  currency TEXT NOT NULL,
  swift_bic TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  bank_address TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES va_applications(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  application_id TEXT,
  action TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES va_applications(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_application
  ON audit_logs(application_id, created_at DESC);
