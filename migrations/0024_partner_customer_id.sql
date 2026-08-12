PRAGMA foreign_keys = ON;

-- Partner-owned customer identifiers are an API/business key. The generated
-- va_applications.id remains the immutable internal relational key.
ALTER TABLE va_applications
  ADD COLUMN partner_customer_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_va_applications_partner_customer_id
  ON va_applications(partner_key, partner_customer_id)
  WHERE partner_customer_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS va_applications_partner_customer_id_insert
BEFORE INSERT ON va_applications
FOR EACH ROW
WHEN NEW.partner_customer_id IS NULL
  OR length(NEW.partner_customer_id) <> 36
  OR length(replace(NEW.partner_customer_id, '-', '')) <> 32
  OR substr(NEW.partner_customer_id, 9, 1) <> '-'
  OR substr(NEW.partner_customer_id, 14, 1) <> '-'
  OR substr(NEW.partner_customer_id, 19, 1) <> '-'
  OR substr(NEW.partner_customer_id, 24, 1) <> '-'
  OR substr(NEW.partner_customer_id, 15, 1) <> '4'
  OR substr(NEW.partner_customer_id, 20, 1) NOT GLOB '[89ab]'
  OR replace(NEW.partner_customer_id, '-', '') GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'invalid_partner_customer_id');
END;

-- Existing rows may remain NULL until the Partner supplies a mapping. Any
-- later backfill or audited operator correction must still use the exact
-- Canonical lowercase UUID v4 string format.
CREATE TRIGGER IF NOT EXISTS va_applications_partner_customer_id_update
BEFORE UPDATE OF partner_customer_id ON va_applications
FOR EACH ROW
WHEN NEW.partner_customer_id IS NOT NULL AND (
  length(NEW.partner_customer_id) <> 36
  OR length(replace(NEW.partner_customer_id, '-', '')) <> 32
  OR substr(NEW.partner_customer_id, 9, 1) <> '-'
  OR substr(NEW.partner_customer_id, 14, 1) <> '-'
  OR substr(NEW.partner_customer_id, 19, 1) <> '-'
  OR substr(NEW.partner_customer_id, 24, 1) <> '-'
  OR substr(NEW.partner_customer_id, 15, 1) <> '4'
  OR substr(NEW.partner_customer_id, 20, 1) NOT GLOB '[89ab]'
  OR replace(NEW.partner_customer_id, '-', '') GLOB '*[^0-9a-f]*'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_partner_customer_id');
END;
