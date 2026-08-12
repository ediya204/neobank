-- Historical fiat deposits that reached the old generic completed path cannot
-- be converted automatically without reconciling the real bank and customer
-- position. Make the inconsistency explicit for operator review.
UPDATE fund_transactions
SET settlement_status = 'exception'
WHERE type = 'fiat_deposit'
  AND status = 'completed'
  AND (
    settlement_status <> 'cleared'
    OR conversion_otc_id IS NULL
  );

-- A completed fiat deposit must have gone through the atomic clear-and-convert
-- path, which sets both fields in the same statement.
CREATE TRIGGER fiat_deposit_completed_requires_clearing_insert
BEFORE INSERT ON fund_transactions
FOR EACH ROW
WHEN NEW.type = 'fiat_deposit'
  AND NEW.status = 'completed'
  AND (
    NEW.settlement_status <> 'cleared'
    OR NEW.conversion_otc_id IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'fiat_settlement_required');
END;

CREATE TRIGGER fiat_deposit_completed_requires_clearing_update
BEFORE UPDATE OF status, settlement_status, conversion_otc_id ON fund_transactions
FOR EACH ROW
WHEN NEW.type = 'fiat_deposit'
  AND NEW.status = 'completed'
  AND (
    NEW.settlement_status <> 'cleared'
    OR NEW.conversion_otc_id IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'fiat_settlement_required');
END;

-- Recording a Tx Hash means an external transfer may already be irreversible.
-- Never release its reservation through a direct submitted -> cancelled move.
CREATE TRIGGER usdt_sweep_submitted_cannot_cancel
BEFORE UPDATE OF status ON usdt_sweep_batches
FOR EACH ROW
WHEN OLD.status = 'submitted' AND NEW.status = 'cancelled'
BEGIN
  SELECT RAISE(ABORT, 'submitted_sweep_cannot_cancel');
END;
