ALTER TABLE ledger_entries ADD COLUMN network TEXT NOT NULL DEFAULT '';
ALTER TABLE otc_orders ADD COLUMN sell_network TEXT NOT NULL DEFAULT '';
ALTER TABLE otc_orders ADD COLUMN buy_network TEXT NOT NULL DEFAULT '';

-- Historical USDT records predate chain-aware accounting. Treat them as TRON
-- so the migration preserves the existing total without silently duplicating it.
UPDATE ledger_entries
SET network = 'TRON'
WHERE asset = 'USDT' AND network = '';

UPDATE otc_orders
SET sell_network = 'TRON'
WHERE sell_asset = 'USDT' AND sell_network = '';

UPDATE otc_orders
SET buy_network = 'TRON'
WHERE buy_asset = 'USDT' AND buy_network = '';

CREATE INDEX IF NOT EXISTS idx_ledger_entries_balance_bucket
  ON ledger_entries(application_id, asset, network, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fund_transactions_reservation_bucket
  ON fund_transactions(application_id, asset, network, status);

CREATE INDEX IF NOT EXISTS idx_otc_orders_sell_bucket
  ON otc_orders(application_id, sell_asset, sell_network, status);
