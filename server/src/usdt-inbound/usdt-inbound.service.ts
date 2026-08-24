import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requireOrganizationAccess } from '../common/tenant-access';
import { PrismaService } from '../prisma/prisma.service';

const sources = ['ON_CHAIN', 'LOCAL_OTC'] as const;
const statuses = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXCEPTION'] as const;

type InboundSource = (typeof sources)[number];
type InboundStatus = (typeof statuses)[number];

type ListFilters = {
  organizationId: string;
  source?: string;
  status?: string;
  customerId?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

type InboundRow = {
  id: string;
  source: InboundSource;
  customer_id: string;
  customer_name: string;
  status: InboundStatus;
  amount: string;
  asset: 'USDT';
  network: 'TRON';
  occurred_at: Date | string;
  completed_at: Date | string | null;
  reference: string;
  tx_hash: string | null;
  from_address: string | null;
  to_address: string | null;
  source_currency: string | null;
  source_amount: string | null;
  rate: string | null;
  custody_status: string | null;
  accounting_status: string | null;
  exception_reason: string | null;
  core_operation_id: string | null;
  total_count: bigint;
  chain_count: bigint;
  otc_count: bigint;
  completed_count: bigint;
  processing_count: bigint;
  attention_count: bigint;
};

@Injectable()
export class UsdtInboundService {
  constructor(private readonly db: PrismaService) {}

  async list(filters: ListFilters, userId: string) {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('invalid_usdt_inbound_limit');
    }
    if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) {
      throw new BadRequestException('invalid_usdt_inbound_offset');
    }
    if (filters.source && !sources.includes(filters.source as InboundSource)) {
      throw new BadRequestException('invalid_usdt_inbound_source');
    }
    if (filters.status && !statuses.includes(filters.status as InboundStatus)) {
      throw new BadRequestException('invalid_usdt_inbound_status');
    }
    await requireOrganizationAccess(this.db, userId, filters.organizationId);

    const tenantId = process.env.NEOBANK_SOURCE_TENANT_ID?.trim() || 'neobank';
    const sourceFilter = filters.source
      ? Prisma.sql`AND inbound.source=${filters.source}`
      : Prisma.empty;
    const statusFilter = filters.status
      ? Prisma.sql`AND inbound.status=${filters.status}`
      : Prisma.empty;
    const customerFilter = filters.customerId
      ? Prisma.sql`AND inbound.customer_id=${filters.customerId}`
      : Prisma.empty;
    const keyword = filters.search?.trim().slice(0, 120);
    const searchFilter = keyword
      ? Prisma.sql`AND (
          inbound.customer_name ILIKE ${`%${keyword}%`}
          OR inbound.reference ILIKE ${`%${keyword}%`}
          OR COALESCE(inbound.tx_hash, '') ILIKE ${`%${keyword}%`}
        )`
      : Prisma.empty;

    const [custodySchema] = await this.db.$queryRaw<Array<{ available: boolean }>>(Prisma.sql`
      SELECT
        to_regclass('public.cregis_deposits') IS NOT NULL
        AND to_regclass('public.cregis_wallets') IS NOT NULL
        AND to_regclass('public.cregis_deposit_accounting') IS NOT NULL AS available
    `);
    const chainRecords = custodySchema?.available
      ? Prisma.sql`
          SELECT
            d.id,
            'ON_CHAIN'::text AS source,
            wallet.customer_id,
            customer."displayName" AS customer_name,
            CASE
              WHEN d.status='failed' THEN 'FAILED'
              WHEN accounting.status='posted' THEN 'COMPLETED'
              WHEN accounting.status='exception' THEN 'EXCEPTION'
              WHEN accounting.status='held' THEN 'PENDING'
              ELSE 'PROCESSING'
            END::text AS status,
            d.amount_text AS amount,
            'USDT'::text AS asset,
            'TRON'::text AS network,
            d.received_at::timestamptz AS occurred_at,
            CASE WHEN accounting.status='posted' THEN accounting.posted_at ELSE NULL END AS completed_at,
            d.cregis_cid AS reference,
            d.txid AS tx_hash,
            d.from_address,
            d.address AS to_address,
            NULL::text AS source_currency,
            NULL::text AS source_amount,
            NULL::text AS rate,
            d.status AS custody_status,
            COALESCE(accounting.status, 'missing') AS accounting_status,
            accounting.last_error_code AS exception_reason,
            accounting.core_operation_id
          FROM cregis_deposits d
          JOIN cregis_wallets wallet
            ON wallet.id=d.wallet_id AND wallet.tenant_id=d.tenant_id
          JOIN "Customer" customer ON customer.id=wallet.customer_id
          LEFT JOIN cregis_deposit_accounting accounting
            ON accounting.deposit_id=d.id AND accounting.tenant_id=d.tenant_id
          WHERE d.tenant_id=${tenantId} AND customer."organizationId"=${filters.organizationId}
        `
      : Prisma.sql`
          SELECT
            transfer.id,
            'ON_CHAIN'::text AS source,
            transfer."customerId" AS customer_id,
            customer."displayName" AS customer_name,
            CASE
              WHEN transfer.status='COMPLETED' THEN 'COMPLETED'
              WHEN transfer.status='PROCESSING' THEN 'PROCESSING'
              WHEN transfer.status IN ('REJECTED', 'FAILED') THEN 'FAILED'
              ELSE 'PENDING'
            END::text AS status,
            transfer.amount::text AS amount,
            'USDT'::text AS asset,
            'TRON'::text AS network,
            transfer."createdAt" AS occurred_at,
            transfer."completedAt" AS completed_at,
            transfer.reference,
            transfer."txHash" AS tx_hash,
            transfer."fromAddress" AS from_address,
            transfer."toAddress" AS to_address,
            NULL::text AS source_currency,
            NULL::text AS source_amount,
            NULL::text AS rate,
            lower(transfer.status::text) AS custody_status,
            CASE WHEN transfer.status='COMPLETED' THEN 'posted' ELSE lower(transfer.status::text) END AS accounting_status,
            transfer."rejectionReason" AS exception_reason,
            operation.id AS core_operation_id
          FROM "CryptoTransfer" transfer
          JOIN "Customer" customer ON customer.id=transfer."customerId"
          LEFT JOIN "Operation" operation
            ON operation.metadata->>'custodyTransferId'=transfer.id
            OR operation.metadata->>'cryptoTransferId'=transfer.id
          WHERE customer."organizationId"=${filters.organizationId}
            AND transfer.direction='DEPOSIT'
            AND transfer.asset='USDT'
            AND transfer.network='TRON'
        `;

    const rows = await this.db.$queryRaw<InboundRow[]>(Prisma.sql`
      WITH inbound AS (
        ${chainRecords}

        UNION ALL

        SELECT
          operation.id,
          'LOCAL_OTC'::text AS source,
          operation."customerId" AS customer_id,
          customer."displayName" AS customer_name,
          CASE
            WHEN operation.status='COMPLETED' THEN 'COMPLETED'
            WHEN operation.status='PROCESSING' THEN 'PROCESSING'
            WHEN operation.status IN ('FAILED', 'REJECTED', 'CANCELLED') THEN 'FAILED'
            ELSE 'PENDING'
          END::text AS status,
          operation."quoteAmount"::text AS amount,
          'USDT'::text AS asset,
          'TRON'::text AS network,
          operation."createdAt" AS occurred_at,
          CASE WHEN operation.status='COMPLETED' THEN operation."executedAt" ELSE NULL END AS completed_at,
          operation.reference,
          NULL::text AS tx_hash,
          NULL::text AS from_address,
          target."walletAddress" AS to_address,
          operation.currency::text AS source_currency,
          operation.amount::text AS source_amount,
          operation.rate::text,
          NULL::text AS custody_status,
          CASE WHEN operation.status='COMPLETED' THEN 'posted' ELSE lower(operation.status::text) END AS accounting_status,
          CASE WHEN operation.status IN ('FAILED', 'REJECTED', 'CANCELLED')
            THEN COALESCE(operation."rejectionReason", lower(operation.status::text)) ELSE NULL END AS exception_reason,
          operation.id AS core_operation_id
        FROM "Operation" operation
        JOIN "Customer" customer ON customer.id=operation."customerId"
        LEFT JOIN "Account" target ON target.id=operation."targetAccountId"
        WHERE customer."organizationId"=${filters.organizationId}
          AND operation.type='OTC'
          AND operation.status<>'DRAFT'
          AND operation."quoteCurrency"='USDT'
          AND operation."quoteAmount" IS NOT NULL
      )
      SELECT inbound.*,
        COUNT(*) OVER() AS total_count,
        COUNT(*) FILTER (WHERE inbound.source='ON_CHAIN') OVER() AS chain_count,
        COUNT(*) FILTER (WHERE inbound.source='LOCAL_OTC') OVER() AS otc_count,
        COUNT(*) FILTER (WHERE inbound.status='COMPLETED') OVER() AS completed_count,
        COUNT(*) FILTER (WHERE inbound.status IN ('PENDING', 'PROCESSING')) OVER() AS processing_count,
        COUNT(*) FILTER (WHERE inbound.status IN ('FAILED', 'EXCEPTION')) OVER() AS attention_count
      FROM inbound
      WHERE TRUE ${sourceFilter} ${statusFilter} ${customerFilter} ${searchFilter}
      ORDER BY inbound.occurred_at DESC, inbound.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const first = rows[0];
    return {
      data: rows.map((row) => ({
        id: row.id,
        source: row.source,
        customerId: row.customer_id,
        customerName: row.customer_name,
        status: row.status,
        amount: row.amount,
        asset: row.asset,
        network: row.network,
        occurredAt: row.occurred_at,
        completedAt: row.completed_at,
        reference: row.reference,
        txHash: row.tx_hash,
        fromAddress: row.from_address,
        toAddress: row.to_address,
        sourceCurrency: row.source_currency,
        sourceAmount: row.source_amount,
        rate: row.rate,
        custodyStatus: row.custody_status,
        accountingStatus: row.accounting_status,
        exceptionReason: row.exception_reason,
        coreOperationId: row.core_operation_id,
      })),
      pagination: { total: Number(first?.total_count || 0), limit, offset },
      summary: {
        chain: Number(first?.chain_count || 0),
        localOtc: Number(first?.otc_count || 0),
        completed: Number(first?.completed_count || 0),
        processing: Number(first?.processing_count || 0),
        attention: Number(first?.attention_count || 0),
      },
    };
  }
}
