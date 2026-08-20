import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { syncNeobankCustomers } from '../customers/neobank-customer-sync';

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 8;
const STALE_LOCK_MS = 5 * 60 * 1000;
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 5 * 60_000, 15 * 60_000];

type ClaimedDeposit = { deposit_id: string };

type DepositRow = {
  deposit_id: string;
  tenant_id: string;
  customer_id: string;
  accounting_status: string;
  attempt_count: number;
  cregis_cid: string;
  chain_id: string;
  token_id: string;
  currency: string;
  address: string;
  from_address: string | null;
  amount_text: string;
  amount_minor: bigint | number | string;
  custody_status: string;
  txid: string | null;
  received_at: string;
  raw_sha256: string;
  wallet_customer_id: string;
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
export class DepositAccountingWorker {
  private readonly logger = new Logger(DepositAccountingWorker.name);
  private stopping = false;
  private wake?: () => void;

  constructor(private readonly db: PrismaService) {}

  async run() {
    const pollIntervalMs = this.pollIntervalMs();
    this.logger.log(JSON.stringify({ event: 'deposit_accounting_worker_started' }));
    while (!this.stopping) {
      const processed = await this.processBatch();
      if (!processed) await this.sleep(pollIntervalMs);
    }
    this.logger.log(JSON.stringify({ event: 'deposit_accounting_worker_stopped' }));
  }

  stop() {
    this.stopping = true;
    this.wake?.();
  }

  async processBatch() {
    const rows = await this.claimBatch();
    for (const [index, row] of rows.entries()) {
      if (this.stopping) {
        await this.release(rows.slice(index));
        break;
      }
      await this.processDeposit(row.deposit_id);
    }
    return rows.length;
  }

  async processDeposit(depositId: string) {
    try {
      await this.ensureCoreCustomer(depositId);
      const posted = await this.postWithSerializableRetry(depositId);
      if (posted) {
        this.logger.log(JSON.stringify({ event: 'cregis_deposit_posted', deposit_id: depositId }));
      }
    } catch (caught) {
      const error = this.normalizeError(caught);
      await this.recordFailure(depositId, error);
      this.logger.error(
        JSON.stringify({
          event: 'cregis_deposit_post_failed',
          deposit_id: depositId,
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
        UPDATE cregis_deposit_accounting
        SET status='pending', locked_at=NULL, next_attempt_at=NOW(), updated_at=NOW()
        WHERE status='processing' AND locked_at < ${staleBefore}
      `;
      const rows = await tx.$queryRaw<ClaimedDeposit[]>(Prisma.sql`
        SELECT deposit_id
        FROM cregis_deposit_accounting
        WHERE status='pending' AND next_attempt_at <= NOW()
        ORDER BY created_at ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `);
      for (const row of rows) {
        const changed = await tx.$executeRaw`
          UPDATE cregis_deposit_accounting
          SET status='processing', locked_at=NOW(), updated_at=NOW()
          WHERE deposit_id=${row.deposit_id} AND status='pending'
        `;
        if (changed !== 1) throw accountingError('deposit_claim_conflict', true);
      }
      return rows;
    });
  }

  private async release(rows: ClaimedDeposit[]) {
    for (const row of rows) {
      await this.db.$executeRaw`
        UPDATE cregis_deposit_accounting
        SET status='pending', locked_at=NULL, next_attempt_at=NOW(), updated_at=NOW()
        WHERE deposit_id=${row.deposit_id} AND status='processing'
      `;
    }
  }

  private async ensureCoreCustomer(depositId: string) {
    const source = await this.db.$queryRaw<Array<{ customer_id: string; tenant_id: string }>>`
      SELECT customer_id, tenant_id
      FROM cregis_deposit_accounting
      WHERE deposit_id=${depositId} AND status='processing'
    `;
    if (!source.length) return;
    if (source.length !== 1 || source[0].tenant_id !== this.tenantId()) {
      throw accountingError('deposit_tenant_mismatch', false);
    }
    const existing = await this.db.customer.findUnique({ where: { id: source[0].customer_id } });
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
      customerId: source[0].customer_id,
    });
  }

  private async postWithSerializableRetry(depositId: string) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.postOnce(depositId);
      } catch (caught) {
        lastError = caught;
        if (!this.isSerializableConflict(caught)) throw caught;
      }
    }
    throw lastError;
  }

  private postOnce(depositId: string) {
    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<DepositRow[]>(Prisma.sql`
          SELECT
            a.deposit_id,
            a.tenant_id,
            a.customer_id,
            a.status AS accounting_status,
            a.attempt_count,
            d.cregis_cid,
            d.chain_id,
            d.token_id,
            d.currency,
            d.address,
            d.from_address,
            d.amount_text,
            d.amount_minor,
            d.status AS custody_status,
            d.txid,
            d.received_at,
            d.raw_sha256,
            w.customer_id AS wallet_customer_id,
            w.status AS wallet_status,
            w.custody_provider,
            w.ownership_verified_at,
            c.status AS customer_status,
            c.kyc_status,
            c.operations_status
          FROM cregis_deposit_accounting a
          JOIN cregis_deposits d ON d.id=a.deposit_id AND d.tenant_id=a.tenant_id
          JOIN cregis_wallets w ON w.id=d.wallet_id AND w.tenant_id=d.tenant_id
          JOIN customers c ON c.id=a.customer_id AND c.tenant_id=a.tenant_id
          WHERE a.deposit_id=${depositId} AND a.status='processing'
          FOR UPDATE OF a
        `);
        if (!rows.length) return false;
        if (rows.length !== 1) throw accountingError('deposit_accounting_state_conflict', false);
        const row = rows[0];
        this.validateCustodyRow(row);

        const [customer, admin, accounts, clearingAccounts, wallet] = await Promise.all([
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
          tx.account.findMany({
            where: { kind: 'PLATFORM_CLEARING', currency: 'USDT', status: 'ACTIVE' },
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
        if (accounts.length > 1) throw accountingError('core_crypto_account_conflict', false);
        if (accounts[0] && accounts[0].status !== 'ACTIVE') {
          throw accountingError('core_crypto_account_not_active', false);
        }
        if (accounts[0]?.walletAddress && accounts[0].walletAddress !== row.address) {
          throw accountingError('core_crypto_account_binding_conflict', false);
        }
        if (clearingAccounts.length !== 1) {
          throw accountingError('core_usdt_clearing_not_ready', true);
        }
        if (wallet && (wallet.status !== 'ACTIVE' || wallet.walletAddress !== row.address)) {
          throw accountingError('core_crypto_wallet_binding_conflict', false);
        }

        const amount = this.amount(row);
        const receivedAt = this.date(row.received_at, 'deposit_received_at_invalid');
        const targetAccount =
          accounts[0] ||
          (await tx.account.create({
            data: {
              customerId: row.customer_id,
              kind: 'CRYPTO_WALLET',
              status: 'ACTIVE',
              currency: 'USDT',
              name: 'USDT 钱包（Cregis TRON）',
              accountNumber: `CRYPTO-${row.customer_id}-USDT`,
              walletAddress: row.address,
              network: 'TRON',
            },
          }));
        const coreWallet =
          wallet ||
          (await tx.cryptoWallet.create({
            data: {
              customerId: row.customer_id,
              asset: 'USDT',
              network: 'TRON',
              networkLabel: 'TRON (TRC20)',
              tokenStandard: 'TRC20',
              walletAddress: row.address,
              status: 'ACTIVE',
              confirmationsRequired: 20,
            },
          }));

        const reference = `CREGIS-DEP-${row.tenant_id}-${row.cregis_cid}`;
        const idempotencyKey = `cregis-deposit:${row.tenant_id}:${row.cregis_cid}`;
        const duplicate = await tx.operation.findFirst({
          where: {
            OR: [
              { reference },
              { customerId: row.customer_id, idempotencyKey },
              { externalReference: row.txid || undefined, type: 'DEPOSIT', currency: 'USDT' },
            ],
          },
        });
        if (duplicate) throw accountingError('core_deposit_duplicate', false);

        const transfer = await tx.cryptoTransfer.create({
          data: {
            reference: `${reference}-TRANSFER`,
            idempotencyKey,
            customerId: row.customer_id,
            walletId: coreWallet.id,
            asset: 'USDT',
            network: 'TRON',
            direction: 'DEPOSIT',
            status: 'COMPLETED',
            amount,
            netAmount: amount,
            fromAddress: row.from_address!,
            toAddress: row.address,
            txHash: row.txid,
            confirmations: 20,
            makerId: admin.id,
            checkerId: admin.id,
            operatorId: admin.id,
            submittedAt: receivedAt,
            approvedAt: receivedAt,
            completedAt: receivedAt,
          },
        });
        const operation = await tx.operation.create({
          data: {
            reference,
            idempotencyKey,
            customerId: row.customer_id,
            type: 'DEPOSIT',
            status: 'COMPLETED',
            currency: 'USDT',
            amount,
            targetAccountId: targetAccount.id,
            makerId: admin.id,
            checkerId: admin.id,
            operatorId: admin.id,
            externalReference: row.txid,
            receivedAt,
            submittedAt: receivedAt,
            approvedAt: receivedAt,
            executedAt: receivedAt,
            narrative: `Cregis USDT TRON deposit ${row.cregis_cid}`,
            metadata: {
              custodyRail: 'CREGIS',
              custodyTransferId: transfer.id,
              cregisCid: row.cregis_cid,
              chainId: row.chain_id,
              tokenId: row.token_id,
              rawSha256: row.raw_sha256,
            },
          },
        });
        await tx.account.update({
          where: { id: targetAccount.id },
          data: {
            availableBalance: { increment: amount },
            walletAddress: targetAccount.walletAddress || row.address,
            version: { increment: 1 },
          },
        });
        await tx.cryptoWallet.update({
          where: { id: coreWallet.id },
          data: { availableBalance: { increment: amount }, version: { increment: 1 } },
        });
        await tx.journalEntry.create({
          data: {
            reference: `${reference}-principal`,
            operationId: operation.id,
            description: operation.narrative!,
            postedAt: receivedAt,
            lines: {
              create: [
                {
                  accountId: clearingAccounts[0].id,
                  side: 'DEBIT',
                  currency: 'USDT',
                  amount,
                },
                {
                  accountId: targetAccount.id,
                  side: 'CREDIT',
                  currency: 'USDT',
                  amount,
                },
              ],
            },
          },
        });
        const changed = await tx.$executeRaw`
          UPDATE cregis_deposit_accounting
          SET status='posted', posted_at=NOW(), core_operation_id=${operation.id},
              locked_at=NULL, last_error_code=NULL, last_error_at=NULL, updated_at=NOW()
          WHERE deposit_id=${row.deposit_id} AND tenant_id=${row.tenant_id} AND status='processing'
        `;
        if (changed !== 1) throw accountingError('deposit_post_state_conflict', true);
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  private validateCustodyRow(row: DepositRow) {
    if (row.tenant_id !== this.tenantId()) {
      throw accountingError('deposit_tenant_mismatch', false);
    }
    if (row.customer_id !== row.wallet_customer_id) {
      throw accountingError('deposit_wallet_customer_mismatch', false);
    }
    if (
      row.custody_status !== 'completed' ||
      row.wallet_status !== 'active' ||
      row.custody_provider !== 'cregis' ||
      !row.ownership_verified_at ||
      !row.from_address ||
      !row.txid
    ) {
      throw accountingError('deposit_custody_evidence_incomplete', false);
    }
    if (
      row.currency !== 'USDT' ||
      row.chain_id !== '195' ||
      row.token_id !== 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
    ) {
      throw accountingError('deposit_asset_mismatch', false);
    }
    if (
      row.customer_status !== 'active' ||
      row.kyc_status !== 'approved' ||
      row.operations_status !== 'active'
    ) {
      throw accountingError('deposit_customer_not_active', false);
    }
  }

  private amount(row: DepositRow) {
    let amount: Prisma.Decimal;
    let minor: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(row.amount_text);
      minor = new Prisma.Decimal(row.amount_minor.toString());
    } catch {
      throw accountingError('deposit_amount_invalid', false);
    }
    if (
      !amount.isPositive() ||
      amount.decimalPlaces() > 6 ||
      !amount.mul(1_000_000).equals(minor)
    ) {
      throw accountingError('deposit_amount_invalid', false);
    }
    return amount;
  }

  private date(value: string, code: string) {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw accountingError(code, false);
    return parsed;
  }

  private async recordFailure(
    depositId: string,
    error: Required<Pick<AccountingError, 'code' | 'retryable'>>
  ) {
    const rows = await this.db.$queryRaw<Array<{ attempt_count: number }>>`
      SELECT attempt_count
      FROM cregis_deposit_accounting
      WHERE deposit_id=${depositId} AND status='processing'
    `;
    if (rows.length !== 1) return;
    const attemptCount = rows[0].attempt_count + 1;
    const terminal = !error.retryable || attemptCount >= MAX_ATTEMPTS;
    const delay = RETRY_DELAYS_MS[Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)];
    const nextAttemptAt = new Date(Date.now() + delay);
    await this.db.$executeRaw`
      UPDATE cregis_deposit_accounting
      SET status=${terminal ? 'exception' : 'pending'}, attempt_count=attempt_count+1,
          next_attempt_at=${nextAttemptAt}, locked_at=NULL, last_error_code=${error.code},
          last_error_at=NOW(), updated_at=NOW()
      WHERE deposit_id=${depositId} AND status='processing'
    `;
  }

  private normalizeError(caught: unknown): Required<Pick<AccountingError, 'code' | 'retryable'>> {
    if (caught instanceof Error) {
      const known = caught as AccountingError;
      if (known.code && typeof known.retryable === 'boolean') {
        return { code: known.code, retryable: known.retryable };
      }
      if (this.isSerializableConflict(caught)) {
        return { code: 'deposit_serialization_conflict', retryable: true };
      }
    }
    return { code: 'deposit_accounting_unavailable', retryable: true };
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
    const parsed = Number(process.env.DEPOSIT_ACCOUNTING_POLL_INTERVAL_MS || 3000);
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
