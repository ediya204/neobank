import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Currency, CustomerStatus, CustomerType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { requireCustomerAccess, requireOrganizationAccess } from '../common/tenant-access';
import { PrismaService } from '../prisma/prisma.service';
import {
  isSupportedFiatCurrency,
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

@Injectable()
export class CustomersService {
  constructor(private readonly db: PrismaService) {}

  async list(organizationId: string, userId: string, status?: CustomerStatus) {
    await requireOrganizationAccess(this.db, userId, organizationId);
    return this.db.customer.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      include: { accounts: { where: supportedCustomerAccountWhere } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string, userId: string) {
    await requireCustomerAccess(this.db, userId, id);
    const customer = await this.db.customer.findUnique({
      where: { id },
      include: {
        accounts: { where: supportedCustomerAccountWhere },
        beneficiaries: { where: { currency: { in: supportedFiatCurrencies } } },
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
    if (parsedBirthDate && (!Number.isFinite(parsedBirthDate.getTime()) || parsedBirthDate >= new Date())) {
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

  async reviewKyc(
    id: string,
    reviewerId: string,
    decision: 'APPROVE' | 'REJECT',
    note?: string
  ) {
    const customer = await this.db.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('customer_not_found');
    const reviewer = await this.requireChecker(this.db, reviewerId);
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
    const result = await this.db.customer.updateMany({
      where: { id, organizationId: customer.organizationId, status: 'PENDING_REVIEW', kycStatus: 'PENDING' },
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
    return this.db.customer.findUniqueOrThrow({
      where: { id },
      include: { accounts: { where: supportedCustomerAccountWhere } },
    });
  }

  async approve(id: string, reviewerId: string, note?: string) {
    return this.db.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id } });
      if (!customer) throw new NotFoundException('customer_not_found');
      const reviewer = await this.requireChecker(tx, reviewerId);
      if (reviewer.organizationId !== customer.organizationId) {
        throw new NotFoundException('customer_not_found');
      }
      if (customer.status !== 'PENDING_REVIEW') throw new ConflictException('customer_not_pending_review');
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
      return tx.customer.update({
        where: { id },
        data: { status: 'ACTIVE', reviewerId, reviewedAt: new Date(), reviewNote: note },
        include: { accounts: { where: supportedCustomerAccountWhere } },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async reject(id: string, reviewerId: string, reason: string) {
    const customer = await this.db.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('customer_not_found');
    const reviewer = await this.requireChecker(this.db, reviewerId);
    if (reviewer.organizationId !== customer.organizationId) {
      throw new NotFoundException('customer_not_found');
    }
    if (customer.status !== 'PENDING_REVIEW' || customer.kycStatus !== 'APPROVED') {
      throw new ConflictException('customer_not_pending_operations_review');
    }
    if (customer.creatorId === reviewerId && reviewer.role !== 'ADMIN') {
      throw new ForbiddenException('admin_required_for_self_approval');
    }
    const result = await this.db.customer.updateMany({
      where: { id, organizationId: customer.organizationId, status: 'PENDING_REVIEW', kycStatus: 'APPROVED' },
      data: { status: 'REJECTED', reviewerId, reviewedAt: new Date(), reviewNote: reason },
    });
    if (result.count !== 1) throw new ConflictException('customer_not_pending_operations_review');
    return this.db.customer.findUniqueOrThrow({ where: { id } });
  }

  async requestVirtualAccount(
    customerId: string,
    input: { currency: Currency; preferredCountry: string; purpose: string },
    makerId: string
  ) {
    if (!isSupportedFiatCurrency(input.currency)) {
      throw new ConflictException('unsupported_fiat_currency');
    }
    const { customer } = await requireCustomerAccess(this.db, makerId, customerId);
    if (customer.status !== 'ACTIVE') throw new ConflictException('active_customer_required');
    return this.db.virtualAccountRequest.create({ data: { customerId, ...input, makerId } });
  }

  async listVirtualAccountRequests(customerId: string, userId: string) {
    await requireCustomerAccess(this.db, userId, customerId);
    return this.db.virtualAccountRequest.findMany({
      where: { customerId },
      include: { assignedAccount: true, maker: true, checker: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveVirtualAccountRequest(id: string, checkerId: string) {
    return this.db.$transaction(async (tx) => {
      const request = await tx.virtualAccountRequest.findUnique({ where: { id }, include: { customer: true } });
      if (!request) throw new NotFoundException('virtual_account_request_not_found');
      const checker = await this.requireChecker(tx, checkerId);
      if (checker.organizationId !== request.customer.organizationId) {
        throw new NotFoundException('virtual_account_request_not_found');
      }
      if (request.status !== 'SUBMITTED') throw new ConflictException('request_not_pending');
      if (request.makerId === checkerId && checker.role !== 'ADMIN') {
        throw new ForbiddenException('admin_required_for_self_approval');
      }
      const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
      const account = await tx.account.create({
        data: {
          customerId: request.customerId,
          kind: 'VIRTUAL_ACCOUNT',
          status: 'ACTIVE',
          currency: request.currency,
          name: `${request.currency} 独立 VA`,
          accountNumber: `VA-${request.preferredCountry}-${suffix}`,
          bankName: '待接入银行通道',
        },
      });
      return tx.virtualAccountRequest.update({
        where: { id },
        data: { status: 'APPROVED', checkerId, reviewedAt: new Date(), assignedAccountId: account.id },
        include: { assignedAccount: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async rejectVirtualAccountRequest(id: string, checkerId: string, reason: string) {
    const request = await this.db.virtualAccountRequest.findUnique({
      where: { id },
      include: { customer: { select: { organizationId: true } } },
    });
    if (!request) throw new NotFoundException('virtual_account_request_not_found');
    const checker = await this.requireChecker(this.db, checkerId);
    if (checker.organizationId !== request.customer.organizationId) {
      throw new NotFoundException('virtual_account_request_not_found');
    }
    if (request.status !== 'SUBMITTED') throw new ConflictException('request_not_pending');
    if (request.makerId === checkerId && checker.role !== 'ADMIN') {
      throw new ForbiddenException('admin_required_for_self_approval');
    }
    return this.db.virtualAccountRequest.update({
      where: { id },
      data: { status: 'REJECTED', checkerId, reviewedAt: new Date(), rejectionReason: reason },
    });
  }

  private async requireChecker(tx: Prisma.TransactionClient | PrismaService, userId: string) {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || !user.active || !['ADMIN', 'CHECKER'].includes(user.role)) {
      throw new ForbiddenException('checker_role_required');
    }
    return user;
  }
}
