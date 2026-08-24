import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  parseWithdrawalReconciliationArguments,
  validateHistoricalWithdrawalRelease,
  WithdrawalCoreMatch,
  WithdrawalReconciliationCandidate,
  withdrawalReconciliationApproval,
} from './withdrawal-reconciliation-policy';

const db = new PrismaClient();

type ReconciliationDb = PrismaClient | Prisma.TransactionClient;

async function candidates(
  client: ReconciliationDb,
  tenantId: string,
  withdrawalId?: string,
  lock = false
) {
  const idFilter = withdrawalId
    ? Prisma.sql`AND x.id=${withdrawalId}`
    : Prisma.sql`AND a.withdrawal_id IS NULL
        AND EXISTS (
          SELECT 1 FROM cregis_callback_events candidate_event
          WHERE candidate_event.event_type='payout'
            AND candidate_event.cregis_cid=x.cregis_cid
            AND candidate_event.status IN ('2','4','7')
        )`;
  const lockClause = lock ? Prisma.sql`FOR UPDATE OF x` : Prisma.empty;
  return client.$queryRaw<WithdrawalReconciliationCandidate[]>(Prisma.sql`
    SELECT
      x.id AS withdrawal_id,
      x.tenant_id,
      x.customer_id,
      x.wallet_id,
      x.third_party_id,
      x.currency,
      x.amount_text,
      x.fee_amount_text,
      x.net_amount_text,
      x.from_address,
      x.to_address,
      x.status AS custody_status,
      x.cregis_cid,
      x.txid,
      x.completed_at,
      x.maker_id,
      x.checker_id,
      x.operator_id,
      w.customer_id AS wallet_customer_id,
      w.address AS wallet_address,
      w.status AS wallet_status,
      w.custody_provider,
      w.ownership_verified_at,
      a.status AS accounting_status,
      a.core_operation_id,
      a.core_transfer_id,
      a.enqueue_source,
      a.enqueued_by,
      a.reconciliation_reason,
      a.backup_sha256,
      a.restore_tested_at,
      EXISTS (
        SELECT 1 FROM cregis_callback_events rejected_event
        WHERE rejected_event.event_type='payout'
          AND rejected_event.cregis_cid=x.cregis_cid
          AND rejected_event.status IN ('2','4')
      ) AS callback_rejected,
      EXISTS (
        SELECT 1 FROM cregis_callback_events failed_event
        WHERE failed_event.event_type='payout'
          AND failed_event.cregis_cid=x.cregis_cid
          AND failed_event.status='7'
      ) AS callback_failed,
      EXISTS (
        SELECT 1 FROM cregis_callback_events completed_event
        WHERE completed_event.event_type='payout'
          AND completed_event.cregis_cid=x.cregis_cid
          AND completed_event.status='6'
      ) AS callback_completed
    FROM cregis_withdrawals x
    JOIN cregis_wallets w ON w.id=x.wallet_id AND w.tenant_id=x.tenant_id
    LEFT JOIN cregis_withdrawal_accounting a
      ON a.withdrawal_id=x.id AND a.tenant_id=x.tenant_id
    WHERE x.tenant_id=${tenantId}
      ${idFilter}
    ORDER BY x.created_at ASC
    LIMIT 100
    ${lockClause}
  `);
}

async function coreMatches(
  client: ReconciliationDb,
  candidate: WithdrawalReconciliationCandidate,
  lock = false
) {
  const reference = `CREGIS-WD-${candidate.tenant_id}-${candidate.withdrawal_id}`;
  const idempotencyKey = `cregis-withdrawal:${candidate.tenant_id}:${candidate.withdrawal_id}`;
  const lockClause = lock ? Prisma.sql`FOR UPDATE OF operation` : Prisma.empty;
  return client.$queryRaw<WithdrawalCoreMatch[]>(Prisma.sql`
    SELECT
      operation.id AS operation_id,
      operation."customerId" AS operation_customer_id,
      operation.status::text AS operation_status,
      operation.type::text AS operation_type,
      operation.currency::text AS operation_currency,
      operation.amount AS operation_amount,
      operation."feeAmount" AS operation_fee_amount,
      operation."sourceAccountId" AS operation_source_account_id,
      operation."externalReference" AS operation_external_reference,
      operation.metadata->>'custodyRail' AS custody_rail,
      operation.metadata->>'custodyWithdrawalId' AS custody_withdrawal_id,
      transfer.id AS transfer_id,
      transfer."customerId" AS transfer_customer_id,
      transfer."walletId" AS transfer_wallet_id,
      transfer.asset::text AS transfer_asset,
      transfer.network::text AS transfer_network,
      transfer.direction::text AS transfer_direction,
      transfer.status::text AS transfer_status,
      transfer.amount AS transfer_amount,
      transfer."feeAmount" AS transfer_fee_amount,
      transfer."netAmount" AS transfer_net_amount,
      transfer."fromAddress" AS transfer_from_address,
      transfer."toAddress" AS transfer_to_address,
      transfer."txHash" AS transfer_tx_hash,
      source.id AS account_id,
      source."customerId" AS account_customer_id,
      source.kind::text AS account_kind,
      source.currency::text AS account_currency,
      source.network AS account_network,
      source."walletAddress" AS account_wallet_address,
      source."availableBalance" AS account_available_balance,
      source."frozenBalance" AS account_frozen_balance,
      wallet.id AS core_wallet_id,
      wallet."customerId" AS core_wallet_customer_id,
      wallet.asset::text AS core_wallet_asset,
      wallet.network::text AS core_wallet_network,
      wallet."walletAddress" AS core_wallet_address,
      wallet."availableBalance" AS core_wallet_available_balance,
      wallet."frozenBalance" AS core_wallet_frozen_balance,
      (SELECT COUNT(*) FROM "JournalEntry" journal WHERE journal."operationId"=operation.id) AS journal_count
    FROM "Operation" operation
    LEFT JOIN "CryptoTransfer" transfer
      ON transfer.id=COALESCE(operation.metadata->>'cryptoTransferId', operation.id)
    LEFT JOIN "Account" source ON source.id=operation."sourceAccountId"
    LEFT JOIN "CryptoWallet" wallet ON wallet.id=transfer."walletId"
    WHERE operation."customerId"=${candidate.customer_id}
      AND (
        operation.metadata->>'custodyWithdrawalId'=${candidate.withdrawal_id}
        OR operation.reference=${reference}
        OR operation."idempotencyKey"=${idempotencyKey}
      )
    ORDER BY operation."createdAt" ASC
    ${lockClause}
  `);
}

async function exactCandidate(
  client: ReconciliationDb,
  tenantId: string,
  withdrawalId: string,
  lock = false
) {
  const rows = await candidates(client, tenantId, withdrawalId, lock);
  if (rows.length !== 1 || rows[0].withdrawal_id !== withdrawalId) {
    throw new Error('exact historical withdrawal not found');
  }
  return rows[0];
}

async function preview(tenantId: string, withdrawalId?: string) {
  const rows = await candidates(db, tenantId, withdrawalId);
  const withdrawals = [];
  for (const row of rows) {
    const matches = await coreMatches(db, row);
    let decision: unknown;
    try {
      decision = validateHistoricalWithdrawalRelease(row, matches);
    } catch (caught) {
      decision = { blocked: caught instanceof Error ? caught.message : 'unknown validation error' };
    }
    withdrawals.push({ custody: row, coreMatches: matches, decision });
  }
  return withdrawals;
}

async function hold(tenantId: string, withdrawalId: string) {
  const approval = withdrawalReconciliationApproval(process.env);
  return db.$transaction(
    async (tx) => {
      const row = await exactCandidate(tx, tenantId, withdrawalId, true);
      if (row.accounting_status) throw new Error('withdrawal already has an accounting state');
      const matches = await coreMatches(tx, row, true);
      const decision = validateHistoricalWithdrawalRelease(row, matches);
      const changed = await tx.$executeRaw`
        INSERT INTO cregis_withdrawal_accounting
          (withdrawal_id, tenant_id, customer_id, status, enqueue_source, enqueued_by,
           reconciliation_reason, backup_sha256, restore_tested_at, attempt_count,
           next_attempt_at, core_operation_id, core_transfer_id, created_at, updated_at)
        VALUES
          (${row.withdrawal_id}, ${row.tenant_id}, ${row.customer_id}, 'held',
           'manual_reconciliation', ${approval.approvedBy}, ${approval.reason},
           ${approval.backupSha256}, NOW(), 0, NOW(), ${decision.coreOperationId},
           ${decision.coreTransferId}, NOW(), NOW())
        ON CONFLICT (withdrawal_id) DO NOTHING
      `;
      if (changed !== 1) throw new Error('withdrawal reconciliation hold conflict');
      return { decision, approval };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

async function release(tenantId: string, withdrawalId: string) {
  const approval = withdrawalReconciliationApproval(process.env, true);
  return db.$transaction(
    async (tx) => {
      const row = await exactCandidate(tx, tenantId, withdrawalId, true);
      if (
        row.accounting_status !== 'held' ||
        row.enqueue_source !== 'manual_reconciliation' ||
        row.enqueued_by !== approval.approvedBy ||
        row.reconciliation_reason !== approval.reason ||
        row.backup_sha256 !== approval.backupSha256 ||
        !row.restore_tested_at
      ) {
        throw new Error('exact held reconciliation not found or approval changed');
      }
      const matches = await coreMatches(tx, row, true);
      const decision = validateHistoricalWithdrawalRelease(row, matches);
      if (
        row.core_operation_id !== decision.coreOperationId ||
        row.core_transfer_id !== decision.coreTransferId
      ) {
        throw new Error('Core withdrawal link changed after hold');
      }
      const custodyChanged = await tx.$executeRaw`
        UPDATE cregis_withdrawals
        SET status=${decision.resolution}, reconciliation_note=${approval.reason},
            reconciled_by=${approval.approvedBy}, reconciled_at=NOW(), updated_at=NOW()
        WHERE id=${withdrawalId} AND tenant_id=${tenantId}
          AND status IN ('exception','submitted_to_cregis',${decision.resolution})
          AND txid IS NULL
      `;
      if (custodyChanged !== 1) throw new Error('withdrawal custody release state conflict');
      const accountingChanged = await tx.$executeRaw`
        UPDATE cregis_withdrawal_accounting
        SET status='pending_release', next_attempt_at=NOW(), locked_at=NULL,
            last_error_code=NULL, last_error_at=NULL, updated_at=NOW()
        WHERE withdrawal_id=${withdrawalId} AND tenant_id=${tenantId}
          AND status='held' AND enqueue_source='manual_reconciliation'
          AND enqueued_by=${approval.approvedBy}
          AND reconciliation_reason=${approval.reason}
          AND backup_sha256=${approval.backupSha256}
          AND restore_tested_at IS NOT NULL
      `;
      if (accountingChanged !== 1) throw new Error('withdrawal release queue conflict');
      return { decision, approval };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

function safeJSON(value: unknown) {
  return JSON.stringify(
    value,
    (_key, current) => (typeof current === 'bigint' ? current.toString() : current),
    2
  );
}

async function main() {
  const { action, withdrawalId } = parseWithdrawalReconciliationArguments(process.argv.slice(2));
  const tenantId = process.env.NEOBANK_SOURCE_TENANT_ID?.trim() || 'neobank';
  if (action === 'preview') {
    const withdrawals = await preview(tenantId, withdrawalId);
    console.log(safeJSON({ action, tenantId, count: withdrawals.length, withdrawals }));
    return;
  }
  const result =
    action === 'hold'
      ? await hold(tenantId, withdrawalId!)
      : await release(tenantId, withdrawalId!);
  console.log(
    safeJSON({
      action,
      tenantId,
      withdrawalId,
      status: action === 'hold' ? 'held' : 'pending_release',
      releaseMode: result.decision.releaseMode,
      resolution: result.decision.resolution,
      coreOperationId: result.decision.coreOperationId,
      approvedBy: result.approval.approvedBy,
      backupSha256: result.approval.backupSha256,
    })
  );
}

main()
  .catch((caught) => {
    console.error(caught instanceof Error ? caught.message : 'withdrawal reconciliation failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
