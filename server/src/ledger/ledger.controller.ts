import { Controller, Get, Query, Req } from '@nestjs/common';
import { Currency, Prisma } from '@prisma/client';
import type { Request } from 'express';
import { currentUserId } from '../common/current-user';
import { requireOrganizationAccess } from '../common/tenant-access';
import { PrismaService } from '../prisma/prisma.service';
import { ReconciliationIssueForTriage, triageReconciliationIssue } from './reconciliation-triage';

type ReconciliationIssue = ReconciliationIssueForTriage & {
  id: string;
  core_operation_id: string | null;
};

@Controller('ledger')
export class LedgerController {
  constructor(private readonly db: PrismaService) {}

  @Get('reconciliation/usdt')
  async reconcileUsdt(@Query('organizationId') organizationId: string, @Req() request: Request) {
    await requireOrganizationAccess(this.db, currentUserId(request), organizationId);
    const tenantId = process.env.NEOBANK_SOURCE_TENANT_ID?.trim() || 'neobank';
    const [custodySchema] = await this.db.$queryRaw<Array<{ available: boolean }>>(Prisma.sql`
      SELECT
        to_regclass('public.cregis_deposits') IS NOT NULL
        AND to_regclass('public.cregis_deposit_accounting') IS NOT NULL
        AND to_regclass('public.cregis_withdrawals') IS NOT NULL
        AND to_regclass('public.cregis_withdrawal_accounting') IS NOT NULL
        AND to_regclass('public.cregis_callback_events') IS NOT NULL AS available
    `);
    const emptyReconciliationIssues = Prisma.sql`
      SELECT NULL::text AS id, 'core'::text AS direction,
        'unavailable'::text AS custody_status, 'unavailable'::text AS accounting_status,
        NULL::text AS core_operation_id, 'custody_schema_unavailable'::text AS reason
      WHERE FALSE
    `;
    const [depositIssues, withdrawalIssues, coreIssues, balanceIssues] = await Promise.all([
      this.db.$queryRaw<ReconciliationIssue[]>(
        custodySchema?.available
          ? Prisma.sql`
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
            `
          : emptyReconciliationIssues
      ),
      this.db.$queryRaw<ReconciliationIssue[]>(
        custodySchema?.available
          ? Prisma.sql`
              SELECT x.id, 'withdrawal' AS direction, x.status AS custody_status,
                COALESCE(a.status, 'missing') AS accounting_status,
                a.core_operation_id,
                CASE
                  WHEN a.withdrawal_id IS NULL THEN 'accounting_intent_missing'
                  WHEN a.status='exception' THEN COALESCE(a.last_error_code, 'accounting_exception')
                  WHEN x.status='completed' THEN 'completed_custody_not_settled'
                  WHEN x.status IN ('rejected','failed','cancelled') THEN 'terminal_custody_not_released'
                  ELSE 'custody_accounting_state_mismatch'
                END AS reason,
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
            `
          : emptyReconciliationIssues
      ),
      this.db.$queryRaw<ReconciliationIssue[]>(
        custodySchema?.available
          ? Prisma.sql`
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
            `
          : emptyReconciliationIssues
      ),
      this.db.$queryRaw<ReconciliationIssue[]>(Prisma.sql`
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
    const priorityOrder = { critical: 0, high: 1, monitor: 2 } as const;
    const issues = [...depositIssues, ...withdrawalIssues, ...coreIssues, ...balanceIssues]
      .map((issue) => ({ ...issue, ...triageReconciliationIssue(issue) }))
      .sort(
        (left, right) =>
          priorityOrder[left.resolution_priority] - priorityOrder[right.resolution_priority]
      );
    return {
      checkedAt: new Date().toISOString(),
      tenantId,
      checksComplete: custodySchema?.available === true,
      unavailableChecks: custodySchema?.available ? [] : ['cregis_custody_accounting'],
      issueCount:
        depositIssues.length + withdrawalIssues.length + coreIssues.length + balanceIssues.length,
      truncated:
        depositIssues.length === 100 ||
        withdrawalIssues.length === 100 ||
        coreIssues.length === 100 ||
        balanceIssues.length === 100,
      issues,
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
