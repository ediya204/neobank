#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d)"
test_db="${test_dir}/workflow.db"
trap 'rm -rf "${test_dir}"' EXIT

for migration in "${repo_dir}"/migrations/*.sql; do
  sqlite3 "${test_db}" < "${migration}"
done

sqlite3 "${test_db}" <<'SQL'
PRAGMA foreign_keys = ON;

INSERT INTO va_applications (
  id, partner_customer_id, phone_country_code, phone_number, email, customer_name,
  status, created_at, updated_at
) VALUES (
  'demo_va_active_v1', '6f18e2c7-9175-4a63-8d40-3bc7f291e5a8', '+65', '81000001', 'workflow@example.test',
  '[TEST] Workflow', 'active',
  '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'
);

INSERT INTO fund_transactions (
  id, application_id, external_reference, idempotency_key,
  request_fingerprint, type, asset, amount_minor, fee_amount_minor,
  asset_decimals, network, status, created_at, updated_at
) VALUES (
  'test_fiat_pending', 'demo_va_active_v1', 'TEST-BANK-REF-001',
  'test-fiat-pending',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'fiat_deposit', 'USD', 10000, 0, 2, NULL, 'submitted',
  '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'
);
SQL

if sqlite3 "${test_db}" \
  "UPDATE fund_transactions SET status='completed' WHERE id='test_fiat_pending';" \
  2>/dev/null; then
  echo "FAIL: fiat deposit bypassed mandatory clearing" >&2
  exit 1
fi

if sqlite3 "${test_db}" \
  "INSERT INTO usdt_sweep_batches (id,status,network,destination_address,destination_version,total_amount_minor,asset_decimals,tx_hash,created_by,created_at,updated_at) VALUES ('test_direct_completed','completed','TRON','TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',1,1000000,6,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','test','2026-07-31T00:00:00.000Z','2026-07-31T00:00:00.000Z');" \
  2>/dev/null; then
  echo "FAIL: sweep batch bypassed the locked initial state" >&2
  exit 1
fi

sqlite3 "${test_db}" <<'SQL'
UPDATE fund_transactions
SET status='completed', settlement_status='cleared',
  conversion_otc_id='test_conversion_otc'
WHERE id='test_fiat_pending';

INSERT INTO ledger_entries (
  id, application_id, source_type, source_id, asset, network,
  amount_minor, asset_decimals, entry_type, created_at
) VALUES (
  'test_sweep_balance', 'demo_va_active_v1', 'adjustment',
  'test_sweep_balance', 'USDT', 'TRON', 10000000, 6,
  'adjustment_credit', '2026-07-31T00:00:00.000Z'
);

INSERT INTO va_applications (
  id, partner_customer_id, phone_country_code, phone_number, email, customer_name,
  status, created_at, updated_at
) VALUES (
  'demo_va_other_v1', 'd7a43b90-6e1c-4f25-b879-52da18c3e604', '+65', '81000002', 'workflow-other@example.test',
  '[TEST] Workflow Other', 'active',
  '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'
);

INSERT INTO ledger_entries (
  id, application_id, source_type, source_id, asset, network,
  amount_minor, asset_decimals, entry_type, created_at
) VALUES (
  'test_sweep_other_balance', 'demo_va_other_v1', 'adjustment',
  'test_sweep_other_balance', 'USDT', 'TRON', 10000000, 6,
  'adjustment_credit', '2026-07-31T00:00:00.000Z'
);

INSERT INTO usdt_sweep_batches (
  id, status, network, destination_address, destination_version,
  total_amount_minor, asset_decimals, created_by,
  created_at, updated_at
) VALUES
  (
    'test_sweep_cancelled', 'locked', 'TRON',
    'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', 1,
    1000000, 6, 'test',
    '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'
  ),
  (
    'test_sweep_valid', 'locked', 'TRON',
    'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', 1,
    1000000, 6, 'test',
    '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'
  ),
  (
    'test_sweep_mismatch', 'locked', 'TRON',
    'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', 1,
    1000000, 6, 'test',
    '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'
  );

INSERT INTO usdt_sweep_items (
  id, batch_id, application_id, amount_minor, asset_decimals, created_at
) VALUES
  (
    'test_sweep_cancelled_item', 'test_sweep_cancelled', 'demo_va_active_v1',
    1000000, 6, '2026-07-31T00:00:00.000Z'
  ),
  (
    'test_sweep_valid_item', 'test_sweep_valid', 'demo_va_active_v1',
    1000000, 6, '2026-07-31T00:00:00.000Z'
  ),
  (
    'test_sweep_mismatch_item', 'test_sweep_mismatch', 'demo_va_active_v1',
    1000000, 6, '2026-07-31T00:00:00.000Z'
  );

UPDATE usdt_sweep_batches
SET status='cancelled', cancelled_by='test',
  cancelled_at='2026-07-31T00:01:00.000Z',
  updated_at='2026-07-31T00:01:00.000Z'
WHERE id='test_sweep_cancelled';
SQL

if sqlite3 "${test_db}" \
  "INSERT INTO usdt_sweep_items (id,batch_id,application_id,amount_minor,asset_decimals,created_at) VALUES ('test_late_cancelled_item','test_sweep_cancelled','demo_va_other_v1',1000000,6,'2026-07-31T00:01:00.000Z');" \
  2>/dev/null; then
  echo "FAIL: item was appended to a cancelled sweep" >&2
  exit 1
fi

if sqlite3 "${test_db}" \
  "UPDATE usdt_sweep_batches SET destination_address='TLC8wMRV6KggqEUeZsEd1fC9n3EhPHD9qk' WHERE id='test_sweep_valid';" \
  2>/dev/null; then
  echo "FAIL: locked sweep snapshot changed after item creation" >&2
  exit 1
fi

if sqlite3 "${test_db}" \
  "UPDATE usdt_sweep_items SET amount_minor=2000000 WHERE id='test_sweep_valid_item';" \
  2>/dev/null; then
  echo "FAIL: sweep item amount remained mutable" >&2
  exit 1
fi

sqlite3 "${test_db}" <<'SQL'
UPDATE usdt_sweep_batches
SET status='submitted',
  tx_hash='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  submitted_by='test', submitted_at='2026-07-31T00:02:00.000Z',
  updated_at='2026-07-31T00:02:00.000Z'
WHERE id='test_sweep_valid';

UPDATE usdt_sweep_batches
SET status='submitted',
  tx_hash='cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  submitted_by='test', submitted_at='2026-07-31T00:02:00.000Z',
  updated_at='2026-07-31T00:02:00.000Z'
WHERE id='test_sweep_mismatch';
SQL

if sqlite3 "${test_db}" \
  "INSERT INTO usdt_sweep_items (id,batch_id,application_id,amount_minor,asset_decimals,created_at) VALUES ('test_late_submitted_item','test_sweep_valid','demo_va_other_v1',1000000,6,'2026-07-31T00:02:00.000Z');" \
  2>/dev/null; then
  echo "FAIL: item was appended to a submitted sweep" >&2
  exit 1
fi

if sqlite3 "${test_db}" \
  "UPDATE usdt_sweep_batches SET status='cancelled' WHERE id='test_sweep_valid';" \
  2>/dev/null; then
  echo "FAIL: submitted sweep was cancelled" >&2
  exit 1
fi

if sqlite3 "${test_db}" \
  "UPDATE usdt_sweep_batches SET total_amount_minor=2000000 WHERE id='test_sweep_valid';" \
  2>/dev/null; then
  echo "FAIL: submitted sweep total remained mutable" >&2
  exit 1
fi

if sqlite3 "${test_db}" \
  "UPDATE usdt_sweep_batches SET tx_hash='dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' WHERE id='test_sweep_valid';" \
  2>/dev/null; then
  echo "FAIL: submitted sweep tx hash remained mutable" >&2
  exit 1
fi

if sqlite3 "${test_db}" \
  "UPDATE usdt_sweep_batches SET status='completed' WHERE id='test_sweep_valid';" \
  2>/dev/null; then
  echo "FAIL: sweep completed without item ledger postings" >&2
  exit 1
fi

sqlite3 "${test_db}" <<'SQL'
INSERT INTO ledger_entries (
  id, application_id, source_type, source_id, asset, network,
  amount_minor, asset_decimals, entry_type, created_at
) VALUES (
  'test_sweep_wrong_ledger', 'demo_va_active_v1', 'adjustment',
  'wrong_source', 'USDT', 'TRON', -1000000, 6,
  'adjustment_debit', '2026-07-31T00:03:00.000Z'
);

UPDATE usdt_sweep_items
SET ledger_entry_id='test_sweep_wrong_ledger'
WHERE id='test_sweep_mismatch_item';
SQL

if sqlite3 "${test_db}" \
  "UPDATE usdt_sweep_batches SET status='completed' WHERE id='test_sweep_mismatch';" \
  2>/dev/null; then
  echo "FAIL: sweep completed with a mismatched ledger posting" >&2
  exit 1
fi

sqlite3 "${test_db}" <<'SQL'
INSERT INTO ledger_entries (
  id, application_id, source_type, source_id, asset, network,
  amount_minor, asset_decimals, entry_type, created_at
) VALUES (
  'test_sweep_valid_ledger', 'demo_va_active_v1', 'adjustment',
  'test_sweep_valid_item', 'USDT', 'TRON', -1000000, 6,
  'adjustment_debit', '2026-07-31T00:03:00.000Z'
);

UPDATE usdt_sweep_items
SET ledger_entry_id='test_sweep_valid_ledger'
WHERE id='test_sweep_valid_item';

UPDATE usdt_sweep_batches
SET status='completed', completed_by='test',
  completed_at='2026-07-31T00:04:00.000Z',
  updated_at='2026-07-31T00:04:00.000Z'
WHERE id='test_sweep_valid';
SQL

if sqlite3 "${test_db}" \
  "INSERT INTO usdt_sweep_items (id,batch_id,application_id,amount_minor,asset_decimals,created_at) VALUES ('test_late_completed_item','test_sweep_valid','demo_va_other_v1',1000000,6,'2026-07-31T00:04:00.000Z');" \
  2>/dev/null; then
  echo "FAIL: item was appended to a completed sweep" >&2
  exit 1
fi

if sqlite3 "${test_db}" \
  "UPDATE usdt_sweep_batches SET status='submitted' WHERE id='test_sweep_valid';" \
  2>/dev/null; then
  echo "FAIL: completed sweep regressed to submitted" >&2
  exit 1
fi

if sqlite3 "${test_db}" \
  "UPDATE usdt_sweep_batches SET partner_key='other' WHERE id='test_sweep_valid';" \
  2>/dev/null; then
  echo "FAIL: sweep batch tenant changed after item creation" >&2
  exit 1
fi

if sqlite3 "${test_db}" \
  "UPDATE va_applications SET partner_key='other' WHERE id='demo_va_active_v1';" \
  2>/dev/null; then
  echo "FAIL: application tenant changed after sweep item creation" >&2
  exit 1
fi

if [[ "$(sqlite3 "${test_db}" "SELECT status || ':' || ledger_entry_id FROM usdt_sweep_batches JOIN usdt_sweep_items ON batch_id=usdt_sweep_batches.id WHERE usdt_sweep_batches.id='test_sweep_valid';")" != 'completed:test_sweep_valid_ledger' ]]; then
  echo "FAIL: legitimate sweep completion did not persist" >&2
  exit 1
fi

echo "Accounting workflow guards passed."
