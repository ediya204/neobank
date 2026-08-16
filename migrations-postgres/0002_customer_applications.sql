BEGIN;

CREATE TABLE IF NOT EXISTS customer_applications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  application_reference TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('individual', 'business')),
  phone_country_code TEXT NOT NULL,
  phone TEXT NOT NULL,
  residence_country TEXT NOT NULL,
  full_name TEXT,
  date_of_birth TEXT,
  nationality TEXT,
  legal_name TEXT,
  registration_number TEXT,
  incorporation_country TEXT,
  contact_name TEXT,
  contact_role TEXT,
  beneficial_owner_name TEXT,
  beneficial_owner_ownership TEXT,
  kyc_consent_at TEXT NOT NULL,
  terms_accepted_at TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, customer_id),
  UNIQUE (tenant_id, application_reference),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (
    (account_type = 'individual' AND full_name IS NOT NULL AND date_of_birth IS NOT NULL
      AND nationality IS NOT NULL AND legal_name IS NULL)
    OR
    (account_type = 'business' AND legal_name IS NOT NULL AND registration_number IS NOT NULL
      AND incorporation_country IS NOT NULL AND contact_name IS NOT NULL
      AND contact_role IS NOT NULL AND beneficial_owner_name IS NOT NULL
      AND beneficial_owner_ownership IS NOT NULL AND full_name IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_customer_applications_submitted
  ON customer_applications (tenant_id, submitted_at DESC);

INSERT INTO neobank_schema_migrations (version)
VALUES ('0002_customer_applications')
ON CONFLICT (version) DO NOTHING;

COMMIT;
