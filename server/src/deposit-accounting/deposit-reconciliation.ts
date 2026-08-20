import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';

const db = new PrismaClient();

type Candidate = {
  deposit_id: string;
  tenant_id: string;
  customer_id: string;
  cregis_cid: string;
  chain_id: string;
  token_id: string;
  txid: string | null;
  amount_text: string;
  currency: string;
  custody_status: string;
  from_address: string | null;
  wallet_status: string;
  custody_provider: string | null;
  ownership_verified_at: string | null;
  customer_status: string;
  kyc_status: string;
  operations_status: string;
  accounting_status: string | null;
  enqueue_source: string | null;
  enqueued_by: string | null;
  reconciliation_reason: string | null;
  backup_sha256: string | null;
  restore_tested_at: Date | null;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function approvedMutation() {
  if (process.env.DEPOSIT_RECONCILIATION_APPROVED !== 'true') {
    throw new Error('DEPOSIT_RECONCILIATION_APPROVED=true is required');
  }
  if (process.env.POSTGRES_RESTORE_TESTED !== 'true') {
    throw new Error('POSTGRES_RESTORE_TESTED=true is required');
  }
  const checksum = required('POSTGRES_BACKUP_SHA256');
  if (!/^[a-f0-9]{64}$/i.test(checksum)) {
    throw new Error('POSTGRES_BACKUP_SHA256 must be a SHA-256 checksum');
  }
  const approvedBy = required('DEPOSIT_RECONCILIATION_APPROVED_BY');
  const reason = required('DEPOSIT_RECONCILIATION_REASON');
  if (approvedBy.length < 3 || reason.length < 10) {
    throw new Error('reconciliation approval identity or reason is too short');
  }
  return { approvedBy, reason, backupSha256: checksum.toLowerCase() };
}

function parseArguments() {
  const args = process.argv.slice(2);
  const action = args[0] || 'preview';
  if (!['preview', 'hold', 'release'].includes(action)) {
    throw new Error('usage: deposit:reconcile [preview|hold|release] [--deposit-id ID]');
  }
  const idIndex = args.indexOf('--deposit-id');
  const depositId = idIndex >= 0 ? args[idIndex + 1]?.trim() : undefined;
  if (idIndex >= 0 && (!depositId || !/^[A-Za-z0-9_-]{1,128}$/.test(depositId))) {
    throw new Error('--deposit-id must be one exact safe identifier');
  }
  if (action !== 'preview' && !depositId) {
    throw new Error(`${action} requires --deposit-id`);
  }
  return { action, depositId };
}

async function candidates(tenantId: string, depositId?: string) {
  const idFilter = depositId ? Prisma.sql`AND d.id=${depositId}` : Prisma.empty;
  return db.$queryRaw<Candidate[]>(Prisma.sql`
    SELECT
      d.id AS deposit_id,
      d.tenant_id,
      w.customer_id,
      d.cregis_cid,
      d.chain_id,
      d.token_id,
      d.txid,
      d.amount_text,
      d.currency,
      d.status AS custody_status,
      d.from_address,
      w.status AS wallet_status,
      w.custody_provider,
      w.ownership_verified_at,
      c.status AS customer_status,
      c.kyc_status,
      c.operations_status,
      a.status AS accounting_status,
      a.enqueue_source,
      a.enqueued_by,
      a.reconciliation_reason,
      a.backup_sha256,
      a.restore_tested_at
    FROM cregis_deposits d
    JOIN cregis_wallets w ON w.id=d.wallet_id AND w.tenant_id=d.tenant_id
    JOIN customers c ON c.id=w.customer_id AND c.tenant_id=d.tenant_id
    LEFT JOIN cregis_deposit_accounting a ON a.deposit_id=d.id AND a.tenant_id=d.tenant_id
    WHERE d.tenant_id=${tenantId} AND d.status='completed'
      ${idFilter}
    ORDER BY d.received_at ASC
  `);
}

function requireSafeCandidate(rows: Candidate[], depositId: string) {
  if (rows.length !== 1 || rows[0].deposit_id !== depositId) {
    throw new Error('exact completed deposit not found');
  }
  const row = rows[0];
  if (
    !row.txid ||
    !row.from_address ||
    row.currency !== 'USDT' ||
    row.chain_id !== '195' ||
    row.token_id !== 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' ||
    row.wallet_status !== 'active' ||
    row.custody_provider !== 'cregis' ||
    !row.ownership_verified_at ||
    row.customer_status !== 'active' ||
    row.kyc_status !== 'approved' ||
    row.operations_status !== 'active'
  ) {
    throw new Error('deposit evidence or customer activation gate is incomplete');
  }
  return row;
}

async function hold(tenantId: string, depositId: string) {
  const approval = approvedMutation();
  return db.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Candidate[]>(Prisma.sql`
        SELECT
          d.id AS deposit_id, d.tenant_id, w.customer_id, d.cregis_cid,
          d.chain_id, d.token_id, d.txid,
          d.amount_text, d.currency, d.status AS custody_status, d.from_address,
          w.status AS wallet_status, w.custody_provider, w.ownership_verified_at,
          c.status AS customer_status, c.kyc_status, c.operations_status,
          a.status AS accounting_status, a.enqueue_source, a.enqueued_by,
          a.reconciliation_reason, a.backup_sha256, a.restore_tested_at
        FROM cregis_deposits d
        JOIN cregis_wallets w ON w.id=d.wallet_id AND w.tenant_id=d.tenant_id
        JOIN customers c ON c.id=w.customer_id AND c.tenant_id=d.tenant_id
        LEFT JOIN cregis_deposit_accounting a ON a.deposit_id=d.id AND a.tenant_id=d.tenant_id
        WHERE d.tenant_id=${tenantId} AND d.id=${depositId} AND d.status='completed'
        FOR UPDATE OF d
      `);
      const row = requireSafeCandidate(rows, depositId);
      if (row.accounting_status) throw new Error('deposit already has an accounting state');
      const changed = await tx.$executeRaw`
        INSERT INTO cregis_deposit_accounting
          (deposit_id, tenant_id, customer_id, status, enqueue_source, enqueued_by,
           reconciliation_reason, backup_sha256, restore_tested_at, attempt_count,
           next_attempt_at, created_at, updated_at)
        VALUES
          (${row.deposit_id}, ${row.tenant_id}, ${row.customer_id}, 'held',
           'manual_reconciliation', ${approval.approvedBy}, ${approval.reason},
           ${approval.backupSha256}, NOW(), 0, NOW(), NOW(), NOW())
        ON CONFLICT (deposit_id) DO NOTHING
      `;
      if (changed !== 1) throw new Error('deposit hold conflict');
      return { row, approval };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

async function release(tenantId: string, depositId: string) {
  const approval = approvedMutation();
  if (process.env.DEPOSIT_RECONCILIATION_RELEASE_APPROVED !== 'true') {
    throw new Error('DEPOSIT_RECONCILIATION_RELEASE_APPROVED=true is required');
  }
  const changed = await db.$executeRaw`
    UPDATE cregis_deposit_accounting
    SET status='pending', next_attempt_at=NOW(), last_error_code=NULL,
        last_error_at=NULL, updated_at=NOW()
    WHERE deposit_id=${depositId} AND tenant_id=${tenantId}
      AND status='held' AND enqueue_source='manual_reconciliation'
      AND enqueued_by=${approval.approvedBy} AND reconciliation_reason=${approval.reason}
      AND backup_sha256=${approval.backupSha256} AND restore_tested_at IS NOT NULL
  `;
  if (changed !== 1) throw new Error('exact held reconciliation not found or approval changed');
  return approval;
}

async function main() {
  const { action, depositId } = parseArguments();
  const tenantId = process.env.NEOBANK_SOURCE_TENANT_ID?.trim() || 'neobank';
  if (action === 'preview') {
    const rows = await candidates(tenantId, depositId);
    console.log(JSON.stringify({ action, tenantId, count: rows.length, deposits: rows }, null, 2));
    return;
  }
  if (action === 'hold') {
    const result = await hold(tenantId, depositId!);
    console.log(
      JSON.stringify({
        action,
        tenantId,
        depositId,
        status: 'held',
        approvedBy: result.approval.approvedBy,
        backupSha256: result.approval.backupSha256,
      })
    );
    return;
  }
  const approval = await release(tenantId, depositId!);
  console.log(
    JSON.stringify({
      action,
      tenantId,
      depositId,
      status: 'pending',
      approvedBy: approval.approvedBy,
      backupSha256: approval.backupSha256,
    })
  );
}

main()
  .catch((caught) => {
    console.error(caught instanceof Error ? caught.message : 'deposit reconciliation failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
