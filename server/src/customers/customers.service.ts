import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  BeneficiaryType,
  Currency,
  CustomerStatus,
  CustomerType,
  EmailTemplateKey,
  FundingChannel,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { requireCustomerAccess, requireOrganizationAccess } from '../common/tenant-access';
import { PrismaService } from '../prisma/prisma.service';
import { EmailOutboxService } from '../email/email-outbox.service';
import { syncNeobankCustomers } from './neobank-customer-sync';
import {
  isSupportedFiatCurrency,
  supportedCryptoAsset,
  supportedCryptoNetwork,
  supportedCustomerAccountWhere,
  supportedFiatCurrencies,
} from '../supported-assets';

type CreateCustomerInput = {
  organizationId: string;
  type: CustomerType;
  displayName: string;
  legalName: string;
  email: string;
  countryCode: string;
  phone?: string;
  phoneCountryCode?: string;
  registrationNo?: string;
  dateOfBirth?: string;
  nationality?: string;
  contactName?: string;
  contactRole?: string;
  beneficialOwnerName?: string;
  beneficialOwnerOwnership?: number;
};

type VaRequestActor = {
  userId: string;
  customerId?: string;
  email?: string;
};

const vaRequestInclude = {
  assignedAccount: true,
  channel: true,
  feeOperation: { include: { sourceAccount: true, targetAccount: true } },
  maker: true,
  checker: true,
} satisfies Prisma.VirtualAccountRequestInclude;

@Injectable()
export class CustomersService {
  constructor(
    private readonly db: PrismaService,
    @Optional() private readonly email?: EmailOutboxService
  ) {}

  async list(organizationId: string, userId: string, status?: CustomerStatus) {
    await requireOrganizationAccess(this.db, userId, organizationId);
    const sourceTenantId = process.env.NEOBANK_SOURCE_TENANT_ID?.trim();
    if (sourceTenantId) {
      await syncNeobankCustomers(this.db, {
        adminUserId: process.env.CORE_ADMIN_USER_ID?.trim() || userId,
        organizationId,
        tenantId: sourceTenantId,
      });
    }
    return this.db.customer.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      include: { accounts: { where: supportedCustomerAccountWhere } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string, userId: string) {
    const sourceTenantId = process.env.NEOBANK_SOURCE_TENANT_ID?.trim();
    const organizationId = process.env.CORE_ORGANIZATION_ID?.trim();
    if (sourceTenantId && organizationId) {
      await syncNeobankCustomers(this.db, {
        adminUserId: process.env.CORE_ADMIN_USER_ID?.trim() || userId,
        organizationId,
        tenantId: sourceTenantId,
      });
    }
    await requireCustomerAccess(this.db, userId, id);
    const customer = await this.db.customer.findUnique({
      where: { id },
      include: {
        accounts: { where: supportedCustomerAccountWhere },
        beneficiaries: {
          where: {
            OR: [
              { type: BeneficiaryType.BANK, currency: { in: supportedFiatCurrencies } },
              {
                type: BeneficiaryType.CRYPTO,
                currency: supportedCryptoAsset,
                network: supportedCryptoNetwork,
              },
            ],
          },
          orderBy: { createdAt: 'desc' },
        },
        operations: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!customer) throw new NotFoundException('customer_not_found');
    return customer;
  }

  async create(input: CreateCustomerInput, creatorId: string) {
    await requireOrganizationAccess(this.db, creatorId, input.organizationId);
    const { dateOfBirth, ...data } = input;
    const parsedBirthDate = dateOfBirth ? new Date(`${dateOfBirth}T00:00:00.000Z`) : undefined;
    if (
      parsedBirthDate &&
      (!Number.isFinite(parsedBirthDate.getTime()) || parsedBirthDate >= new Date())
    ) {
      throw new BadRequestException('invalid_date_of_birth');
    }
    return this.db.customer.create({
      data: {
        ...data,
        email: input.email.trim().toLowerCase(),
        displayName: input.displayName.trim(),
        legalName: input.legalName.trim(),
        phone: input.phone?.replaceAll(/[ ()-]/g, ''),
        phoneCountryCode: input.phoneCountryCode?.trim(),
        countryCode: input.countryCode.trim().toUpperCase(),
        nationality: input.nationality?.trim().toUpperCase(),
        dateOfBirth: parsedBirthDate,
        creatorId,
        status: 'PENDING_REVIEW',
        kycStatus: 'PENDING',
      },
    });
  }

  async reviewKyc(id: string, reviewerId: string, decision: 'APPROVE' | 'REJECT', note?: string) {
    return this.db.$transaction(
      async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id } });
        if (!customer) throw new NotFoundException('customer_not_found');
        const reviewer = await this.requireChecker(tx, reviewerId);
        if (reviewer.organizationId !== customer.organizationId) {
          throw new NotFoundException('customer_not_found');
        }
        if (customer.status !== 'PENDING_REVIEW' || customer.kycStatus !== 'PENDING') {
          throw new ConflictException('customer_not_pending_kyc');
        }
        if (customer.creatorId === reviewerId && reviewer.role !== 'ADMIN') {
          throw new ForbiddenException('admin_required_for_self_approval');
        }
        if (decision === 'REJECT' && !note?.trim()) {
          throw new ConflictException('kyc_rejection_reason_required');
        }
        const reviewedAt = new Date();
        const result = await tx.customer.updateMany({
          where: {
            id,
            organizationId: customer.organizationId,
            status: 'PENDING_REVIEW',
            kycStatus: 'PENDING',
          },
          data: {
            kycStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
            kycReviewerId: reviewerId,
            kycReviewedAt: reviewedAt,
            kycReviewNote: note?.trim() || null,
            ...(decision === 'REJECT'
              ? { status: 'REJECTED', reviewerId, reviewedAt, reviewNote: note?.trim() }
              : {}),
          },
        });
        if (result.count !== 1) throw new ConflictException('customer_not_pending_kyc');
        const updated = await tx.customer.findUniqueOrThrow({
          where: { id },
          include: { accounts: { where: supportedCustomerAccountWhere } },
        });
        await this.enqueueCustomerEmail(
          tx,
          customer,
          decision === 'APPROVE'
            ? EmailTemplateKey.CUSTOMER_KYC_APPROVED
            : EmailTemplateKey.CUSTOMER_KYC_REJECTED,
          `customer:${customer.id}:kyc:${decision.toLowerCase()}`
        );
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async approve(id: string, reviewerId: string, note?: string) {
    return this.db.$transaction(
      async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id } });
        if (!customer) throw new NotFoundException('customer_not_found');
        const reviewer = await this.requireChecker(tx, reviewerId);
        if (reviewer.organizationId !== customer.organizationId) {
          throw new NotFoundException('customer_not_found');
        }
        if (customer.status !== 'PENDING_REVIEW')
          throw new ConflictException('customer_not_pending_review');
        if (customer.kycStatus !== 'APPROVED') throw new ConflictException('kyc_approval_required');
        if (customer.creatorId === reviewerId && reviewer.role !== 'ADMIN') {
          throw new ForbiddenException('admin_required_for_self_approval');
        }
        for (const currency of supportedFiatCurrencies) {
          await tx.account.upsert({
            where: { accountNumber: `WALLET-${customer.id}-${currency}` },
            update: {},
            create: {
              customerId: customer.id,
              kind: 'SYSTEM_WALLET',
              status: 'ACTIVE',
              currency,
              name: `${currency} 法币钱包`,
              accountNumber: `WALLET-${customer.id}-${currency}`,
            },
          });
        }
        await tx.account.upsert({
          where: { accountNumber: `CRYPTO-${customer.id}-USDT` },
          update: {},
          create: {
            customerId: customer.id,
            kind: 'CRYPTO_WALLET',
            status: 'ACTIVE',
            currency: 'USDT',
            name: 'USDT 钱包（等待 Cregis）',
            accountNumber: `CRYPTO-${customer.id}-USDT`,
            network: 'TRON',
          },
        });
        const activated = await tx.customer.update({
          where: { id },
          data: { status: 'ACTIVE', reviewerId, reviewedAt: new Date(), reviewNote: note },
          include: { accounts: { where: supportedCustomerAccountWhere } },
        });
        await this.enqueueCustomerEmail(
          tx,
          customer,
          EmailTemplateKey.CUSTOMER_ACTIVATED,
          `customer:${customer.id}:activated`
        );
        return activated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async reject(id: string, reviewerId: string, reason: string) {
    return this.db.$transaction(
      async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id } });
        if (!customer) throw new NotFoundException('customer_not_found');
        const reviewer = await this.requireChecker(tx, reviewerId);
        if (reviewer.organizationId !== customer.organizationId) {
          throw new NotFoundException('customer_not_found');
        }
        if (customer.status !== 'PENDING_REVIEW' || customer.kycStatus !== 'APPROVED') {
          throw new ConflictException('customer_not_pending_operations_review');
        }
        if (customer.creatorId === reviewerId && reviewer.role !== 'ADMIN') {
          throw new ForbiddenException('admin_required_for_self_approval');
        }
        const result = await tx.customer.updateMany({
          where: {
            id,
            organizationId: customer.organizationId,
            status: 'PENDING_REVIEW',
            kycStatus: 'APPROVED',
          },
          data: { status: 'REJECTED', reviewerId, reviewedAt: new Date(), reviewNote: reason },
        });
        if (result.count !== 1) {
          throw new ConflictException('customer_not_pending_operations_review');
        }
        return tx.customer.findUniqueOrThrow({ where: { id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async requestVirtualAccount(
    customerId: string,
    input: {
      currency: Currency;
      channelId: string;
      purpose: string;
      expectedOpeningFeeUsd?: string;
      expectedOpeningFeeVersion?: string;
      idempotencyKey?: string;
    },
    actor: VaRequestActor
  ) {
    if (!isSupportedFiatCurrency(input.currency)) {
      throw new ConflictException('unsupported_fiat_currency');
    }
    const purpose = input.purpose.trim();
    if (purpose.length < 2) throw new BadRequestException('virtual_account_purpose_required');
    const customer = await this.requireVaCustomerAccess(customerId, undefined, actor);
    if (customer.status !== 'ACTIVE') throw new ConflictException('active_customer_required');
    const idempotencyKey = input.idempotencyKey?.trim() || undefined;
    if (actor.customerId && !idempotencyKey) {
      throw new BadRequestException('idempotency_key_required');
    }
    try {
      const created = await this.db.$transaction(
        async (tx) => {
          if (idempotencyKey) {
            const existing = await tx.virtualAccountRequest.findFirst({
              where: { customerId, idempotencyKey },
              include: vaRequestInclude,
            });
            if (existing) {
              if (
                existing.channelId !== input.channelId ||
                existing.currency !== input.currency ||
                existing.purpose !== purpose
              ) {
                throw new ConflictException('idempotency_key_reused');
              }
              return existing;
            }
          }
          const [channel, currentCustomer, pending] = await Promise.all([
            tx.fundingChannel.findUnique({ where: { id: input.channelId } }),
            tx.customer.findUnique({ where: { id: customerId } }),
            tx.virtualAccountRequest.findFirst({
              where: {
                customerId,
                channelId: input.channelId,
                currency: input.currency,
                status: 'SUBMITTED',
              },
            }),
          ]);
          if (
            !channel ||
            channel.type !== 'VIRTUAL_ACCOUNT' ||
            !channel.active ||
            channel.organizationId !== customer.organizationId
          ) {
            throw new NotFoundException('virtual_account_channel_not_found');
          }
          if (!channel.supportedCurrencies.includes(input.currency)) {
            throw new ConflictException('virtual_account_channel_currency_unsupported');
          }
          if (
            !currentCustomer ||
            currentCustomer.organizationId !== channel.organizationId ||
            currentCustomer.status !== 'ACTIVE'
          ) {
            throw new ConflictException('active_customer_required');
          }
          if (pending) throw new ConflictException('virtual_account_request_already_pending');
          if (channel.openingFeeUsdMinor === null) {
            throw new ConflictException('virtual_account_opening_fee_not_configured');
          }
          const fee = new Prisma.Decimal(channel.openingFeeUsdMinor.toString()).div(100);
          if (actor.customerId) {
            let expectedFee: Prisma.Decimal;
            try {
              expectedFee = new Prisma.Decimal(input.expectedOpeningFeeUsd || '');
            } catch {
              throw new BadRequestException('invalid_virtual_account_opening_fee_confirmation');
            }
            if (
              !expectedFee.equals(fee) ||
              input.expectedOpeningFeeVersion !== channel.openingFeeVersion.toString()
            ) {
              throw new ConflictException('virtual_account_opening_fee_changed');
            }
          }

          const requestId = randomUUID();
          let feeOperationId: string | null = null;
          if (!fee.isZero()) {
            const [wallets, feeAccounts] = await Promise.all([
              tx.account.findMany({
                where: {
                  customerId,
                  kind: 'SYSTEM_WALLET',
                  status: 'ACTIVE',
                  currency: 'USD',
                },
                take: 2,
              }),
              tx.account.findMany({
                where: { customerId: null, kind: 'FEE_REVENUE', status: 'ACTIVE', currency: 'USD' },
                take: 2,
              }),
            ]);
            if (wallets.length !== 1) throw new ConflictException('usd_wallet_not_found');
            if (feeAccounts.length !== 1) throw new ConflictException('fee_account_not_configured');
            const wallet = wallets[0];
            const feeAccount = feeAccounts[0];
            const frozen = await tx.account.updateMany({
              where: { id: wallet.id, status: 'ACTIVE', availableBalance: { gte: fee } },
              data: {
                availableBalance: { decrement: fee },
                frozenBalance: { increment: fee },
                version: { increment: 1 },
              },
            });
            if (frozen.count !== 1) {
              throw new ConflictException('insufficient_available_balance');
            }
            feeOperationId = randomUUID();
            const submittedAt = new Date();
            await tx.operation.create({
              data: {
                id: feeOperationId,
                reference: `VA-FEE-${requestId.slice(0, 8).toUpperCase()}`,
                idempotencyKey: idempotencyKey ? `va-opening-fee:${idempotencyKey}` : null,
                customerId,
                channelId: channel.id,
                type: 'VA_OPENING_FEE',
                status: 'SUBMITTED',
                currency: 'USD',
                amount: fee,
                feeAmount: 0,
                sourceAccountId: wallet.id,
                targetAccountId: feeAccount.id,
                makerId: actor.userId,
                narrative: 'VA opening fee',
                metadata: {
                  vaOpeningFee: {
                    requestId,
                    channelCode: channel.code,
                    bankName: channel.settlementBankName || channel.name,
                    version: channel.openingFeeVersion.toString(),
                    reservedAt: submittedAt.toISOString(),
                  },
                },
                submittedAt,
              },
            });
          }
          return tx.virtualAccountRequest.create({
            data: {
              id: requestId,
              customerId,
              channelId: channel.id,
              currency: input.currency,
              preferredCountry: channel.bankCountry || 'ZZ',
              purpose,
              makerId: actor.userId,
              requestSource: actor.customerId ? 'CUSTOMER' : 'ADMIN',
              requesterEmail: actor.email,
              idempotencyKey,
              openingFeeUsdMinor: channel.openingFeeUsdMinor,
              openingFeeVersion: channel.openingFeeVersion,
              feeOperationId,
            },
            include: vaRequestInclude,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      return this.serializeVirtualAccountRequest(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2034')
      ) {
        if (idempotencyKey) {
          const existing = await this.db.virtualAccountRequest.findFirst({
            where: { customerId, idempotencyKey },
            include: vaRequestInclude,
          });
          if (existing) return this.serializeVirtualAccountRequest(existing);
        }
        throw new ConflictException('virtual_account_request_already_pending');
      }
      throw error;
    }
  }

  async listVirtualAccountRequests(customerId: string, actor: VaRequestActor) {
    let customer = await this.db.customer.findUnique({ where: { id: customerId } });
    if (actor.customerId) {
      if (actor.customerId !== customerId) throw new NotFoundException('customer_not_found');
      const organizationId = process.env.CORE_ORGANIZATION_ID?.trim();
      const tenantId = process.env.NEOBANK_SOURCE_TENANT_ID?.trim();
      if (!customer && organizationId && tenantId) {
        await syncNeobankCustomers(this.db, {
          adminUserId: process.env.CORE_ADMIN_USER_ID?.trim() || actor.userId,
          organizationId,
          tenantId,
        });
        customer = await this.db.customer.findUnique({ where: { id: customerId } });
      }
      if (!customer) throw new NotFoundException('customer_not_found');
    } else {
      await requireCustomerAccess(this.db, actor.userId, customerId);
    }
    const requests = await this.db.virtualAccountRequest.findMany({
      where: { customerId },
      include: vaRequestInclude,
      orderBy: { createdAt: 'desc' },
    });
    return requests.map((request) => this.serializeVirtualAccountRequest(request));
  }

  async approveVirtualAccountRequest(
    id: string,
    input: { accountName: string; accountNumber: string; iban?: string },
    checkerId: string
  ) {
    return this.db.$transaction(
      async (tx) => {
        const request = await tx.virtualAccountRequest.findUnique({
          where: { id },
          include: { customer: true, channel: true },
        });
        if (!request) throw new NotFoundException('virtual_account_request_not_found');
        const checker = await this.requireChecker(tx, checkerId);
        if (checker.organizationId !== request.customer.organizationId) {
          throw new NotFoundException('virtual_account_request_not_found');
        }
        if (request.status !== 'SUBMITTED') throw new ConflictException('request_not_pending');
        if (request.makerId === checkerId && checker.role !== 'ADMIN') {
          throw new ForbiddenException('admin_required_for_self_approval');
        }
        const channel = request.channel;
        if (
          !channel ||
          !channel.active ||
          channel.type !== 'VIRTUAL_ACCOUNT' ||
          !channel.settlementBankName ||
          !channel.swiftBic ||
          !channel.bankCountry ||
          !channel.bankAddress
        ) {
          throw new ConflictException('virtual_account_channel_not_ready');
        }
        let account;
        try {
          account = await tx.account.create({
            data: {
              customerId: request.customerId,
              kind: 'VIRTUAL_ACCOUNT',
              status: 'ACTIVE',
              currency: request.currency,
              name: input.accountName.trim(),
              accountNumber: input.accountNumber.trim(),
              iban: input.iban?.trim() || null,
              bankName: channel.settlementBankName,
              bankAddress: channel.bankAddress,
              bankCountry: channel.bankCountry,
              swiftBic: channel.swiftBic,
              fundingChannelId: channel.id,
            },
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new ConflictException('virtual_account_number_exists');
          }
          throw error;
        }
        const updated = await tx.virtualAccountRequest.update({
          where: { id },
          data: {
            status: 'APPROVED',
            checkerId,
            reviewedAt: new Date(),
            assignedAccountId: account.id,
          },
          include: { assignedAccount: true, channel: true },
        });
        await this.enqueueCustomerEmail(
          tx,
          request.customer,
          EmailTemplateKey.VIRTUAL_ACCOUNT_APPROVED,
          `virtual-account-request:${request.id}:approved`,
          { currency: request.currency }
        );
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  private async requireVaCustomerAccess(
    customerId: string,
    organizationId: string | undefined,
    actor: VaRequestActor
  ) {
    if (!actor.customerId) {
      const { customer } = await requireCustomerAccess(this.db, actor.userId, customerId);
      if (organizationId && customer.organizationId !== organizationId) {
        throw new NotFoundException('virtual_account_channel_not_found');
      }
      return customer;
    }
    if (actor.customerId !== customerId) throw new NotFoundException('customer_not_found');
    let customer = await this.db.customer.findUnique({ where: { id: customerId } });
    const syncOrganizationId = organizationId || process.env.CORE_ORGANIZATION_ID?.trim();
    if (!customer && syncOrganizationId && process.env.NEOBANK_SOURCE_TENANT_ID?.trim()) {
      await syncNeobankCustomers(this.db, {
        adminUserId: process.env.CORE_ADMIN_USER_ID?.trim() || actor.userId,
        organizationId: syncOrganizationId,
        tenantId: process.env.NEOBANK_SOURCE_TENANT_ID.trim(),
      });
      customer = await this.db.customer.findUnique({ where: { id: customerId } });
    }
    if (!customer || (organizationId && customer.organizationId !== organizationId)) {
      throw new NotFoundException('customer_not_found');
    }
    return customer;
  }

  async rejectVirtualAccountRequest(id: string, checkerId: string, reason: string) {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 2 || normalizedReason.length > 500) {
      throw new BadRequestException('virtual_account_rejection_reason_required');
    }
    return this.db.$transaction(
      async (tx) => {
        const request = await tx.virtualAccountRequest.findUnique({
          where: { id },
          include: { customer: true },
        });
        if (!request) throw new NotFoundException('virtual_account_request_not_found');
        const checker = await this.requireChecker(tx, checkerId);
        if (checker.organizationId !== request.customer.organizationId) {
          throw new NotFoundException('virtual_account_request_not_found');
        }
        if (request.status !== 'SUBMITTED') throw new ConflictException('request_not_pending');
        if (request.makerId === checkerId && checker.role !== 'ADMIN') {
          throw new ForbiddenException('admin_required_for_self_approval');
        }
        const updated = await tx.virtualAccountRequest.update({
          where: { id },
          data: {
            status: 'REJECTED',
            checkerId,
            reviewedAt: new Date(),
            rejectionReason: normalizedReason,
          },
        });
        await this.enqueueCustomerEmail(
          tx,
          request.customer,
          EmailTemplateKey.VIRTUAL_ACCOUNT_REJECTED,
          `virtual-account-request:${request.id}:rejected`,
          { currency: request.currency }
        );
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  private async enqueueCustomerEmail(
    tx: Prisma.TransactionClient,
    customer: { id: string; organizationId: string; email: string; displayName: string },
    templateKey: EmailTemplateKey,
    dedupeKey: string,
    payload?: Record<string, string>
  ) {
    await this.email?.enqueue(tx, {
      organizationId: customer.organizationId,
      customerId: customer.id,
      dedupeKey,
      templateKey,
      recipient: customer.email,
      payload: { displayName: customer.displayName, ...payload },
    });
  }

  private async requireChecker(tx: Prisma.TransactionClient | PrismaService, userId: string) {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || !user.active || user.role !== 'ADMIN') {
      throw new ForbiddenException('admin_role_required');
    }
    return user;
  }

  private fromUsdMinor(value: bigint) {
    return new Prisma.Decimal(value.toString()).div(100).toFixed(2);
  }

  private serializeVaChannel(channel: FundingChannel) {
    const {
      openingFeeUsdMinor,
      openingFeeVersion,
      openingFeeUpdatedBy,
      openingFeeUpdatedAt,
      ...rest
    } = channel;
    return {
      ...rest,
      openingFeeUsd: openingFeeUsdMinor === null ? null : this.fromUsdMinor(openingFeeUsdMinor),
      openingFeeVersion: openingFeeVersion.toString(),
      openingFeeUpdatedBy,
      openingFeeUpdatedAt,
    };
  }

  private serializeVirtualAccountRequest<
    T extends {
      openingFeeUsdMinor: bigint;
      openingFeeVersion: bigint;
      channel?: FundingChannel | null;
    },
  >(request: T) {
    const { openingFeeUsdMinor, openingFeeVersion, channel, ...rest } = request;
    return {
      ...rest,
      openingFeeUsd: this.fromUsdMinor(openingFeeUsdMinor),
      openingFeeVersion: openingFeeVersion.toString(),
      channel: channel ? this.serializeVaChannel(channel) : channel,
    };
  }
}
