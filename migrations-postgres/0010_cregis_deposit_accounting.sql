BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cregis_deposits_tenant_id_id
  ON cregis_deposits (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_id_id
  ON customers (tenant_id, id);

-- A signed Cregis callback proves an external custody event. It must not become
-- customer-available money until Core has posted the matching double-entry
-- journal. This table is the durable hand-off between those two responsibilities.
CREATE TABLE IF NOT EXISTS cregis_deposit_accounting (
  deposit_id TEXT PRIMARY KEY REFERENCES cregis_deposits(id),
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('held', 'pending', 'processing', 'posted', 'exception')),
  enqueue_source TEXT NOT NULL DEFAULT 'callback'
    CHECK (enqueue_source IN ('callback', 'manual_reconciliation')),
  enqueued_by TEXT NOT NULL DEFAULT 'cregis_callback',
  reconciliation_reason TEXT,
  backup_sha256 TEXT,
  restore_tested_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  core_operation_id TEXT,
  last_error_code TEXT,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, deposit_id),
  FOREIGN KEY (tenant_id, deposit_id) REFERENCES cregis_deposits(tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  FOREIGN KEY (core_operation_id) REFERENCES "Operation"(id),
  CHECK (
    (status = 'posted' AND posted_at IS NOT NULL AND core_operation_id IS NOT NULL)
    OR (status <> 'posted' AND posted_at IS NULL AND core_operation_id IS NULL)
  ),
  CHECK (
    (enqueue_source = 'callback' AND enqueued_by = 'cregis_callback'
      AND reconciliation_reason IS NULL AND backup_sha256 IS NULL
      AND restore_tested_at IS NULL)
    OR (enqueue_source = 'manual_reconciliation'
      AND length(trim(enqueued_by)) >= 3
      AND length(trim(reconciliation_reason)) >= 10
      AND backup_sha256 ~ '^[0-9a-f]{64}$'
      AND restore_tested_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_cregis_deposit_accounting_queue
  ON cregis_deposit_accounting (status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_cregis_deposit_accounting_customer
  ON cregis_deposit_accounting (tenant_id, customer_id, created_at DESC);

-- A transaction hash is an external settlement reference, not a display label.
-- Reusing it for another completed deposit would permit a second credit.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cregis_deposits
    WHERE status = 'completed' AND txid IS NOT NULL
    GROUP BY tenant_id, txid
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate completed Cregis deposit transaction hashes require reconciliation';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cregis_deposits_tenant_completed_txid
  ON cregis_deposits (tenant_id, txid)
  WHERE status = 'completed' AND txid IS NOT NULL;

-- Deliberately do not backfill existing deposits here. Historical credits need
-- an operator-reviewed reconciliation preview and an explicit callback replay;
-- applying a schema migration must never move customer money by itself.

INSERT INTO neobank_schema_migrations (version)
VALUES ('0010_cregis_deposit_accounting')
ON CONFLICT (version) DO NOTHING;

COMMIT;
