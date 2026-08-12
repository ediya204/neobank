PRAGMA foreign_keys = ON;

ALTER TABLE va_applications
  ADD COLUMN submission_round INTEGER NOT NULL DEFAULT 1
    CHECK (submission_round >= 1);

ALTER TABLE va_applications
  ADD COLUMN application_version INTEGER NOT NULL DEFAULT 1
    CHECK (application_version >= 1);

ALTER TABLE va_applications
  ADD COLUMN last_submitted_at TEXT;

ALTER TABLE va_applications
  ADD COLUMN current_review_id TEXT;

UPDATE va_applications
SET last_submitted_at = created_at
WHERE last_submitted_at IS NULL;

CREATE TABLE IF NOT EXISTS va_application_reviews (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  submission_round INTEGER NOT NULL CHECK (submission_round >= 1),
  decision TEXT NOT NULL DEFAULT 'changes_requested'
    CHECK (decision = 'changes_requested'),
  review_stage TEXT NOT NULL
    CHECK (review_stage IN (
      'submitted',
      'kyc_link_ready',
      'kyc_approved',
      'va_processing'
    )),
  public_reason_code TEXT NOT NULL
    CHECK (public_reason_code IN (
      'customer_information_incomplete',
      'customer_information_mismatch',
      'phone_unverifiable',
      'email_unverifiable',
      'kyc_documents_incomplete',
      'kyc_documents_expired',
      'kyc_retry_required',
      'duplicate_customer',
      'unsupported_customer_profile',
      'other'
    )),
  public_reason_text TEXT NOT NULL
    CHECK (length(trim(public_reason_text)) BETWEEN 10 AND 500),
  required_fields_json TEXT NOT NULL CHECK (json_valid(required_fields_json)),
  internal_note TEXT
    CHECK (internal_note IS NULL OR length(trim(internal_note)) BETWEEN 1 AND 1000),
  reviewed_by TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  resolved_at TEXT,
  resubmitted_at TEXT,
  resubmission_note TEXT
    CHECK (resubmission_note IS NULL OR length(trim(resubmission_note)) BETWEEN 1 AND 500),
  idempotency_key TEXT,
  request_fingerprint TEXT
    CHECK (
      request_fingerprint IS NULL OR (
        length(request_fingerprint) = 64
        AND lower(request_fingerprint) NOT GLOB '*[^0-9a-f]*'
      )
    ),
  created_at TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES va_applications(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_va_application_reviews_open
  ON va_application_reviews(application_id)
  WHERE resolved_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_va_application_reviews_idempotency
  ON va_application_reviews(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_va_application_reviews_history
  ON va_application_reviews(application_id, submission_round DESC, reviewed_at DESC);

CREATE TRIGGER IF NOT EXISTS va_application_current_review_insert
BEFORE INSERT ON va_applications
FOR EACH ROW
WHEN NEW.current_review_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'current_review_must_be_null_on_insert');
END;

CREATE TRIGGER IF NOT EXISTS va_application_active_review_guard
BEFORE UPDATE OF status ON va_applications
FOR EACH ROW
WHEN NEW.status = 'active' AND NEW.current_review_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'active_application_cannot_have_open_review');
END;
