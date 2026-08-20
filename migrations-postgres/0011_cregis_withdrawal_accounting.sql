BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cregis_withdrawals_tenant_id_id
  ON cregis_withdrawals (tenant_id, id);

-- The customer request and Cregis payout state are custody workflow facts. Core
-- remains the money authority: a withdrawal cannot be approved for submission
-- until this hand-off has created the matching Core reservation.
CREATE TABLE IF NOT EXISTS cregis_withdrawal_accounting (
  withdrawal_id TEXT PRIMARY KEY REFERENCES cregis_withdrawals(id),
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'pending_reservation'
    CHECK (status IN (
      'held',
      'pending_reservation', 'reserving', 'reserved',
      'pending_approval', 'approving', 'approved',
      'pending_release', 'releasing', 'released',
      'pending_settlement', 'settling', 'settled',
      'exception'
    )),
  enqueue_source TEXT NOT NULL DEFAULT 'customer_request'
    CHECK (enqueue_source IN ('customer_request', 'manual_reconciliation')),
  enqueued_by TEXT NOT NULL DEFAULT 'customer_request',
  reconciliation_reason TEXT,
  backup_sha256 TEXT,
  restore_tested_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  core_operation_id TEXT,
  core_transfer_id TEXT,
  reserved_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, withdrawal_id),
  FOREIGN KEY (tenant_id, withdrawal_id) REFERENCES cregis_withdrawals(tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id),
  FOREIGN KEY (core_operation_id) REFERENCES "Operation"(id),
  FOREIGN KEY (core_transfer_id) REFERENCES "CryptoTransfer"(id),
  CHECK (
    (core_operation_id IS NULL AND core_transfer_id IS NULL)
    OR (core_operation_id IS NOT NULL AND core_transfer_id IS NOT NULL)
  ),
  CHECK (
    (status = 'settled' AND posted_at IS NOT NULL AND released_at IS NULL
      AND core_operation_id IS NOT NULL)
    OR (status = 'released' AND released_at IS NOT NULL AND posted_at IS NULL)
    OR (status NOT IN ('settled', 'released') AND posted_at IS NULL AND released_at IS NULL)
  ),
  CHECK (
    (enqueue_source = 'customer_request' AND enqueued_by = 'customer_request'
      AND reconciliation_reason IS NULL AND backup_sha256 IS NULL
      AND restore_tested_at IS NULL)
    OR (enqueue_source = 'manual_reconciliation'
      AND length(trim(enqueued_by)) >= 3
      AND length(trim(reconciliation_reason)) >= 10
      AND backup_sha256 ~ '^[0-9a-f]{64}$'
      AND restore_tested_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_cregis_withdrawal_accounting_queue
  ON cregis_withdrawal_accounting (status, next_attempt_at, created_at)
  WHERE status IN (
    'pending_reservation', 'reserving',
    'pending_approval', 'approving',
    'pending_release', 'releasing',
    'pending_settlement', 'settling'
  );
CREATE INDEX IF NOT EXISTS idx_cregis_withdrawal_accounting_customer
  ON cregis_withdrawal_accounting (tenant_id, customer_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cregis_withdrawals
    WHERE status = 'completed' AND txid IS NOT NULL
    GROUP BY tenant_id, txid
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate completed Cregis withdrawal transaction hashes require reconciliation';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cregis_withdrawals_tenant_completed_txid
  ON cregis_withdrawals (tenant_id, txid)
  WHERE status = 'completed' AND txid IS NOT NULL;

-- Deliberately do not enqueue historical withdrawals. They must be reconciled
-- in exact custody order after backup, checksum, isolated restore test, and
-- explicit approval. A schema migration must never reserve or move money.

INSERT INTO neobank_schema_migrations (version)
VALUES ('0011_cregis_withdrawal_accounting')
ON CONFLICT (version) DO NOTHING;

COMMIT;
