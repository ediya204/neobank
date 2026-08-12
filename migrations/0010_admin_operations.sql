ALTER TABLE fund_transactions
  ADD COLUMN operator_note TEXT;

ALTER TABLE otc_orders
  ADD COLUMN operator_note TEXT;

ALTER TABLE otc_orders
  ADD COLUMN settlement_reference TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs(created_at DESC);
