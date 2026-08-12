ALTER TABLE fund_transactions
  ADD COLUMN fee_amount_minor INTEGER NOT NULL DEFAULT 0
  CHECK (fee_amount_minor >= 0);

CREATE TABLE IF NOT EXISTS withdrawal_fee_settings (
  type TEXT PRIMARY KEY
    CHECK (type IN ('fiat_withdrawal', 'usdt_withdrawal')),
  asset TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  asset_decimals INTEGER NOT NULL CHECK (asset_decimals BETWEEN 0 AND 8),
  updated_at TEXT NOT NULL,
  CHECK (
    (type = 'fiat_withdrawal' AND asset = 'USD' AND asset_decimals = 2)
    OR
    (type = 'usdt_withdrawal' AND asset = 'USDT' AND asset_decimals = 6)
  )
);

INSERT OR IGNORE INTO withdrawal_fee_settings
  (type, asset, amount_minor, asset_decimals, updated_at)
VALUES
  ('fiat_withdrawal', 'USD', 3000, 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('usdt_withdrawal', 'USDT', 5000000, 6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
