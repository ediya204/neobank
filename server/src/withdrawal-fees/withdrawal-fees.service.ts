import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Currency, Prisma, UserRole } from '@prisma/client';
import {
  requireActiveUser,
  requireCustomerAccess,
  requireOrganizationAccess,
} from '../common/tenant-access';
import { PrismaService } from '../prisma/prisma.service';
import {
  isSupportedFiatCurrency,
  supportedCryptoAsset,
  supportedCryptoNetwork,
} from '../supported-assets';

export const withdrawalAssetClasses = ['FIAT', 'CRYPTO'] as const;
export const withdrawalMethods = ['VA', 'POBO', 'PLATFORM', 'ON_CHAIN'] as const;
export type WithdrawalAssetClass = (typeof withdrawalAssetClasses)[number];
export type WithdrawalMethod = (typeof withdrawalMethods)[number];

export type WithdrawalFeeRuleInput = {
  organizationId: string;
  customerId?: string;
  assetClass: WithdrawalAssetClass;
  currency: Currency;
  method: WithdrawalMethod;
  channelCode: string;
  network?: string;
  amount: string;
  active?: boolean;
};

type FeeRuleClient = Pick<Prisma.TransactionClient, 'withdrawalFeeRule'>;

@Injectable()
export class WithdrawalFeesService {
  constructor(private readonly db: PrismaService) {}

  async list(organizationId: string, userId: string, active?: boolean, customerId?: string) {
    await requireOrganizationAccess(this.db, userId, organizationId);
    if (customerId) {
      const { customer } = await requireCustomerAccess(this.db, userId, customerId);
      if (customer.organizationId !== organizationId) {
        throw new NotFoundException('customer_not_found');
      }
    }
    const defaultScopeId = process.env.NEOBANK_SOURCE_TENANT_ID?.trim() || organizationId;
    const scopeIds = Array.from(
      new Set([organizationId, defaultScopeId, ...(customerId ? [customerId] : [])])
    );
    const rows = await this.db.withdrawalFeeRule.findMany({
      where: {
        organizationId,
        scopeId: { in: scopeIds },
        ...(active === undefined ? {} : { active }),
      },
      orderBy: [
        { assetClass: 'asc' },
        { currency: 'asc' },
        { method: 'asc' },
        { channelCode: 'asc' },
        { network: 'asc' },
      ],
    });
    return rows.map((row) => this.serialize(row, customerId));
  }

  async upsert(input: WithdrawalFeeRuleInput, userId: string) {
    const user = await requireActiveUser(this.db, userId);
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException('admin_role_required');
    if (user.organizationId !== input.organizationId) {
      throw new ForbiddenException('organization_access_denied');
    }
    const scope = await this.normalizeScope(input);
    const feeAmountMinor = this.toMinor(input.amount, scope.feeDecimals);
    let row;
    try {
      row = await this.db.$transaction(
        async (tx) => {
          const existing = await tx.withdrawalFeeRule.findFirst({ where: scope.key });
          if (existing) {
            throw new ConflictException('withdrawal_fee_rule_exists');
          }
          return tx.withdrawalFeeRule.create({
            data: {
              ...scope.key,
              organizationId: input.organizationId,
              feeAmountMinor,
              feeDecimals: scope.feeDecimals,
              active: input.active ?? true,
              createdBy: userId,
              updatedBy: userId,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('withdrawal_fee_rule_exists');
      }
      throw error;
    }
    return this.serialize(row, input.customerId);
  }

  async update(
    id: string,
    input: { amount?: string; active?: boolean; version: string },
    userId: string
  ) {
    const user = await requireActiveUser(this.db, userId);
    if (user.role !== UserRole.ADMIN) throw new ForbiddenException('admin_role_required');
    const current = await this.db.withdrawalFeeRule.findUnique({ where: { id } });
    if (!current || current.organizationId !== user.organizationId) {
      throw new NotFoundException('withdrawal_fee_rule_not_found');
    }
    let expectedVersion: bigint;
    try {
      expectedVersion = BigInt(input.version);
    } catch {
      throw new BadRequestException('invalid_fee_rule_version');
    }
    const feeAmountMinor =
      input.amount === undefined
        ? current.feeAmountMinor
        : this.toMinor(input.amount, current.feeDecimals);
    const result = await this.db.withdrawalFeeRule.updateMany({
      where: { id, version: expectedVersion },
      data: {
        feeAmountMinor,
        ...(input.active === undefined ? {} : { active: input.active }),
        version: { increment: 1 },
        updatedBy: userId,
      },
    });
    if (result.count !== 1) throw new ConflictException('withdrawal_fee_changed');
    const updated = await this.db.withdrawalFeeRule.findUniqueOrThrow({ where: { id } });
    const defaultScopeIds = new Set([
      user.organizationId,
      process.env.NEOBANK_SOURCE_TENANT_ID?.trim() || user.organizationId,
    ]);
    return this.serialize(
      updated,
      defaultScopeIds.has(updated.scopeId) ? undefined : updated.scopeId
    );
  }

  async resolve(
    client: FeeRuleClient,
    scope: {
      scopeId: string;
      customerId?: string;
      assetClass: WithdrawalAssetClass;
      currency: Currency;
      method: WithdrawalMethod;
      channelCode: string;
      network?: string;
      expectedVersion?: string;
    }
  ) {
    const scopeIds = Array.from(
      new Set([...(scope.customerId ? [scope.customerId] : []), scope.scopeId])
    );
    const rules = await client.withdrawalFeeRule.findMany({
      where: {
        scopeId: { in: scopeIds },
        assetClass: scope.assetClass,
        currency: scope.currency,
        method: scope.method,
        channelCode: scope.channelCode.trim().toUpperCase(),
        network: (scope.network || '').trim().toUpperCase(),
        active: true,
      },
    });
    const rule =
      (scope.customerId
        ? rules.find((candidate) => candidate.scopeId === scope.customerId)
        : undefined) || rules.find((candidate) => candidate.scopeId === scope.scopeId);
    if (!rule) throw new ConflictException('fee_configuration_missing');
    if (scope.expectedVersion !== undefined && rule.version.toString() !== scope.expectedVersion) {
      throw new ConflictException('withdrawal_fee_changed');
    }
    return {
      amount: new Prisma.Decimal(rule.feeAmountMinor.toString()).div(
        new Prisma.Decimal(10).pow(rule.feeDecimals)
      ),
      snapshot: {
        id: rule.id,
        version: rule.version.toString(),
        assetClass: rule.assetClass,
        currency: rule.currency,
        method: rule.method,
        channelCode: rule.channelCode,
        network: rule.network,
        amount: this.fromMinor(rule.feeAmountMinor, rule.feeDecimals),
      },
    };
  }

  private async normalizeScope(input: WithdrawalFeeRuleInput) {
    const channelCode = input.channelCode.trim().toUpperCase();
    const network = (input.network || '').trim().toUpperCase();
    if (!channelCode) throw new BadRequestException('withdrawal_fee_channel_required');
    if (input.assetClass === 'FIAT') {
      if (!isSupportedFiatCurrency(input.currency) || input.method === 'ON_CHAIN' || network) {
        throw new BadRequestException('invalid_fiat_withdrawal_fee_scope');
      }
      const channel = await this.db.fundingChannel.findFirst({
        where: { organizationId: input.organizationId, code: channelCode },
      });
      const expectedType = input.method === 'VA' ? 'VIRTUAL_ACCOUNT' : `${input.method}_PAYOUT`;
      if (
        !channel ||
        channel.type !== expectedType ||
        !channel.supportedCurrencies.includes(input.currency)
      ) {
        throw new BadRequestException('withdrawal_fee_channel_mismatch');
      }
    } else if (
      input.currency !== supportedCryptoAsset ||
      input.method !== 'ON_CHAIN' ||
      network !== supportedCryptoNetwork
    ) {
      throw new BadRequestException('invalid_crypto_withdrawal_fee_scope');
    }
    const feeDecimals = input.assetClass === 'CRYPTO' ? 6 : 2;
    if (input.customerId) {
      const customer = await this.db.customer.findUnique({
        where: { id: input.customerId },
        select: { id: true, organizationId: true },
      });
      if (!customer || customer.organizationId !== input.organizationId) {
        throw new NotFoundException('customer_not_found');
      }
    }
    let scopeId = input.organizationId;
    if (input.customerId) {
      scopeId = input.customerId;
    } else if (input.assetClass === 'CRYPTO') {
      scopeId = process.env.NEOBANK_SOURCE_TENANT_ID?.trim() || input.organizationId;
    }
    return {
      feeDecimals,
      key: {
        scopeId,
        assetClass: input.assetClass,
        currency: input.currency,
        method: input.method,
        channelCode,
        network,
      },
    };
  }

  private toMinor(value: string, decimals: number) {
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(value);
    } catch {
      throw new BadRequestException('invalid_withdrawal_fee_amount');
    }
    if (amount.isNegative() || amount.decimalPlaces() > decimals) {
      throw new BadRequestException('invalid_withdrawal_fee_amount');
    }
    const minor = amount.mul(new Prisma.Decimal(10).pow(decimals));
    if (!minor.isInteger()) throw new BadRequestException('invalid_withdrawal_fee_amount');
    return BigInt(minor.toFixed(0));
  }

  private fromMinor(value: bigint, decimals: number) {
    return new Prisma.Decimal(value.toString())
      .div(new Prisma.Decimal(10).pow(decimals))
      .toFixed(decimals);
  }

  private serialize(
    row: {
      id: string;
      scopeId: string;
      organizationId: string | null;
      assetClass: string;
      currency: string;
      method: string;
      channelCode: string;
      network: string;
      feeAmountMinor: bigint;
      feeDecimals: number;
      active: boolean;
      version: bigint;
      createdBy: string;
      updatedBy: string;
      createdAt: Date;
      updatedAt: Date;
    },
    customerId?: string
  ) {
    const customerScoped = Boolean(customerId && row.scopeId === customerId);
    return {
      id: row.id,
      organizationId: row.organizationId,
      scope: customerScoped ? 'CUSTOMER' : 'ORGANIZATION',
      ...(customerScoped ? { customerId } : {}),
      assetClass: row.assetClass,
      currency: row.currency,
      method: row.method,
      channelCode: row.channelCode,
      network: row.network || undefined,
      amount: this.fromMinor(row.feeAmountMinor, row.feeDecimals),
      active: row.active,
      version: row.version.toString(),
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
