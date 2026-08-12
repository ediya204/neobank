-- Local-only transaction history for the Dashboard and Portal.
-- All rows belong to the existing [DEMO] customer. IDs are idempotent so the
-- file can be applied more than once without creating duplicates.

INSERT OR IGNORE INTO fund_transactions (
  id, application_id, external_reference, idempotency_key,
  request_fingerprint, type, asset, amount_minor, fee_amount_minor,
  asset_decimals, network, destination, transaction_reference,
  beneficiary_name, beneficiary_address, bank_name, bank_account_number,
  swift_bic, bank_address, status, note, operator_note,
  created_at, updated_at, completed_at, settlement_status, conversion_otc_id
) VALUES
  (
    'local_history_fiat_deposit_converted_v1', 'demo_va_active_v1',
    'LOCAL-BANK-IN-001', 'local-history-fiat-deposit-converted-v1',
    '8f7d4c4a45a81de8480de49c221273fef2bd9c4e9ad4f7413d6f48e376cb76df',
    'fiat_deposit', 'USD', 100000, 0, 2, NULL, NULL,
    'LOCAL-BANK-SETTLED-001',
    NULL, NULL, NULL, NULL, NULL, NULL, 'completed',
    '[LOCAL DEMO] 1,000 USD cleared and automatically converted to USDT/TRON',
    '[LOCAL DEMO] Bank receipt reconciled',
    '2026-08-01T02:00:00.000Z', '2026-08-01T02:05:00.000Z',
    '2026-08-01T02:05:00.000Z', 'cleared',
    'local_history_auto_conversion_v1'
  ),
  (
    'local_history_usdt_deposit_v1', 'demo_va_active_v1',
    'LOCAL-TRON-IN-001', 'local-history-usdt-deposit-v1',
    '607cf2eb5b559e3b7c0f08bc954c63283558cfebe47b10d4f7fc59d44ad8b93b',
    'usdt_deposit', 'USDT', 5000000000, 0, 6, 'TRON', NULL,
    'LOCAL-TRON-TX-IN-001',
    NULL, NULL, NULL, NULL, NULL, NULL, 'completed',
    '[LOCAL DEMO] Confirmed 5,000 USDT deposit on TRON', NULL,
    '2026-08-01T03:00:00.000Z', '2026-08-01T03:05:00.000Z',
    '2026-08-01T03:05:00.000Z', 'pending', NULL
  ),
  (
    'local_history_usdt_withdrawal_completed_v1', 'demo_va_active_v1',
    NULL, 'local-history-usdt-withdrawal-completed-v1',
    '1f7c9049fac919c77f8e2467c7b03ca547ba171b93469fd1c52a913e473ace3b',
    'usdt_withdrawal', 'USDT', 300000000, 5000000, 6, 'TRON',
    'T333333333333333333333333333333333', 'LOCAL-TRON-TX-OUT-003',
    NULL, NULL, NULL, NULL, NULL, NULL, 'completed',
    '[LOCAL DEMO] 300 USDT total debit; 5 USDT fee; 295 USDT paid', NULL,
    '2026-08-01T08:00:00.000Z', '2026-08-01T08:05:00.000Z',
    '2026-08-01T08:05:00.000Z', 'pending', NULL
  );

INSERT OR IGNORE INTO otc_orders (
  id, application_id, idempotency_key, request_fingerprint,
  sell_asset, sell_amount_minor, sell_decimals, sell_network,
  buy_asset, buy_amount_minor, buy_decimals, buy_network,
  exchange_rate, fee_bps, fee_amount_minor, status, note, operator_note,
  created_at, updated_at, completed_at, pricing_model,
  source_fund_transaction_id, applied_fee_bps, settlement_reference
) VALUES
  (
    'local_history_auto_conversion_v1', 'demo_va_active_v1',
    'local-history-auto-conversion-v1',
    '2eb18c78ac44ea2558b0883e03d1cab54e1eb368d8bdf5165d85b01c48d86a8e',
    'USD', 100000, 2, '', 'USDT', 995000000, 6, 'TRON',
    '0.995', 50, 0, 'completed',
    '[LOCAL DEMO] Cleared fiat auto-conversion at net rate',
    '[LOCAL DEMO] Conversion checked by operations',
    '2026-08-01T02:05:00.000Z', '2026-08-01T02:05:00.000Z',
    '2026-08-01T02:05:00.000Z', 'net_rate',
    'local_history_fiat_deposit_converted_v1', 0,
    'LOCAL-CONVERSION-001'
  ),
  (
    'local_history_otc_usdt_to_usd_v1', 'demo_va_active_v1',
    'local-history-otc-usdt-to-usd-v1',
    'ea3665a028bb05cc8416c89806f7cc11e8dfb5b4c0b3f7bbabe9a7ecde8d4c98',
    'USDT', 1000000000, 6, 'TRON', 'USD', 100000, 2, '',
    '1', 50, 500, 'completed',
    '[LOCAL DEMO] Sold 1,000 USDT for 995 USD after the 5 USD fee',
    '[LOCAL DEMO] OTC settlement checked by operations',
    '2026-08-01T03:20:00.000Z', '2026-08-01T03:25:00.000Z',
    '2026-08-01T03:25:00.000Z', 'standard_fee', NULL, 50,
    'LOCAL-OTC-SETTLED-002'
  );

INSERT OR IGNORE INTO ledger_entries (
  id, application_id, source_type, source_id, asset, amount_minor,
  asset_decimals, entry_type, created_at, network
) VALUES
  (
    'local_history_ledger_conversion_deposit_v1', 'demo_va_active_v1',
    'fund_transaction', 'local_history_fiat_deposit_converted_v1',
    'USD', 100000, 2, 'fiat_deposit', '2026-08-01T02:05:00.000Z', ''
  ),
  (
    'local_history_ledger_conversion_usd_debit_v1', 'demo_va_active_v1',
    'adjustment', 'local_history_auto_conversion_v1',
    'USD', -100000, 2, 'adjustment_debit', '2026-08-01T02:05:00.000Z', ''
  ),
  (
    'local_history_ledger_conversion_usdt_credit_v1', 'demo_va_active_v1',
    'adjustment', 'local_history_auto_conversion_v1',
    'USDT', 995000000, 6, 'adjustment_credit', '2026-08-01T02:05:00.000Z', 'TRON'
  ),
  (
    'local_history_ledger_usdt_deposit_v1', 'demo_va_active_v1',
    'fund_transaction', 'local_history_usdt_deposit_v1',
    'USDT', 5000000000, 6, 'usdt_deposit', '2026-08-01T03:05:00.000Z', 'TRON'
  ),
  (
    'local_history_ledger_otc_usdt_sell_v1', 'demo_va_active_v1',
    'otc_order', 'local_history_otc_usdt_to_usd_v1',
    'USDT', -1000000000, 6, 'otc_sell', '2026-08-01T03:25:00.000Z', 'TRON'
  ),
  (
    'local_history_ledger_otc_usd_buy_v1', 'demo_va_active_v1',
    'otc_order', 'local_history_otc_usdt_to_usd_v1',
    'USD', 99500, 2, 'otc_buy_net', '2026-08-01T03:25:00.000Z', ''
  ),
  (
    'local_history_ledger_usdt_withdrawal_completed_v1', 'demo_va_active_v1',
    'fund_transaction', 'local_history_usdt_withdrawal_completed_v1',
    'USDT', -300000000, 6, 'usdt_withdrawal', '2026-08-01T08:05:00.000Z', 'TRON'
  );
