import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { syncNeobankCustomers } from '../customers/neobank-customer-sync';
import { isValidTronAddress } from '../crypto-wallets/tron-address';
import { PrismaService } from '../prisma/prisma.service';

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 8;
const STALE_LOCK_MS = 5 * 60 * 1000;
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 5 * 60_000, 15 * 60_000];

type QueueStatus =
  | 'pending_reservation'
  | 'reserving'
  | 'pending_approval'
  | 'approving'
  | 'pending_release'
  | 'releasing'
  | 'pending_settlement'
  | 'settling';

type ClaimedWithdrawal = { withdrawal_id: string; status: QueueStatus };

type WithdrawalRow = {
  withdrawal_id: string;
  tenant_id: string;
  customer_id: string;
  accounting_status: QueueStatus | 'reserved' | 'approved' | 'released' | 'settled' | 'exception';
  attempt_count: number;
  core_operation_id: string | null;
  core_transfer_id: string | null;
  withdrawal_status: string;
  currency: string;
  amount_text: string;
  amount_minor: bigint | number | string;
  fee_amount_text: string;
  fee_amount_minor: bigint | number | string;
  net_amount_text: string;
  net_amount_minor: bigint | number | string;
  from_address: string;
  to_address: string;
  txid: string | null;
  maker_id: string;
  checker_id: string | null;
  operator_id: string | null;
  rejection_reason: string | null;
  reconciliation_note: string | null;
  approved_at: string | null;
  completed_at: string | null;
  wallet_customer_id: string;
  wallet_address: string;
  wallet_status: string;
  custody_provider: string | null;
  ownership_verified_at: string | null;
  customer_status: string;
  kyc_status: string;
  operations_status: string;
};

type AccountingError = Error & { code?: string; retryable?: boolean };

function accountingError(code: string, retryable: boolean): AccountingError {
  return Object.assign(new Error(code), { code, retryable });
}

@Injectable()
export class WithdrawalAccountingWorker {
  private readonly logger = new Logger(WithdrawalAccountingWorker.name);
  private stopping = false;
  private wake?: () => void;

  constructor(private readonly db: PrismaService) {}

  async run() {
    const pollIntervalMs = this.pollIntervalMs();
    this.logger.log(JSON.stringify({ event: 'withdrawal_accounting_worker_started' }));
    while (!this.stopping) {
      const processed = await this.processBatch();
      if (!processed) await this.sleep(pollIntervalMs);
    }
    this.logger.log(JSON.stringify({ event: 'withdrawal_accounting_worker_stopped' }));
  }

  stop() {
    this.stopping = true;
    this.wake?.();
  }

  async processBatch() {
    const rows = await this.claimBatch();
    for (const [index, row] of rows.entries()) {
      if (this.stopping) {
        await this.releaseClaims(rows.slice(index));
        break;
      }
      await this.processWithdrawal(row.withdrawal_id, row.status);
    }
    return rows.length;
  }

  async processWithdrawal(withdrawalId: string, status?: QueueStatus) {
    try {
      const currentStatus = status || (await this.currentProcessingStatus(withdrawalId));
      if (!currentStatus) return;
      if (currentStatus === 'reserving') {
        await this.ensureCoreCustomer(withdrawalId);
        await this.withSerializableRetry(() => this.reserve(withdrawalId));
      } else if (currentStatus === 'approving') {
        await this.withSerializableRetry(() => this.approve(withdrawalId));
      } else if (currentStatus === 'releasing') {
        await this.withSerializableRetry(() => this.releaseFunds(withdrawalId));
      } else if (currentStatus === 'settling') {
        await this.withSerializableRetry(() => this.settle(withdrawalId));
      }
      this.logger.log(
        JSON.stringify({
          event: 'cregis_withdrawal_accounting_advanced',
          withdrawal_id: withdrawalId,
          from_status: currentStatus,
        })
      );
    } catch (caught) {
      const error = this.normalizeError(caught);
      await this.recordFailure(withdrawalId, error);
      this.logger.error(
        JSON.stringify({
          event: 'cregis_withdrawal_accounting_failed',
          withdrawal_id: withdrawalId,
          code: error.code,
          retryable: error.retryable,
        })
      );
    }
  }

  private async claimBatch() {
    const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE cregis_withdrawal_accounting
        SET status=CASE status
              WHEN 'reserving' THEN 'pending_reservation'
              WHEN 'approving' THEN 'pending_approval'
              WHEN 'releasing' THEN 'pending_release'
              WHEN 'settling' THEN 'pending_settlement'
              ELSE status
            END,
            locked_at=NULL, next_attempt_at=NOW(), updated_at=NOW()
        WHERE status IN ('reserving', 'approving', 'releasing', 'settling')
          AND locked_at < ${staleBefore}
      `;
      const rows = await tx.$queryRaw<ClaimedWithdrawal[]>(Prisma.sql`
        SELECT withdrawal_id, status
        FROM cregis_withdrawal_accounting
        WHERE status IN (
          'pending_reservation', 'pending_approval', 'pending_release', 'pending_settlement'
        ) AND next_attempt_at <= NOW()
        ORDER BY created_at ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `);
      const claimed: ClaimedWithdrawal[] = [];
      for (const row of rows) {
        const processingStatus = this.processingStatus(row.status);
        const changed = await tx.$executeRaw`
          UPDATE cregis_withdrawal_accounting
          SET status=${processingStatus}, locked_at=NOW(), updated_at=NOW()
          WHERE withdrawal_id=${row.withdrawal_id} AND status=${row.status}
        `;
        if (changed !== 1) throw accountingError('withdrawal_claim_conflict', true);
        claimed.push({ withdrawal_id: row.withdrawal_id, status: processingStatus });
      }
      return claimed;
    });
  }

  private async releaseClaims(rows: ClaimedWithdrawal[]) {
    for (const row of rows) {
      await this.db.$executeRaw`
        UPDATE cregis_withdrawal_accounting
        SET status=${this.pendingStatus(row.status)}, locked_at=NULL,
            next_attempt_at=NOW(), updated_at=NOW()
        WHERE withdrawal_id=${row.withdrawal_id} AND status=${row.status}
      `;
    }
  }

  private async currentProcessingStatus(withdrawalId: string) {
    const rows = await this.db.$queryRaw<Array<{ status: QueueStatus }>>`
      SELECT status FROM cregis_withdrawal_accounting
      WHERE withdrawal_id=${withdrawalId}
        AND status IN ('reserving', 'approving', 'releasing', 'settling')
    `;
    return rows.length === 1 ? rows[0].status : null;
  }

  private async ensureCoreCustomer(withdrawalId: string) {
    const rows = await this.db.$queryRaw<Array<{ customer_id: string; tenant_id: string }>>`
      SELECT customer_id, tenant_id
      FROM cregis_withdrawal_accounting
      WHERE withdrawal_id=${withdrawalId} AND status='reserving'
    `;
    if (!rows.length) return;
    if (rows.length !== 1 || rows[0].tenant_id !== this.tenantId()) {
      throw accountingError('withdrawal_tenant_mismatch', false);
    }
    const existing = await this.db.customer.findUnique({ where: { id: rows[0].customer_id } });
    if (
      existing?.organizationId === this.organizationId() &&
      existing.status === 'ACTIVE' &&
      existing.kycStatus === 'APPROVED'
    ) {
      return;
    }
    await syncNeobankCustomers(this.db, {
      adminUserId: this.adminUserId(),
      organizationId: this.organizationId(),
      tenantId: this.tenantId(),
      customerId: rows[0].customer_id,
    });
  }

  private reserve(withdrawalId: string) {
    return this.db.$transaction(
      async (tx) => {
        const row = await this.load(tx, withdrawalId, 'reserving');
        this.validateCustody(row, ['submitted'], true);
        const amounts = this.amounts(row);
        const [customer, admin, accounts, wallet] = await Promise.all([
          tx.customer.findUnique({ where: { id: row.customer_id } }),
          tx.user.findUnique({ where: { id: this.adminUserId() } }),
          tx.account.findMany({
            where: {
              customerId: row.customer_id,
              kind: 'CRYPTO_WALLET',
              currency: 'USDT',
              network: 'TRON',
            },
          }),
          tx.cryptoWallet.findUnique({
            where: {
              customerId_asset_network: {
                customerId: row.customer_id,
                asset: 'USDT',
                network: 'TRON',
              },
            },
          }),
        ]);
        if (
          !customer ||
          customer.organizationId !== this.organizationId() ||
          customer.status !== 'ACTIVE' ||
          customer.kycStatus !== 'APPROVED'
        ) {
          throw accountingError('core_customer_not_ready', true);
        }
        if (
          !admin?.active ||
          admin.role !== 'ADMIN' ||
          admin.organizationId !== this.organizationId()
        ) {
          throw accountingError('core_accounting_admin_not_ready', true);
        }
        if (accounts.length !== 1 || accounts[0].status !== 'ACTIVE') {
          throw accountingError('core_crypto_account_not_ready', true);
        }
        if (!wallet || wallet.status !== 'ACTIVE') {
          throw accountingError('core_crypto_wallet_not_ready', true);
        }
        if (
          accounts[0].walletAddress !== row.wallet_address ||
          wallet.walletAddress !== row.wallet_address
        ) {
          throw accountingError('core_crypto_wallet_binding_conflict', false);
        }
        const reference = `CREGIS-WD-${row.tenant_id}-${row.withdrawal_id}`;
        const idempotencyKey = `cregis-withdrawal:${row.tenant_id}:${row.withdrawal_id}`;
        const duplicate = await tx.operation.findFirst({
          where: {
            OR: [
              { reference },
              { customerId: row.customer_id, idempotencyKey },
              { metadata: { path: ['custodyWithdrawalId'], equals: row.withdrawal_id } },
            ],
          },
        });
        if (duplicate) throw accountingError('core_withdrawal_duplicate', false);

        const coreWalletFrozen = await tx.cryptoWallet.updateMany({
          where: {
            id: wallet.id,
            status: 'ACTIVE',
            availableBalance: { gte: amounts.total },
          },
          data: {
            availableBalance: { decrement: amounts.total },
            frozenBalance: { increment: amounts.total },
            version: { increment: 1 },
          },
        });
        if (coreWalletFrozen.count !== 1) {
          throw accountingError('insufficient_core_crypto_balance', false);
        }
        const mirrorFrozen = await tx.account.updateMany({
          where: {
            id: accounts[0].id,
            status: 'ACTIVE',
            availableBalance: { gte: amounts.total },
          },
          data: {
            availableBalance: { decrement: amounts.total },
            frozenBalance: { increment: amounts.total },
            version: { increment: 1 },
          },
        });
        if (mirrorFrozen.count !== 1) {
          throw accountingError('crypto_account_mirror_balance_mismatch', false);
        }

        const coreId = randomUUID();
        const transfer = await tx.cryptoTransfer.create({
          data: {
            id: coreId,
            reference: `${reference}-TRANSFER`,
            idempotencyKey,
            customerId: row.customer_id,
            walletId: wallet.id,
            asset: 'USDT',
            network: 'TRON',
            direction: 'WITHDRAWAL',
            status: 'SUBMITTED',
            amount: amounts.total,
            feeAmount: amounts.fee,
            netAmount: amounts.net,
            fromAddress: row.from_address,
            toAddress: row.to_address,
            makerId: admin.id,
          },
        });
        const operation = await tx.operation.create({
          data: {
            id: coreId,
            reference,
            idempotencyKey,
            customerId: row.customer_id,
            type: 'PAYOUT',
            status: 'SUBMITTED',
            currency: 'USDT',
            amount: amounts.net,
            feeAmount: amounts.fee,
            sourceAccountId: accounts[0].id,
            makerId: admin.id,
            narrative: `Cregis USDT TRON withdrawal ${row.withdrawal_id}`,
            submittedAt: new Date(),
            metadata: {
              custodyRail: 'CREGIS',
              cryptoTransferId: transfer.id,
              custodyWithdrawalId: row.withdrawal_id,
              custodyMakerId: row.maker_id,
            },
          },
        });
        const changed = await tx.$executeRaw`
          UPDATE cregis_withdrawal_accounting
          SET status='reserved', core_operation_id=${operation.id},
              core_transfer_id=${transfer.id}, reserved_at=NOW(), locked_at=NULL,
              last_error_code=NULL, last_error_at=NULL, updated_at=NOW()
          WHERE withdrawal_id=${row.withdrawal_id} AND tenant_id=${row.tenant_id}
            AND status='reserving'
        `;
        if (changed !== 1) throw accountingError('withdrawal_reservation_state_conflict', true);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  private approve(withdrawalId: string) {
    return this.db.$transaction(
      async (tx) => {
        const row = await this.load(tx, withdrawalId, 'approving');
        this.validateCustody(row, ['approved'], true);
        if (!row.core_operation_id || !row.core_transfer_id || !row.checker_id) {
          throw accountingError('withdrawal_approval_link_missing', false);
        }
        const checker = await this.coreActor(tx, row.checker_id, true);
        const approvedAt = this.date(row.approved_at, 'withdrawal_approved_at_invalid');
        const operation = await tx.operation.updateMany({
          where: { id: row.core_operation_id, status: 'SUBMITTED' },
          data: { status: 'PROCESSING', checkerId: checker.id, approvedAt },
        });
        const transfer = await tx.cryptoTransfer.updateMany({
          where: { id: row.core_transfer_id, status: 'SUBMITTED' },
          data: { status: 'PROCESSING', checkerId: checker.id, approvedAt },
        });
        if (operation.count !== 1 || transfer.count !== 1) {
          throw accountingError('core_withdrawal_approval_conflict', false);
        }
        const changed = await tx.$executeRaw`
          UPDATE cregis_withdrawal_accounting
          SET status='approved', locked_at=NULL, last_error_code=NULL,
              last_error_at=NULL, updated_at=NOW()
          WHERE withdrawal_id=${row.withdrawal_id} AND status='approving'
        `;
        if (changed !== 1) throw accountingError('withdrawal_approval_state_conflict', true);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  private releaseFunds(withdrawalId: string) {
    return this.db.$transaction(
      async (tx) => {
        const row = await this.load(tx, withdrawalId, 'releasing');
        this.validateCustody(row, ['rejected', 'failed', 'cancelled'], false);
        if (!row.core_operation_id && !row.core_transfer_id) {
          const changed = await tx.$executeRaw`
            UPDATE cregis_withdrawal_accounting
            SET status='released', released_at=NOW(), locked_at=NULL,
                last_error_code=NULL, last_error_at=NULL, updated_at=NOW()
            WHERE withdrawal_id=${row.withdrawal_id} AND status='releasing'
              AND core_operation_id IS NULL AND core_transfer_id IS NULL
          `;
          if (changed !== 1) throw accountingError('withdrawal_release_state_conflict', true);
          return;
        }
        if (!row.core_operation_id || !row.core_transfer_id) {
          throw accountingError('withdrawal_release_link_conflict', false);
        }
        const amounts = this.amounts(row);
        const [operation, transfer] = await Promise.all([
          tx.operation.findUnique({ where: { id: row.core_operation_id } }),
          tx.cryptoTransfer.findUnique({ where: { id: row.core_transfer_id } }),
        ]);
        if (!operation || !transfer || operation.id !== transfer.id) {
          throw accountingError('core_withdrawal_link_conflict', false);
        }
        const actorIdentity = row.operator_id || row.checker_id;
        if (!actorIdentity) throw accountingError('withdrawal_release_actor_missing', false);
        const actor = await this.coreActor(tx, actorIdentity, false);
        const reason =
          row.rejection_reason?.trim() ||
          row.reconciliation_note?.trim() ||
          `Cregis withdrawal ${row.withdrawal_status}`;

        const walletReleased = await tx.cryptoWallet.updateMany({
          where: { id: transfer.walletId, frozenBalance: { gte: amounts.total } },
          data: {
            availableBalance: { increment: amounts.total },
            frozenBalance: { decrement: amounts.total },
            version: { increment: 1 },
          },
        });
        const mirrorReleased = await tx.account.updateMany({
          where: { id: operation.sourceAccountId || '', frozenBalance: { gte: amounts.total } },
          data: {
            availableBalance: { increment: amounts.total },
            frozenBalance: { decrement: amounts.total },
            version: { increment: 1 },
          },
        });
        if (walletReleased.count !== 1 || mirrorReleased.count !== 1) {
          throw accountingError('core_withdrawal_release_balance_conflict', false);
        }
        if (operation.status === 'SUBMITTED' && transfer.status === 'SUBMITTED') {
          await tx.operation.update({
            where: { id: operation.id },
            data: {
              status: 'REJECTED',
              checkerId: actor.id,
              rejectionReason: reason,
              approvedAt: new Date(),
            },
          });
          await tx.cryptoTransfer.update({
            where: { id: transfer.id },
            data: {
              status: 'REJECTED',
              checkerId: actor.id,
              rejectionReason: reason,
              approvedAt: new Date(),
            },
          });
        } else if (operation.status === 'PROCESSING' && transfer.status === 'PROCESSING') {
          await tx.operation.update({
            where: { id: operation.id },
            data: { status: 'FAILED', operatorId: actor.id, rejectionReason: reason },
          });
          await tx.cryptoTransfer.update({
            where: { id: transfer.id },
            data: { status: 'FAILED', operatorId: actor.id, rejectionReason: reason },
          });
        } else {
          throw accountingError('core_withdrawal_release_status_conflict', false);
        }
        const changed = await tx.$executeRaw`
          UPDATE cregis_withdrawal_accounting
          SET status='released', released_at=NOW(), locked_at=NULL,
              last_error_code=NULL, last_error_at=NULL, updated_at=NOW()
          WHERE withdrawal_id=${row.withdrawal_id} AND status='releasing'
        `;
        if (changed !== 1) throw accountingError('withdrawal_release_state_conflict', true);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  private settle(withdrawalId: string) {
    return this.db.$transaction(
      async (tx) => {
        const row = await this.load(tx, withdrawalId, 'settling');
        this.validateCustody(row, ['completed'], false);
        if (!row.core_operation_id || !row.core_transfer_id || !row.operator_id) {
          throw accountingError('withdrawal_settlement_link_missing', false);
        }
        if (!row.txid || !/^[a-fA-F0-9]{64}$/.test(row.txid)) {
          throw accountingError('withdrawal_settlement_txid_invalid', false);
        }
        const amounts = this.amounts(row);
        const [operation, transfer, actor, clearingAccounts, feeAccounts] = await Promise.all([
          tx.operation.findUnique({ where: { id: row.core_operation_id } }),
          tx.cryptoTransfer.findUnique({ where: { id: row.core_transfer_id } }),
          this.coreActor(tx, row.operator_id, false),
          tx.account.findMany({
            where: { kind: 'PLATFORM_CLEARING', currency: 'USDT', status: 'ACTIVE' },
          }),
          tx.account.findMany({
            where: { kind: 'FEE_REVENUE', currency: 'USDT', status: 'ACTIVE' },
          }),
        ]);
        if (
          !operation ||
          !transfer ||
          operation.id !== transfer.id ||
          operation.status !== 'PROCESSING' ||
          transfer.status !== 'PROCESSING' ||
          !operation.sourceAccountId ||
          clearingAccounts.length !== 1 ||
          (!amounts.fee.isZero() && feeAccounts.length !== 1)
        ) {
          throw accountingError('core_withdrawal_settlement_conflict', false);
        }
        const clearing = clearingAccounts[0];
        const feeAccount = feeAccounts[0];
        const walletConsumed = await tx.cryptoWallet.updateMany({
          where: { id: transfer.walletId, frozenBalance: { gte: amounts.total } },
          data: { frozenBalance: { decrement: amounts.total }, version: { increment: 1 } },
        });
        const mirrorConsumed = await tx.account.updateMany({
          where: { id: operation.sourceAccountId, frozenBalance: { gte: amounts.total } },
          data: { frozenBalance: { decrement: amounts.total }, version: { increment: 1 } },
        });
        if (walletConsumed.count !== 1 || mirrorConsumed.count !== 1) {
          throw accountingError('core_withdrawal_settlement_balance_conflict', false);
        }
        await tx.journalEntry.create({
          data: {
            reference: `${operation.reference}-principal`,
            operationId: operation.id,
            description: operation.narrative || `USDT withdrawal ${row.withdrawal_id}`,
            lines: {
              create: [
                {
                  accountId: operation.sourceAccountId,
                  side: 'DEBIT',
                  currency: 'USDT',
                  amount: amounts.net,
                },
                {
                  accountId: clearing.id,
                  side: 'CREDIT',
                  currency: 'USDT',
                  amount: amounts.net,
                },
              ],
            },
          },
        });
        if (!amounts.fee.isZero() && feeAccount) {
          await tx.journalEntry.create({
            data: {
              reference: `${operation.reference}-fee`,
              operationId: operation.id,
              description: `USDT TRON withdrawal fee ${row.withdrawal_id}`,
              lines: {
                create: [
                  {
                    accountId: operation.sourceAccountId,
                    side: 'DEBIT',
                    currency: 'USDT',
                    amount: amounts.fee,
                  },
                  {
                    accountId: feeAccount.id,
                    side: 'CREDIT',
                    currency: 'USDT',
                    amount: amounts.fee,
                  },
                ],
              },
            },
          });
        }
        const completedAt = this.date(row.completed_at, 'withdrawal_completed_at_invalid');
        await tx.operation.update({
          where: { id: operation.id },
          data: {
            status: 'COMPLETED',
            operatorId: actor.id,
            externalReference: row.txid.toLowerCase(),
            executedAt: completedAt,
          },
        });
        await tx.cryptoTransfer.update({
          where: { id: transfer.id },
          data: {
            status: 'COMPLETED',
            operatorId: actor.id,
            txHash: row.txid.toLowerCase(),
            confirmations: 20,
            completedAt,
          },
        });
        const changed = await tx.$executeRaw`
          UPDATE cregis_withdrawal_accounting
          SET status='settled', posted_at=${completedAt}, locked_at=NULL,
              last_error_code=NULL, last_error_at=NULL, updated_at=NOW()
          WHERE withdrawal_id=${row.withdrawal_id} AND status='settling'
        `;
        if (changed !== 1) throw accountingError('withdrawal_settlement_state_conflict', true);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  private async load(tx: Prisma.TransactionClient, withdrawalId: string, status: QueueStatus) {
    const rows = await tx.$queryRaw<WithdrawalRow[]>(Prisma.sql`
      SELECT
        a.withdrawal_id,
        a.tenant_id,
        a.customer_id,
        a.status AS accounting_status,
        a.attempt_count,
        a.core_operation_id,
        a.core_transfer_id,
        x.status AS withdrawal_status,
        x.currency,
        x.amount_text,
        x.amount_minor,
        x.fee_amount_text,
        x.fee_amount_minor,
        x.net_amount_text,
        x.net_amount_minor,
        x.from_address,
        x.to_address,
        x.txid,
        x.maker_id,
        x.checker_id,
        x.operator_id,
        x.rejection_reason,
        x.reconciliation_note,
        x.approved_at,
        x.completed_at,
        w.customer_id AS wallet_customer_id,
        w.address AS wallet_address,
        w.status AS wallet_status,
        w.custody_provider,
        w.ownership_verified_at,
        c.status AS customer_status,
        c.kyc_status,
        c.operations_status
      FROM cregis_withdrawal_accounting a
      JOIN cregis_withdrawals x
        ON x.id=a.withdrawal_id AND x.tenant_id=a.tenant_id
      JOIN cregis_wallets w
        ON w.id=x.wallet_id AND w.tenant_id=x.tenant_id
      JOIN customers c
        ON c.id=a.customer_id AND c.tenant_id=a.tenant_id
      WHERE a.withdrawal_id=${withdrawalId} AND a.status=${status}
      FOR UPDATE OF a
    `);
    if (rows.length !== 1) throw accountingError('withdrawal_accounting_state_conflict', false);
    return rows[0];
  }

  private validateCustody(
    row: WithdrawalRow,
    allowedStatuses: string[],
    requireOperationalCustomer: boolean
  ) {
    if (row.tenant_id !== this.tenantId()) {
      throw accountingError('withdrawal_tenant_mismatch', false);
    }
    if (row.customer_id !== row.wallet_customer_id) {
      throw accountingError('withdrawal_wallet_customer_mismatch', false);
    }
    if (
      !allowedStatuses.includes(row.withdrawal_status) ||
      row.custody_provider !== 'cregis' ||
      !row.ownership_verified_at
    ) {
      throw accountingError('withdrawal_custody_state_invalid', false);
    }
    if (
      requireOperationalCustomer &&
      (row.wallet_status !== 'active' ||
        row.customer_status !== 'active' ||
        row.kyc_status !== 'approved' ||
        row.operations_status !== 'active')
    ) {
      throw accountingError('withdrawal_customer_not_operational', false);
    }
    if (
      row.currency !== '195@TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' ||
      row.from_address !== row.wallet_address ||
      !isValidTronAddress(row.from_address) ||
      !isValidTronAddress(row.to_address)
    ) {
      throw accountingError('withdrawal_asset_or_address_invalid', false);
    }
  }

  private amounts(row: WithdrawalRow) {
    try {
      const total = new Prisma.Decimal(row.amount_text);
      const fee = new Prisma.Decimal(row.fee_amount_text);
      const net = new Prisma.Decimal(row.net_amount_text);
      const totalMinor = new Prisma.Decimal(row.amount_minor.toString());
      const feeMinor = new Prisma.Decimal(row.fee_amount_minor.toString());
      const netMinor = new Prisma.Decimal(row.net_amount_minor.toString());
      if (
        !total.isPositive() ||
        fee.isNegative() ||
        !net.isPositive() ||
        total.decimalPlaces() > 6 ||
        fee.decimalPlaces() > 6 ||
        net.decimalPlaces() > 6 ||
        !total.equals(fee.add(net)) ||
        !total.mul(1_000_000).equals(totalMinor) ||
        !fee.mul(1_000_000).equals(feeMinor) ||
        !net.mul(1_000_000).equals(netMinor)
      ) {
        throw new Error('invalid amount');
      }
      return { total, fee, net };
    } catch {
      throw accountingError('withdrawal_amount_invalid', false);
    }
  }

  private async coreActor(tx: Prisma.TransactionClient, identity: string, requireActive: boolean) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT core_user.id
      FROM admin_users admin_user
      JOIN "User" core_user ON core_user.id=admin_user.core_user_id
      WHERE LOWER(admin_user.email)=LOWER(${identity})
        AND core_user."organizationId"=${this.organizationId()}
        AND (${requireActive}=FALSE OR (
          admin_user.status='active' AND core_user.active=TRUE AND core_user.role='ADMIN'
        ))
    `);
    if (rows.length !== 1) throw accountingError('core_withdrawal_actor_not_ready', true);
    return rows[0];
  }

  private date(value: string | null, code: string) {
    if (!value) throw accountingError(code, false);
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw accountingError(code, false);
    return parsed;
  }

  private async withSerializableRetry(operation: () => Promise<unknown>) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await operation();
      } catch (caught) {
        lastError = caught;
        if (!this.isSerializableConflict(caught)) throw caught;
      }
    }
    throw lastError;
  }

  private async recordFailure(
    withdrawalId: string,
    error: Required<Pick<AccountingError, 'code' | 'retryable'>>
  ) {
    const rows = await this.db.$queryRaw<Array<{ attempt_count: number; status: QueueStatus }>>`
      SELECT attempt_count, status
      FROM cregis_withdrawal_accounting
      WHERE withdrawal_id=${withdrawalId}
        AND status IN ('reserving', 'approving', 'releasing', 'settling')
    `;
    if (rows.length !== 1) return;
    const attemptCount = rows[0].attempt_count + 1;
    const terminal = !error.retryable || attemptCount >= MAX_ATTEMPTS;
    const delay = RETRY_DELAYS_MS[Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)];
    const nextAttemptAt = new Date(Date.now() + delay);
    await this.db.$executeRaw`
      UPDATE cregis_withdrawal_accounting
      SET status=${terminal ? 'exception' : this.pendingStatus(rows[0].status)},
          attempt_count=attempt_count+1, next_attempt_at=${nextAttemptAt},
          locked_at=NULL, last_error_code=${error.code}, last_error_at=NOW(), updated_at=NOW()
      WHERE withdrawal_id=${withdrawalId} AND status=${rows[0].status}
    `;
  }

  private processingStatus(status: QueueStatus): QueueStatus {
    const mapping: Record<string, QueueStatus> = {
      pending_reservation: 'reserving',
      pending_approval: 'approving',
      pending_release: 'releasing',
      pending_settlement: 'settling',
    };
    const next = mapping[status];
    if (!next) throw accountingError('withdrawal_queue_status_invalid', false);
    return next;
  }

  private pendingStatus(status: QueueStatus): QueueStatus {
    const mapping: Record<string, QueueStatus> = {
      reserving: 'pending_reservation',
      approving: 'pending_approval',
      releasing: 'pending_release',
      settling: 'pending_settlement',
    };
    const next = mapping[status];
    if (!next) throw accountingError('withdrawal_processing_status_invalid', false);
    return next;
  }

  private normalizeError(caught: unknown): Required<Pick<AccountingError, 'code' | 'retryable'>> {
    if (caught instanceof Error) {
      const known = caught as AccountingError;
      if (known.code && typeof known.retryable === 'boolean') {
        return { code: known.code, retryable: known.retryable };
      }
      if (this.isSerializableConflict(caught)) {
        return { code: 'withdrawal_serialization_conflict', retryable: true };
      }
    }
    return { code: 'withdrawal_accounting_unavailable', retryable: true };
  }

  private isSerializableConflict(caught: unknown) {
    return caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2034';
  }

  private tenantId() {
    return process.env.NEOBANK_SOURCE_TENANT_ID?.trim() || 'neobank';
  }

  private organizationId() {
    return process.env.CORE_ORGANIZATION_ID?.trim() || 'org_neobank';
  }

  private adminUserId() {
    return process.env.CORE_ADMIN_USER_ID?.trim() || 'usr_neobank_admin';
  }

  private pollIntervalMs() {
    const parsed = Number(process.env.WITHDRAWAL_ACCOUNTING_POLL_INTERVAL_MS || 3000);
    return Number.isFinite(parsed) ? Math.min(60_000, Math.max(1000, parsed)) : 3000;
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    }).finally(() => {
      this.wake = undefined;
    });
  }
}
