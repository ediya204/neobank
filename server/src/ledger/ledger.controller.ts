import { Controller, Get, Query, Req } from '@nestjs/common';
import { Currency, Prisma } from '@prisma/client';
import type { Request } from 'express';
import { currentUserId } from '../common/current-user';
import { requireOrganizationAccess } from '../common/tenant-access';
import { PrismaService } from '../prisma/prisma.service';

@Controller('ledger')
export class LedgerController {
  constructor(private readonly db: PrismaService) {}

  @Get('reconciliation/usdt')
  async reconcileUsdt(@Query('organizationId') organizationId: string, @Req() request: Request) {
    await requireOrganizationAccess(this.db, currentUserId(request), organizationId);
    const tenantId = process.env.NEOBANK_SOURCE_TENANT_ID?.trim() || 'neobank';
    const [depositIssues, withdrawalIssues, coreIssues, balanceIssues] = await Promise.all([
      this.db.$queryRaw<
        Array<{
          id: string;
          direction: 'deposit';
          custody_status: string;
          accounting_status: string;
          core_operation_id: string | null;
          reason: string;
        }>
      >(Prisma.sql`
        SELECT d.id, 'deposit' AS direction, d.status AS custody_status,
          COALESCE(a.status, 'missing') AS accounting_status,
          a.core_operation_id,
          CASE
            WHEN a.deposit_id IS NULL THEN 'accounting_intent_missing'
            WHEN a.status='exception' THEN COALESCE(a.last_error_code, 'accounting_exception')
            ELSE 'completed_custody_not_posted'
          END AS reason
        FROM cregis_deposits d
        LEFT JOIN cregis_deposit_accounting a
          ON a.deposit_id=d.id AND a.tenant_id=d.tenant_id
        WHERE d.tenant_id=${tenantId} AND d.status='completed'
          AND (a.deposit_id IS NULL OR a.status<>'posted')
        ORDER BY d.received_at ASC
        LIMIT 100
      `),
      this.db.$queryRaw<
        Array<{
          id: string;
          direction: 'withdrawal';
          custody_status: string;
          accounting_status: string;
          core_operation_id: string | null;
          reason: string;
        }>
      >(Prisma.sql`
        SELECT x.id, 'withdrawal' AS direction, x.status AS custody_status,
          COALESCE(a.status, 'missing') AS accounting_status,
          a.core_operation_id,
          CASE
            WHEN a.withdrawal_id IS NULL THEN 'accounting_intent_missing'
            WHEN a.status='exception' THEN COALESCE(a.last_error_code, 'accounting_exception')
            WHEN x.status='completed' THEN 'completed_custody_not_settled'
            WHEN x.status IN ('rejected','failed','cancelled') THEN 'terminal_custody_not_released'
            ELSE 'custody_accounting_state_mismatch'
          END AS reason
        FROM cregis_withdrawals x
        LEFT JOIN cregis_withdrawal_accounting a
          ON a.withdrawal_id=x.id AND a.tenant_id=x.tenant_id
        WHERE x.tenant_id=${tenantId} AND (
          a.withdrawal_id IS NULL OR a.status='exception'
          OR (x.status='completed' AND a.status<>'settled')
          OR (x.status IN ('rejected','failed','cancelled') AND a.status<>'released')
          OR (x.status='submitted' AND a.status NOT IN (
            'pending_reservation','reserving','reserved','pending_approval','approving'
          ))
          OR (x.status='approved' AND a.status NOT IN ('pending_approval','approving','approved'))
          OR (x.status IN ('executing','submitted_to_cregis') AND a.status<>'approved')
        )
        ORDER BY x.created_at ASC
        LIMIT 100
      `),
      this.db.$queryRaw<
        Array<{
          id: string;
          direction: 'core';
          custody_status: string;
          accounting_status: string;
          core_operation_id: string;
          reason: string;
        }>
      >(Prisma.sql`
        SELECT operation.id, 'core' AS direction,
          operation.status::text AS custody_status,
          'missing' AS accounting_status,
          operation.id AS core_operation_id,
          'core_operation_without_custody_handoff' AS reason
        FROM "Operation" operation
        JOIN "Customer" customer ON customer.id=operation."customerId"
        WHERE customer."organizationId"=${organizationId}
          AND operation.metadata->>'custodyRail'='CREGIS'
          AND operation.metadata->>'custodyWithdrawalId' IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM cregis_withdrawal_accounting a
            WHERE a.core_operation_id=operation.id
          )
        ORDER BY operation."createdAt" ASC
        LIMIT 100
      `),
      this.db.$queryRaw<
        Array<{
          id: string;
          direction: 'core';
          custody_status: string;
          accounting_status: string;
          core_operation_id: null;
          reason: string;
        }>
      >(Prisma.sql`
        SELECT wallet.id, 'core' AS direction,
          wallet.status::text AS custody_status,
          'balance_mirror' AS accounting_status,
          NULL::text AS core_operation_id,
          CASE
            WHEN mirror.account_count=0 THEN 'core_crypto_account_missing'
            WHEN mirror.account_count>1 THEN 'core_crypto_account_duplicated'
            ELSE 'core_crypto_materialized_balance_mismatch'
          END AS reason
        FROM "CryptoWallet" wallet
        JOIN "Customer" customer ON customer.id=wallet."customerId"
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS account_count,
            MIN(account."availableBalance") AS available_balance,
            MIN(account."frozenBalance") AS frozen_balance
          FROM "Account" account
          WHERE account."customerId"=wallet."customerId"
            AND account.kind='CRYPTO_WALLET'
            AND account.currency='USDT'
            AND account.network='TRON'
            AND account.status='ACTIVE'
        ) mirror ON TRUE
        WHERE customer."organizationId"=${organizationId}
          AND wallet.asset='USDT' AND wallet.network='TRON' AND wallet.status='ACTIVE'
          AND (
            mirror.account_count<>1
            OR mirror.available_balance IS DISTINCT FROM wallet."availableBalance"
            OR mirror.frozen_balance IS DISTINCT FROM wallet."frozenBalance"
          )
        ORDER BY wallet."createdAt" ASC
        LIMIT 100
      `),
    ]);
    return {
      checkedAt: new Date().toISOString(),
      tenantId,
      issueCount:
        depositIssues.length + withdrawalIssues.length + coreIssues.length + balanceIssues.length,
      truncated:
        depositIssues.length === 100 ||
        withdrawalIssues.length === 100 ||
        coreIssues.length === 100 ||
        balanceIssues.length === 100,
      issues: [...depositIssues, ...withdrawalIssues, ...coreIssues, ...balanceIssues],
    };
  }

  @Get()
  async list(
    @Query('organizationId') organizationId: string,
    @Req() request: Request,
    @Query('customerId') customerId?: string,
    @Query('currency') currency?: Currency
  ) {
    await requireOrganizationAccess(this.db, currentUserId(request), organizationId);
    return this.db.journalEntry.findMany({
      where: {
        operation: {
          customer: { organizationId },
          ...(customerId ? { customerId } : {}),
          ...(currency ? { currency } : {}),
        },
      },
      include: {
        operation: { include: { customer: true } },
        lines: { include: { account: true } },
      },
      orderBy: { postedAt: 'desc' },
      take: 500,
    });
  }
}
