-- OTC orders are now validated and settled atomically at creation time.
-- Legacy in-flight orders cannot be completed safely without a fresh quote,
-- so cancel them and release their balance reservations for resubmission.

-- Upgrade the deterministic demo order in place so an existing V1 demo
-- database has the same completed record and balances as a fresh seed.
UPDATE otc_orders
SET
  id = 'demo_otc_usd_to_usdt_completed_v1',
  idempotency_key = 'demo-v1-seed-otc-usd-to-usdt-completed',
  status = 'completed',
  updated_at = '2026-07-29T06:05:00.000Z',
  completed_at = '2026-07-29T06:05:00.000Z'
WHERE id = 'demo_otc_usd_to_usdt_submitted_v1'
  AND status IN ('submitted', 'processing')
  AND NOT EXISTS (
    SELECT 1
    FROM otc_orders
    WHERE id = 'demo_otc_usd_to_usdt_completed_v1'
  );

INSERT OR IGNORE INTO ledger_entries (
  id, application_id, source_type, source_id, asset, amount_minor,
  asset_decimals, entry_type, created_at, network
)
SELECT
  'demo_ledger_otc_usd_sell_completed_v1', application_id,
  'otc_order', id, 'USD', -100000, 2, 'otc_sell',
  '2026-07-29T06:05:00.000Z', ''
FROM otc_orders
WHERE id = 'demo_otc_usd_to_usdt_completed_v1'
  AND status = 'completed';

INSERT OR IGNORE INTO ledger_entries (
  id, application_id, source_type, source_id, asset, amount_minor,
  asset_decimals, entry_type, created_at, network
)
SELECT
  'demo_ledger_otc_usdt_bsc_buy_completed_v1', application_id,
  'otc_order', id, 'USDT', 990025000, 6, 'otc_buy_net',
  '2026-07-29T06:05:00.000Z', 'BSC'
FROM otc_orders
WHERE id = 'demo_otc_usd_to_usdt_completed_v1'
  AND status = 'completed';

UPDATE otc_orders
SET
  status = 'cancelled',
  operator_note = CASE
    WHEN operator_note IS NULL OR trim(operator_note) = ''
      THEN '[SYSTEM] Cancelled during OTC automatic-settlement upgrade; resubmit with a fresh quote.'
    ELSE operator_note || char(10) ||
      '[SYSTEM] Cancelled during OTC automatic-settlement upgrade; resubmit with a fresh quote.'
  END,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status IN ('submitted', 'processing');
