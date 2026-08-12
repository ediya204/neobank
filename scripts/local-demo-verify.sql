PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS local_demo_assertions;

CREATE TABLE local_demo_assertions (
  passed INTEGER NOT NULL CHECK (passed = 1),
  assertion_name TEXT NOT NULL
);

INSERT INTO local_demo_assertions
SELECT COUNT(*) = 3, 'local fund transaction count'
FROM fund_transactions
WHERE id LIKE 'local_history_%';

INSERT INTO local_demo_assertions
SELECT COUNT(*) = 2, 'local OTC order count'
FROM otc_orders
WHERE id LIKE 'local_history_%';

INSERT INTO local_demo_assertions
SELECT COUNT(*) = 7, 'local ledger entry count'
FROM ledger_entries
WHERE id LIKE 'local_history_%';

INSERT INTO local_demo_assertions
SELECT COUNT(*) = 1, 'local webhook request count'
FROM partner_webhook_requests
WHERE id = 'demo_webhook_request_approved_v1';

INSERT INTO local_demo_assertions
SELECT COUNT(*) = 7, 'local webhook delivery count'
FROM webhook_deliveries
WHERE id LIKE 'demo_webhook_delivery_%';

INSERT INTO local_demo_assertions
SELECT COUNT(*) = 1, 'webhook fund resource exists'
FROM webhook_deliveries AS delivery
JOIN fund_transactions AS transaction_record
  ON transaction_record.id = delivery.resource_id
WHERE delivery.id = 'demo_webhook_delivery_fund_v1';

INSERT INTO local_demo_assertions
SELECT NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check), 'foreign key check';

SELECT assertion_name, 'ok' AS result
FROM local_demo_assertions
ORDER BY assertion_name;

DROP TABLE local_demo_assertions;
