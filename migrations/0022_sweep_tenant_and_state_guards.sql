-- Applied after the Portal team and authentication credential-version migrations.
PRAGMA foreign_keys = ON;

-- Every batch must enter through the locked state so the transition guards
-- cannot be bypassed with a terminal-state insert.
CREATE TRIGGER IF NOT EXISTS usdt_sweep_batches_locked_insert
BEFORE INSERT ON usdt_sweep_batches
FOR EACH ROW
WHEN NEW.status <> 'locked'
BEGIN
  SELECT RAISE(ABORT, 'sweep_batch_initial_status_not_locked');
END;

-- A sweep is assembled only while its financial snapshot is locked. This
-- prevents late items from changing an externally submitted or terminal batch.
CREATE TRIGGER IF NOT EXISTS usdt_sweep_items_locked_batch_insert
BEFORE INSERT ON usdt_sweep_items
FOR EACH ROW
WHEN (SELECT status FROM usdt_sweep_batches WHERE id=NEW.batch_id) <> 'locked'
BEGIN
  SELECT RAISE(ABORT, 'sweep_item_batch_not_locked');
END;

-- Sweep item amounts and ownership are financial facts once inserted. The only
-- supported mutation is attaching the immutable ledger entry during completion.
CREATE TRIGGER IF NOT EXISTS usdt_sweep_items_restrict_update
BEFORE UPDATE ON usdt_sweep_items
FOR EACH ROW
WHEN NOT (
  NEW.id = OLD.id
  AND NEW.batch_id = OLD.batch_id
  AND NEW.application_id = OLD.application_id
  AND NEW.amount_minor = OLD.amount_minor
  AND NEW.asset_decimals = OLD.asset_decimals
  AND NEW.created_at = OLD.created_at
  AND OLD.ledger_entry_id IS NULL
  AND NEW.ledger_entry_id IS NOT NULL
  AND (SELECT status FROM usdt_sweep_batches WHERE id=OLD.batch_id) = 'submitted'
)
BEGIN
  SELECT RAISE(ABORT, 'sweep_item_immutable');
END;

CREATE TRIGGER IF NOT EXISTS usdt_sweep_items_restrict_delete
BEFORE DELETE ON usdt_sweep_items
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'sweep_item_immutable');
END;

-- The batch amount must match the immutable item total before an external
-- transaction is recorded, the reservation is released, or completion posts.
CREATE TRIGGER IF NOT EXISTS usdt_sweep_batch_total_before_status_change
BEFORE UPDATE OF status ON usdt_sweep_batches
FOR EACH ROW
WHEN NEW.status <> OLD.status
  AND NEW.status IN ('submitted', 'completed', 'cancelled')
  AND NEW.total_amount_minor <> COALESCE((
    SELECT SUM(amount_minor) FROM usdt_sweep_items WHERE batch_id=OLD.id
  ), 0)
BEGIN
  SELECT RAISE(ABORT, 'sweep_batch_total_mismatch');
END;

-- Completion is the accounting boundary. Every immutable item must point to
-- its own exact negative USDT/TRON ledger posting before the batch can become
-- terminally completed.
CREATE TRIGGER IF NOT EXISTS usdt_sweep_batch_ledger_before_complete
BEFORE UPDATE OF status ON usdt_sweep_batches
FOR EACH ROW
WHEN NEW.status <> OLD.status
  AND NEW.status = 'completed'
  AND EXISTS (
    SELECT 1
    FROM usdt_sweep_items i
    WHERE i.batch_id=OLD.id
      AND (
        i.ledger_entry_id IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM ledger_entries l
          WHERE l.id=i.ledger_entry_id
            AND l.application_id=i.application_id
            AND l.source_type='adjustment'
            AND l.source_id=i.id
            AND l.asset='USDT'
            AND l.network='TRON'
            AND l.amount_minor=-i.amount_minor
            AND l.asset_decimals=i.asset_decimals
            AND l.entry_type='adjustment_debit'
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'sweep_batch_ledger_mismatch');
END;

-- Only the explicit forward workflow is valid. Completed and cancelled are
-- terminal states and can never recreate a reservation.
CREATE TRIGGER IF NOT EXISTS usdt_sweep_batch_status_transition
BEFORE UPDATE OF status ON usdt_sweep_batches
FOR EACH ROW
WHEN NEW.status <> OLD.status
  AND NOT (
    (OLD.status = 'locked' AND NEW.status IN ('submitted', 'cancelled'))
    OR (OLD.status = 'submitted' AND NEW.status = 'completed')
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid_sweep_status_transition');
END;

-- Once the first item exists, or once the batch leaves locked, its ownership
-- and financial snapshot are immutable. Operator notes and lifecycle audit
-- fields remain writable through the explicit workflow.
CREATE TRIGGER IF NOT EXISTS usdt_sweep_batch_financial_snapshot_immutable
BEFORE UPDATE OF
  id, partner_key, network, destination_address, destination_version,
  total_amount_minor, asset_decimals, created_by, created_at
ON usdt_sweep_batches
FOR EACH ROW
WHEN (
    NEW.id IS NOT OLD.id
    OR NEW.partner_key IS NOT OLD.partner_key
    OR NEW.network IS NOT OLD.network
    OR NEW.destination_address IS NOT OLD.destination_address
    OR NEW.destination_version IS NOT OLD.destination_version
    OR NEW.total_amount_minor IS NOT OLD.total_amount_minor
    OR NEW.asset_decimals IS NOT OLD.asset_decimals
    OR NEW.created_by IS NOT OLD.created_by
    OR NEW.created_at IS NOT OLD.created_at
  )
  AND (
    OLD.status <> 'locked'
    OR EXISTS (SELECT 1 FROM usdt_sweep_items WHERE batch_id=OLD.id)
  )
BEGIN
  SELECT RAISE(ABORT, 'sweep_batch_financial_snapshot_immutable');
END;

-- The chain reference is attached exactly once as part of locked -> submitted.
CREATE TRIGGER IF NOT EXISTS usdt_sweep_batch_tx_hash_immutable
BEFORE UPDATE OF tx_hash ON usdt_sweep_batches
FOR EACH ROW
WHEN NEW.tx_hash IS NOT OLD.tx_hash
  AND NOT (
    OLD.status = 'locked'
    AND NEW.status = 'submitted'
    AND OLD.tx_hash IS NULL
    AND NEW.tx_hash IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'sweep_batch_tx_hash_immutable');
END;

-- Tenant ownership cannot be reassigned behind an existing sweep relation.
CREATE TRIGGER IF NOT EXISTS va_application_partner_immutable_after_sweep
BEFORE UPDATE OF partner_key ON va_applications
FOR EACH ROW
WHEN NEW.partner_key <> OLD.partner_key
  AND EXISTS (SELECT 1 FROM usdt_sweep_items WHERE application_id=OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'application_partner_immutable_after_sweep');
END;
