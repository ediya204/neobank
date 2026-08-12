PRAGMA foreign_keys = ON;

-- The current production tenant remains Ethan. Keeping the ownership column
-- explicit makes Partner reads fail closed when more tenants are introduced.
ALTER TABLE va_applications
  ADD COLUMN partner_key TEXT NOT NULL DEFAULT 'ethan';

ALTER TABLE usdt_sweep_batches
  ADD COLUMN partner_key TEXT NOT NULL DEFAULT 'ethan';

CREATE INDEX IF NOT EXISTS idx_va_applications_partner
  ON va_applications(partner_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usdt_sweep_batches_partner
  ON usdt_sweep_batches(partner_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usdt_sweep_batches_partner_status
  ON usdt_sweep_batches(partner_key, status, created_at DESC);

CREATE TRIGGER IF NOT EXISTS usdt_sweep_items_partner_insert
BEFORE INSERT ON usdt_sweep_items
FOR EACH ROW
WHEN (
  (SELECT partner_key FROM usdt_sweep_batches WHERE id=NEW.batch_id)
  <> (SELECT partner_key FROM va_applications WHERE id=NEW.application_id)
)
BEGIN
  SELECT RAISE(ABORT, 'sweep_item_partner_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS usdt_sweep_items_partner_update
BEFORE UPDATE OF batch_id, application_id ON usdt_sweep_items
FOR EACH ROW
WHEN (
  (SELECT partner_key FROM usdt_sweep_batches WHERE id=NEW.batch_id)
  <> (SELECT partner_key FROM va_applications WHERE id=NEW.application_id)
)
BEGIN
  SELECT RAISE(ABORT, 'sweep_item_partner_mismatch');
END;
