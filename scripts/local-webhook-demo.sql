-- Local-only Webhook UI demo data.
-- Run with Wrangler's --local flag. Fixed IDs make this seed idempotent.

PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO partner_webhook_requests (
  id, partner_key, action, endpoint_url, events_json, target_updated_at,
  reason, status, requested_by, requested_via, reviewed_by, review_note,
  created_at, updated_at, reviewed_at
) VALUES (
  'demo_webhook_request_approved_v1',
  'ethan',
  'upsert',
  'https://webhook-demo.example/events',
  '["application.status_changed","va_account.activated","fund_transaction.status_changed","fiat_deposit.cleared_and_converted","otc_order.status_changed","usdt_sweep.locked","usdt_sweep.completed","usdt_sweep.cancelled"]',
  NULL,
  '[DEMO] Local Portal Webhook interface preview',
  'approved',
  'partner',
  'portal',
  'demo-operator',
  '[DEMO] Approved for local interface testing',
  '2026-08-01T08:00:00.000Z',
  '2026-08-01T08:15:00.000Z',
  '2026-08-01T08:15:00.000Z'
);

UPDATE partner_webhook_settings
SET
  endpoint_url = 'https://webhook-demo.example/events',
  events_json = '["application.status_changed","va_account.activated","fund_transaction.status_changed","fiat_deposit.cleared_and_converted","otc_order.status_changed","usdt_sweep.locked","usdt_sweep.completed","usdt_sweep.cancelled"]',
  status = 'active',
  source_request_id = 'demo_webhook_request_approved_v1',
  updated_at = '2026-08-01T08:15:00.000Z'
WHERE partner_key = 'ethan';

INSERT OR IGNORE INTO webhook_deliveries (
  id, partner_key, event_type, resource_type, resource_id, application_id,
  resource_status, endpoint_url, payload_json, signing_secret_version,
  status, attempt_count, next_attempt_at, last_attempt_at, response_status,
  last_error, created_at, updated_at, delivered_at
) VALUES
  (
    'demo_webhook_delivery_application_v1', 'ethan',
    'application.status_changed', 'va_application', 'demo_va_kyc_link_ready_v1',
    'demo_va_kyc_link_ready_v1', 'kyc_link_ready',
    'https://webhook-demo.example/events',
    '{"event_id":"demo_webhook_delivery_application_v1","type":"application.status_changed","occurred_at":"2026-08-02T01:18:37.000Z","data":{"resource_type":"va_application","resource_id":"demo_va_kyc_link_ready_v1","application_id":"demo_va_kyc_link_ready_v1","partner_customer_id":"97ea382a-2885-4f72-9d80-4049d31ddc2c","status":"kyc_link_ready","kyc_url":"https://in.sumsub.com/idensic/l/demo-kyc-ready-v1"}}',
    'v1', 'delivered', 1, NULL, '2026-08-02T01:18:38.000Z', 200, NULL,
    '2026-08-02T01:18:37.000Z', '2026-08-02T01:18:38.000Z',
    '2026-08-02T01:18:38.000Z'
  ),
  (
    'demo_webhook_delivery_va_account_v1', 'ethan',
    'va_account.activated', 'va_account', 'demo_va_account_active_v1',
    'demo_va_active_v1', 'active',
    'https://webhook-demo.example/events',
    '{"event_id":"demo_webhook_delivery_va_account_v1","type":"va_account.activated","occurred_at":"2026-08-02T01:18:30.000Z","data":{"resource_type":"va_account","resource_id":"demo_va_active_v1","application_id":"demo_va_active_v1","partner_customer_id":"eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4","status":"active","va_account":{"account_name":"DEMO ETHAN CLIENT ACTIVE","account_number":"79632100001001","iban":null,"currency":"USD","swift_bic":"DEMOSG01XXX","bank_name":"DEMO V1 BANK B.S.C.","bank_address":"DEMO OPERATIONS CENTRE, SINGAPORE"}}}',
    'v1', 'delivered', 1, NULL, '2026-08-02T01:18:31.000Z', 204, NULL,
    '2026-08-02T01:18:30.000Z', '2026-08-02T01:18:31.000Z',
    '2026-08-02T01:18:31.000Z'
  ),
  (
    'demo_webhook_delivery_fund_v1', 'ethan',
    'fund_transaction.status_changed', 'fund_transaction',
    'demo_fund_fiat_deposit_cleared_converted_v1', 'demo_va_active_v1', 'completed',
    'https://webhook-demo.example/events',
    '{"event_id":"demo_webhook_delivery_fund_v1","type":"fund_transaction.status_changed","occurred_at":"2026-08-02T01:18:25.000Z","data":{"resource_type":"fund_transaction","resource_id":"demo_fund_fiat_deposit_cleared_converted_v1","application_id":"demo_va_active_v1","partner_customer_id":"eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4","status":"completed","transaction_type":"fiat_deposit","direction":"deposit","asset":"USD","amount":"1000","fee_amount":"0","net_amount":"1000","network":null,"external_reference":"DEMO-BANK-IN-AUTO-001","transaction_reference":"DEMO-BANK-SETTLED-AUTO-001","settlement_status":"cleared"}}',
    'v1', 'delivered', 2, NULL, '2026-08-02T01:18:27.000Z', 200, NULL,
    '2026-08-02T01:18:25.000Z', '2026-08-02T01:18:27.000Z',
    '2026-08-02T01:18:27.000Z'
  ),
  (
    'demo_webhook_delivery_fiat_cleared_v1', 'ethan',
    'fiat_deposit.cleared_and_converted', 'fund_transaction',
    'demo_fund_fiat_deposit_cleared_converted_v1', 'demo_va_active_v1', 'cleared',
    'https://webhook-demo.example/events',
    '{"event_id":"demo_webhook_delivery_fiat_cleared_v1","type":"fiat_deposit.cleared_and_converted","occurred_at":"2026-08-02T01:18:26.000Z","data":{"resource_type":"fund_transaction","resource_id":"demo_fund_fiat_deposit_cleared_converted_v1","application_id":"demo_va_active_v1","partner_customer_id":"eb9c7fa8-eb8c-45f8-a838-e82033a5b1f4","status":"completed","transaction_type":"fiat_deposit","direction":"deposit","external_reference":"DEMO-BANK-IN-AUTO-001","transaction_reference":"DEMO-BANK-IN-AUTO-001","settlement_status":"cleared","cleared_at":"2026-08-02T01:18:26.000Z","fiat_asset":"USD","fiat_amount":"1000","exchange_rate":"0.995","exchange_rate_version":1,"usdt_amount":"995","usdt_net_amount":"995","usdt_network":"TRON","otc_order_id":"demo_otc_fiat_conversion_usd_to_usdt_tron_v1","otc_status":"completed"}}',
    'v1', 'delivered', 1, NULL, '2026-08-02T01:18:27.000Z', 200, NULL,
    '2026-08-02T01:18:26.000Z', '2026-08-02T01:18:27.000Z',
    '2026-08-02T01:18:27.000Z'
  ),
  (
    'demo_webhook_delivery_otc_v1', 'ethan',
    'otc_order.status_changed', 'otc_order',
    'demo_otc_usd_to_usdt_completed_v1', 'demo_va_active_v1', 'completed',
    'https://webhook-demo.example/events',
    '{"event_id":"demo_webhook_delivery_otc_v1","event_type":"otc_order.status_changed","resource_id":"demo_otc_usd_to_usdt_completed_v1","status":"completed","occurred_at":"2026-08-02T01:18:16.000Z"}',
    'v1', 'delivered', 1, NULL, '2026-08-02T01:18:17.000Z', 200, NULL,
    '2026-08-02T01:18:16.000Z', '2026-08-02T01:18:17.000Z',
    '2026-08-02T01:18:17.000Z'
  ),
  (
    'demo_webhook_delivery_dead_letter_v1', 'ethan',
    'fund_transaction.status_changed', 'fund_transaction',
    'demo_fund_usdt_withdrawal_processing_v1', 'demo_va_active_v1', 'processing',
    'https://webhook-demo.example/events',
    '{"event_id":"demo_webhook_delivery_dead_letter_v1","event_type":"fund_transaction.status_changed","resource_id":"demo_fund_usdt_withdrawal_processing_v1","status":"processing","occurred_at":"2026-08-02T00:55:00.000Z"}',
    'v1', 'dead_letter', 5, NULL, '2026-08-02T01:10:00.000Z', 503,
    '[DEMO] Endpoint returned HTTP 503 after five attempts',
    '2026-08-02T00:55:00.000Z', '2026-08-02T01:10:00.000Z', NULL
  ),
  (
    'demo_webhook_delivery_suppressed_v1', 'ethan',
    'webhook.test', 'webhook', 'demo_webhook_test_v1', NULL, 'suppressed',
    'https://webhook-demo.example/events',
    '{"event_id":"demo_webhook_delivery_suppressed_v1","event_type":"webhook.test","resource_id":"demo_webhook_test_v1","status":"suppressed","occurred_at":"2026-08-01T09:00:00.000Z"}',
    'v1', 'suppressed', 0, NULL, NULL, NULL,
    '[DEMO] Delivery suppressed after configuration change',
    '2026-08-01T09:00:00.000Z', '2026-08-01T09:00:00.000Z', NULL
  );
