-- VA BaaS V1 append-only demo/UAT dataset.
--
-- Safety contract:
--   * Every new application, transaction, order, ledger row, account, key and
--     display name starts with demo / [DEMO].
--   * Re-running this file never deletes or rewrites immutable ledger rows.
--   * Existing demo rows are preserved; use a fresh isolated D1 database when
--     a completely clean acceptance state is required.
--
-- Prerequisite: migrations 0001 through 0024 have been applied.

PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO va_applications (
  id, partner_customer_id, phone_country_code, phone_number, email, customer_name, status,
  kyc_url, created_at, updated_at
) VALUES
  (
    'demo_va_active_v1', 'eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4', '+65', '81000001',
    'demo.active.v1@fideretrust.example', '[DEMO] Ethan Client - Active',
    'active', 'https://in.sumsub.com/idensic/l/demo-active-v1',
    '2026-07-29T01:00:00.000Z', '2026-07-29T01:50:00.000Z'
  ),
  (
    'demo_va_submitted_v1', '0243790f-0c56-49a4-b228-1177e889b101', '+65', '81000002',
    'demo.submitted.v1@fideretrust.example', '[DEMO] Ethan Client - Submitted',
    'submitted', NULL,
    '2026-07-29T02:00:00.000Z', '2026-07-29T02:00:00.000Z'
  ),
  (
    'demo_va_kyc_link_ready_v1', '97ea382a-2885-4f72-9d80-4049d31ddc2c', '+852', '61000003',
    'demo.kyc-ready.v1@fideretrust.example', '[DEMO] Ethan Client - KYC Link Ready',
    'kyc_link_ready', 'https://in.sumsub.com/idensic/l/demo-kyc-ready-v1',
    '2026-07-29T02:10:00.000Z', '2026-07-29T02:20:00.000Z'
  ),
  (
    'demo_va_kyc_approved_v1', '430f0f57-f205-4228-a5c2-311940dde326', '+86', '13800000004',
    'demo.kyc-approved.v1@fideretrust.example', '[DEMO] Ethan Client - KYC Approved',
    'kyc_approved', 'https://in.sumsub.com/idensic/l/demo-kyc-approved-v1',
    '2026-07-29T02:30:00.000Z', '2026-07-29T02:40:00.000Z'
  ),
  (
    'demo_va_va_processing_v1', '5c1b8e12-2f64-4d57-8a91-6d4e3f2a7b10', '+65', '81000005',
    'demo.va-processing.v1@fideretrust.example', '[DEMO] Ethan Client - VA Processing',
    'va_processing', 'https://in.sumsub.com/idensic/l/demo-va-processing-v1',
    '2026-07-29T02:50:00.000Z', '2026-07-29T03:00:00.000Z'
  ),
  (
    'demo_va_uat_api_v1', 'a6d2c9f4-7b31-4e58-b206-1f93d8a45c72', '+65', '81000006',
    'demo.api-uat.v1@fideretrust.example', '[DEMO] API UAT Isolated',
    'active', 'https://in.sumsub.com/idensic/l/demo-api-uat-v1',
    '2026-07-29T03:10:00.000Z', '2026-07-29T03:20:00.000Z'
  );

INSERT OR IGNORE INTO va_accounts (
  id, application_id, account_name, account_number, currency, swift_bic,
  bank_name, bank_address, created_at, updated_at
) VALUES
  (
    'demo_va_account_active_v1', 'demo_va_active_v1',
    'DEMO ETHAN CLIENT ACTIVE', '79632100001001', 'USD', 'DEMOSG01XXX',
    'DEMO V1 BANK B.S.C.', 'DEMO OPERATIONS CENTRE, SINGAPORE',
    '2026-07-29T01:45:00.000Z', '2026-07-29T01:50:00.000Z'
  ),
  (
    'demo_va_account_uat_v1', 'demo_va_uat_api_v1',
    'DEMO API UAT ISOLATED', '79632100001006', 'USD', 'DEMOSG01XXX',
    'DEMO V1 BANK B.S.C.', 'DEMO OPERATIONS CENTRE, SINGAPORE',
    '2026-07-29T03:15:00.000Z', '2026-07-29T03:20:00.000Z'
  );

-- Preserve administrator configuration if it was intentionally changed.
INSERT OR IGNORE INTO withdrawal_fee_settings (
  type, asset, amount_minor, asset_decimals, updated_at
) VALUES
  ('fiat_withdrawal', 'USD', 3000, 2, '2026-07-29T00:00:00.000Z'),
  ('usdt_withdrawal', 'USDT', 5000000, 6, '2026-07-29T00:00:00.000Z');

INSERT OR IGNORE INTO fund_transactions (
  id, application_id, external_reference, idempotency_key,
  request_fingerprint, type, asset, amount_minor, fee_amount_minor,
  asset_decimals, network, destination, transaction_reference,
  beneficiary_name, beneficiary_address, bank_name, bank_account_number,
  swift_bic, bank_address, status, note, created_at, updated_at, completed_at
) VALUES
  (
    'demo_fund_usdt_tron_deposit_completed_v1', 'demo_va_active_v1',
    'DEMO-TRON-IN-001', 'demo-v1-seed-usdt-tron-deposit-completed',
    '607cf2eb5b559e3b7c0f08bc954c63283558cfebe47b10d4f7fc59d44ad8b93b',
    'usdt_deposit', 'USDT', 5000000000, 0, 6, 'TRON', NULL, 'DEMO-TRON-TX-001',
    NULL, NULL, NULL, NULL, NULL, NULL, 'completed',
    '[DEMO] Administrator recorded settled TRON USDT deposit',
    '2026-07-29T04:10:00.000Z', '2026-07-29T04:15:00.000Z',
    '2026-07-29T04:15:00.000Z'
  ),
  (
    'demo_fund_usdt_ethereum_deposit_completed_v1', 'demo_va_active_v1',
    'DEMO-ETH-IN-001', 'demo-v1-seed-usdt-ethereum-deposit-completed',
    'aa831e5b63ca3e38cc9a7e005e65c9f79305b0aebfeb221605aea72d8ed032d2',
    'usdt_deposit', 'USDT', 5000000000, 0, 6, 'ETHEREUM', NULL, 'DEMO-ETH-TX-001',
    NULL, NULL, NULL, NULL, NULL, NULL, 'completed',
    '[DEMO] Administrator recorded settled Ethereum USDT deposit',
    '2026-07-29T04:20:00.000Z', '2026-07-29T04:25:00.000Z',
    '2026-07-29T04:25:00.000Z'
  ),
  (
    'demo_fund_usdt_solana_deposit_completed_v1', 'demo_va_active_v1',
    'DEMO-SOL-IN-001', 'demo-v1-seed-usdt-solana-deposit-completed',
    '638aa7f74bc153054feb3f01c0f8f39185e4eacd0d6a9de2d9eeadee088a3432',
    'usdt_deposit', 'USDT', 5000000000, 0, 6, 'SOLANA', NULL, 'DEMO-SOL-TX-001',
    NULL, NULL, NULL, NULL, NULL, NULL, 'completed',
    '[DEMO] Administrator recorded settled Solana USDT deposit',
    '2026-07-29T04:30:00.000Z', '2026-07-29T04:35:00.000Z',
    '2026-07-29T04:35:00.000Z'
  ),
  (
    'demo_fund_usdt_bsc_deposit_completed_v1', 'demo_va_active_v1',
    'DEMO-BSC-IN-001', 'demo-v1-seed-usdt-bsc-deposit-completed',
    '75dc30334b79792a455aa6a7ec0da9d84ed59d526917a7ac496c04779450e136',
    'usdt_deposit', 'USDT', 5000000000, 0, 6, 'BSC', NULL, 'DEMO-BSC-TX-001',
    NULL, NULL, NULL, NULL, NULL, NULL, 'completed',
    '[DEMO] Administrator recorded settled BSC USDT deposit',
    '2026-07-29T04:40:00.000Z', '2026-07-29T04:45:00.000Z',
    '2026-07-29T04:45:00.000Z'
  ),
  (
    'demo_fund_fiat_withdrawal_submitted_v1', 'demo_va_active_v1',
    NULL, 'demo-v1-seed-fiat-withdrawal-submitted',
    'c816dbd098d3845068e9c88fedf6149e1dd61298c5870415143a3ecfff4e4b0f',
    'fiat_withdrawal', 'USD', 100000, 3000, 2, NULL, NULL, NULL,
    'DEMO BENEFICIARY SUBMITTED', '1 DEMO STREET, SINGAPORE 018956',
    'DEMO V1 BANK', 'DEMO-USD-1001', 'DEMOSG01XXX',
    'DEMO BANK ADDRESS, SINGAPORE', 'submitted',
    '[DEMO] Fee snapshot 30 USD; expected net 970 USD',
    '2026-07-29T05:00:00.000Z', '2026-07-29T05:00:00.000Z', NULL
  ),
  (
    'demo_fund_fiat_withdrawal_processing_v1', 'demo_va_active_v1',
    NULL, 'demo-v1-seed-fiat-withdrawal-processing',
    '0b4e7ad52cb1a7733ba1a907c7624fe07c078dcfc85b28f551334c51cf9db248',
    'fiat_withdrawal', 'USD', 50000, 3000, 2, NULL, NULL, NULL,
    'DEMO BENEFICIARY PROCESSING', '2 DEMO STREET, SINGAPORE 018957',
    'DEMO V1 BANK', 'DEMO-USD-1002', 'DEMOSG01XXX',
    'DEMO BANK ADDRESS, SINGAPORE', 'processing',
    '[DEMO] Fee snapshot 30 USD; expected net 470 USD',
    '2026-07-29T05:10:00.000Z', '2026-07-29T05:15:00.000Z', NULL
  ),
  (
    'demo_fund_fiat_withdrawal_completed_v1', 'demo_va_active_v1',
    NULL, 'demo-v1-seed-fiat-withdrawal-completed',
    '62d3d87fef71437842af83d601b4ebd114d5cef6a4c52d15edea75ed06e1fbf3',
    'fiat_withdrawal', 'USD', 30000, 3000, 2, NULL, NULL, 'DEMO-BANK-OUT-003',
    'DEMO BENEFICIARY COMPLETED', '3 DEMO STREET, SINGAPORE 018958',
    'DEMO V1 BANK', 'DEMO-USD-1003', 'DEMOSG01XXX',
    'DEMO BANK ADDRESS, SINGAPORE', 'completed',
    '[DEMO] Fee snapshot 30 USD; settled net 270 USD',
    '2026-07-29T05:20:00.000Z', '2026-07-29T05:25:00.000Z',
    '2026-07-29T05:25:00.000Z'
  ),
  (
    'demo_fund_usdt_withdrawal_submitted_v1', 'demo_va_active_v1',
    NULL, 'demo-v1-seed-usdt-withdrawal-submitted',
    '684105224482260cf6d4992927686d856e448c61d16e4901143f151001615f16',
    'usdt_withdrawal', 'USDT', 100000000, 5000000, 6, 'TRON',
    'T111111111111111111111111111111111', NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, 'submitted',
    '[DEMO] Fee snapshot 5 USDT; expected net 95 USDT',
    '2026-07-29T05:30:00.000Z', '2026-07-29T05:30:00.000Z', NULL
  ),
  (
    'demo_fund_usdt_withdrawal_processing_v1', 'demo_va_active_v1',
    NULL, 'demo-v1-seed-usdt-withdrawal-processing',
    'abbaaef991d8820ae8cee07ac911fa3e0fe83a5b580cb6e287bca79ab93e5029',
    'usdt_withdrawal', 'USDT', 200000000, 5000000, 6, 'ETHEREUM',
    '0x1111111111111111111111111111111111111111', NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, 'processing',
    '[DEMO] Fee snapshot 5 USDT; expected net 195 USDT',
    '2026-07-29T05:40:00.000Z', '2026-07-29T05:45:00.000Z', NULL
  ),
  (
    'demo_fund_usdt_withdrawal_completed_v1', 'demo_va_active_v1',
    NULL, 'demo-v1-seed-usdt-withdrawal-completed',
    '1f7c9049fac919c77f8e2467c7b03ca547ba171b93469fd1c52a913e473ace3b',
    'usdt_withdrawal', 'USDT', 300000000, 5000000, 6, 'SOLANA',
    '11111111111111111111111111111111', 'DEMO-SOL-OUT-003',
    NULL, NULL, NULL, NULL, NULL, NULL, 'completed',
    '[DEMO] Fee snapshot 5 USDT; settled net 295 USDT',
    '2026-07-29T05:50:00.000Z', '2026-07-29T05:55:00.000Z',
    '2026-07-29T05:55:00.000Z'
  );

-- A settled bank receipt converted automatically at the net rate:
-- 1,000 USD -> 995 USDT/TRON, with no additional OTC fee.
INSERT OR IGNORE INTO fund_transactions (
  id, application_id, external_reference, idempotency_key,
  request_fingerprint, type, asset, amount_minor, fee_amount_minor,
  asset_decimals, network, destination, transaction_reference,
  beneficiary_name, beneficiary_address, bank_name, bank_account_number,
  swift_bic, bank_address, status, note, created_at, updated_at, completed_at,
  settlement_status, conversion_otc_id
) VALUES (
  'demo_fund_fiat_deposit_cleared_converted_v1', 'demo_va_active_v1',
  'DEMO-BANK-IN-AUTO-001', 'demo-v1-seed-fiat-deposit-cleared-converted',
  '8f7d4c4a45a81de8480de49c221273fef2bd9c4e9ad4f7413d6f48e376cb76df',
  'fiat_deposit', 'USD', 100000, 0, 2, NULL, NULL,
  'DEMO-BANK-SETTLED-AUTO-001',
  NULL, NULL, NULL, NULL, NULL, NULL, 'completed',
  '[DEMO] Settled fiat deposit automatically converted to USDT/TRON',
  '2026-07-29T06:20:00.000Z', '2026-07-29T06:25:00.000Z',
  '2026-07-29T06:25:00.000Z', 'cleared',
  'demo_otc_fiat_conversion_usd_to_usdt_tron_v1'
);

INSERT OR IGNORE INTO otc_orders (
  id, application_id, idempotency_key, request_fingerprint,
  sell_asset, sell_amount_minor, sell_decimals, sell_network,
  buy_asset, buy_amount_minor, buy_decimals, buy_network,
  exchange_rate, fee_bps, fee_amount_minor, status, note,
  created_at, updated_at, completed_at
) VALUES
  (
    'demo_otc_usd_to_usdt_completed_v1', 'demo_va_active_v1',
    'demo-v1-seed-otc-usd-to-usdt-completed',
    'fdc6cdb064aaf0bba8e65606d1c5ee2ab14323a325546639e5b600fffa0acbe8',
    'USD', 100000, 2, '', 'USDT', 995000000, 6, 'BSC',
    '0.995', 50, 4975000, 'completed',
    '[DEMO] USD to USDT BSC; fee 4.975 USDT; net 990.025 USDT',
    '2026-07-29T06:00:00.000Z', '2026-07-29T06:05:00.000Z',
    '2026-07-29T06:05:00.000Z'
  ),
  (
    'demo_otc_usdt_to_usd_completed_v1', 'demo_va_active_v1',
    'demo-v1-seed-otc-usdt-to-usd-completed',
    'ea3665a028bb05cc8416c89806f7cc11e8dfb5b4c0b3f7bbabe9a7ecde8d4c98',
    'USDT', 500000000, 6, 'TRON', 'USD', 50000, 2, '',
    '1', 50, 250, 'completed',
    '[DEMO] USDT TRON to USD; fee 2.50 USD; net 497.50 USD',
    '2026-07-29T06:10:00.000Z', '2026-07-29T06:15:00.000Z',
    '2026-07-29T06:15:00.000Z'
  );

INSERT OR IGNORE INTO otc_orders (
  id, application_id, idempotency_key, request_fingerprint,
  sell_asset, sell_amount_minor, sell_decimals, sell_network,
  buy_asset, buy_amount_minor, buy_decimals, buy_network,
  exchange_rate, fee_bps, fee_amount_minor, status, note,
  created_at, updated_at, completed_at, pricing_model,
  source_fund_transaction_id, applied_fee_bps
) VALUES (
  'demo_otc_fiat_conversion_usd_to_usdt_tron_v1', 'demo_va_active_v1',
  'demo-v1-seed-auto-fiat-conversion-usd-usdt-tron',
  '2eb18c78ac44ea2558b0883e03d1cab54e1eb368d8bdf5165d85b01c48d86a8e',
  'USD', 100000, 2, '', 'USDT', 995000000, 6, 'TRON',
  '0.995', 50, 0, 'completed',
  '[DEMO] Cleared fiat auto-conversion; net rate; zero OTC fee',
  '2026-07-29T06:25:00.000Z', '2026-07-29T06:25:00.000Z',
  '2026-07-29T06:25:00.000Z', 'net_rate',
  'demo_fund_fiat_deposit_cleared_converted_v1', 0
);

INSERT OR IGNORE INTO ledger_entries (
  id, application_id, source_type, source_id, asset, amount_minor,
  asset_decimals, entry_type, created_at, network
) VALUES
  (
    'demo_ledger_opening_usd_credit_v1', 'demo_va_active_v1',
    'adjustment', 'demo_opening_usd_credit_v1',
    'USD', 2000000, 2, 'adjustment_credit', '2026-07-29T04:05:00.000Z', ''
  ),
  (
    'demo_ledger_fiat_conversion_deposit_credit_v1', 'demo_va_active_v1',
    'fund_transaction', 'demo_fund_fiat_deposit_cleared_converted_v1',
    'USD', 100000, 2, 'fiat_deposit', '2026-07-29T06:25:00.000Z', ''
  ),
  (
    'demo_ledger_fiat_conversion_usd_debit_v1', 'demo_va_active_v1',
    'adjustment', 'demo_otc_fiat_conversion_usd_to_usdt_tron_v1',
    'USD', -100000, 2, 'adjustment_debit', '2026-07-29T06:25:00.000Z', ''
  ),
  (
    'demo_ledger_fiat_conversion_usdt_tron_credit_v1', 'demo_va_active_v1',
    'adjustment', 'demo_otc_fiat_conversion_usd_to_usdt_tron_v1',
    'USDT', 995000000, 6, 'adjustment_credit',
    '2026-07-29T06:25:00.000Z', 'TRON'
  ),
  (
    'demo_ledger_usdt_tron_deposit_completed_v1', 'demo_va_active_v1',
    'fund_transaction', 'demo_fund_usdt_tron_deposit_completed_v1',
    'USDT', 5000000000, 6, 'usdt_deposit', '2026-07-29T04:15:00.000Z', 'TRON'
  ),
  (
    'demo_ledger_usdt_ethereum_deposit_completed_v1', 'demo_va_active_v1',
    'fund_transaction', 'demo_fund_usdt_ethereum_deposit_completed_v1',
    'USDT', 5000000000, 6, 'usdt_deposit', '2026-07-29T04:25:00.000Z', 'ETHEREUM'
  ),
  (
    'demo_ledger_usdt_solana_deposit_completed_v1', 'demo_va_active_v1',
    'fund_transaction', 'demo_fund_usdt_solana_deposit_completed_v1',
    'USDT', 5000000000, 6, 'usdt_deposit', '2026-07-29T04:35:00.000Z', 'SOLANA'
  ),
  (
    'demo_ledger_usdt_bsc_deposit_completed_v1', 'demo_va_active_v1',
    'fund_transaction', 'demo_fund_usdt_bsc_deposit_completed_v1',
    'USDT', 5000000000, 6, 'usdt_deposit', '2026-07-29T04:45:00.000Z', 'BSC'
  ),
  (
    'demo_ledger_fiat_withdrawal_completed_v1', 'demo_va_active_v1',
    'fund_transaction', 'demo_fund_fiat_withdrawal_completed_v1',
    'USD', -30000, 2, 'fiat_withdrawal', '2026-07-29T05:25:00.000Z', ''
  ),
  (
    'demo_ledger_usdt_withdrawal_completed_v1', 'demo_va_active_v1',
    'fund_transaction', 'demo_fund_usdt_withdrawal_completed_v1',
    'USDT', -300000000, 6, 'usdt_withdrawal', '2026-07-29T05:55:00.000Z', 'SOLANA'
  ),
  (
    'demo_ledger_otc_usd_sell_completed_v1', 'demo_va_active_v1',
    'otc_order', 'demo_otc_usd_to_usdt_completed_v1',
    'USD', -100000, 2, 'otc_sell', '2026-07-29T06:05:00.000Z', ''
  ),
  (
    'demo_ledger_otc_usdt_bsc_buy_completed_v1', 'demo_va_active_v1',
    'otc_order', 'demo_otc_usd_to_usdt_completed_v1',
    'USDT', 990025000, 6, 'otc_buy_net', '2026-07-29T06:05:00.000Z', 'BSC'
  ),
  (
    'demo_ledger_otc_usdt_sell_completed_v1', 'demo_va_active_v1',
    'otc_order', 'demo_otc_usdt_to_usd_completed_v1',
    'USDT', -500000000, 6, 'otc_sell', '2026-07-29T06:15:00.000Z', 'TRON'
  ),
  (
    'demo_ledger_otc_usd_buy_completed_v1', 'demo_va_active_v1',
    'otc_order', 'demo_otc_usdt_to_usd_completed_v1',
    'USD', 49750, 2, 'otc_buy_net', '2026-07-29T06:15:00.000Z', ''
  ),
  (
    'demo_ledger_uat_usd_v1', 'demo_va_uat_api_v1',
    'adjustment', 'demo_uat_seed_usd_v1',
    'USD', 500000, 2, 'adjustment_credit', '2026-07-29T03:25:00.000Z', ''
  ),
  (
    'demo_ledger_uat_usdt_tron_v1', 'demo_va_uat_api_v1',
    'adjustment', 'demo_uat_seed_usdt_tron_v1',
    'USDT', 5000000000, 6, 'adjustment_credit', '2026-07-29T03:25:00.000Z', 'TRON'
  );

-- Two terminal batches provide deterministic Partner pagination coverage
-- without changing balances or transaction history.
INSERT OR IGNORE INTO usdt_sweep_batches (
  id, status, network, destination_address, destination_version,
  total_amount_minor, asset_decimals, created_by, created_at, updated_at
) VALUES
  (
    'demo_sweep_cancelled_first_v1', 'locked', 'TRON',
    'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', 1, 1000000, 6,
    'demo-seed', '2026-07-29T06:40:00.000Z', '2026-07-29T06:40:00.000Z'
  ),
  (
    'demo_sweep_cancelled_second_v1', 'locked', 'TRON',
    'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', 1, 2000000, 6,
    'demo-seed', '2026-07-29T06:50:00.000Z', '2026-07-29T06:50:00.000Z'
  );

INSERT INTO usdt_sweep_items (
  id, batch_id, application_id, amount_minor, asset_decimals, created_at
)
SELECT
  'demo_sweep_cancelled_first_item_v1',
  'demo_sweep_cancelled_first_v1',
  'demo_va_active_v1', 1000000, 6, '2026-07-29T06:40:00.000Z'
WHERE NOT EXISTS (
  SELECT 1 FROM usdt_sweep_items
  WHERE id='demo_sweep_cancelled_first_item_v1'
);

INSERT INTO usdt_sweep_items (
  id, batch_id, application_id, amount_minor, asset_decimals, created_at
)
SELECT
  'demo_sweep_cancelled_second_item_v1',
  'demo_sweep_cancelled_second_v1',
  'demo_va_active_v1', 2000000, 6, '2026-07-29T06:50:00.000Z'
WHERE NOT EXISTS (
  SELECT 1 FROM usdt_sweep_items
  WHERE id='demo_sweep_cancelled_second_item_v1'
);

UPDATE usdt_sweep_batches
SET status='cancelled', cancelled_by='demo-seed',
  cancelled_at=created_at, updated_at=created_at
WHERE id IN (
  'demo_sweep_cancelled_first_v1',
  'demo_sweep_cancelled_second_v1'
)
AND status='locked';

-- Admin-only demo fields. Portal and Partner API responses must not expose
-- these values, while Admin details use them to verify the operations workflow.
UPDATE fund_transactions
SET operator_note = '[DEMO] Bank payout is being verified by operations'
WHERE id = 'demo_fund_fiat_withdrawal_processing_v1';

UPDATE otc_orders
SET
  operator_note = '[DEMO] OTC settlement checked by operations',
  settlement_reference = 'DEMO-OTC-SETTLEMENT-001'
WHERE id = 'demo_otc_usdt_to_usd_completed_v1';
