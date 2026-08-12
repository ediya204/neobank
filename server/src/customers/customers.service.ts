import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Currency, CustomerStatus, CustomerType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

type CreateCustomerInput = {
  organizationId: string;
  type: CustomerType;
  displayName: string;
  legalName: string;
  email: string;
  countryCode: string;
  phone?: string;
  registrationNo?: string;
};

@Injectable()
export class CustomersService {
  constructor(private readonly db: PrismaService) {}

  list(organizationId: string, status?: CustomerStatus) {
    return this.db.customer.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      include: { accounts: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const customer = await this.db.customer.findUnique({
      where: { id },
      include: { accounts: true, beneficiaries: true, operations: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!customer) throw new NotFoundException('customer_not_found');
    return customer;
  }

  create(input: CreateCustomerInput, creatorId: string) {
    return this.db.customer.create({ data: { ...input, creatorId, status: 'PENDING_REVIEW' } });
  }

  async approve(id: string, reviewerId: string, note?: string) {
    return this.db.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id } });
      if (!customer) throw new NotFoundException('customer_not_found');
      if (customer.status !== 'PENDING_REVIEW') throw new ConflictException('customer_not_pending_review');
      if (customer.creatorId === reviewerId) throw new ForbiddenException('creator_cannot_approve_own_customer');
      await this.requireChecker(tx, reviewerId);
      const currencies: Currency[] = ['USD', 'SGD', 'HKD', 'EUR', 'GBP'];
      for (const currency of currencies) {
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
        include: { accounts: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async reject(id: string, reviewerId: string, reason: string) {
    const customer = await this.db.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('customer_not_found');
    if (customer.creatorId === reviewerId) throw new ForbiddenException('creator_cannot_review_own_customer');
    await this.requireChecker(this.db, reviewerId);
    return this.db.customer.update({
      where: { id },
      data: { status: 'REJECTED', reviewerId, reviewedAt: new Date(), reviewNote: reason },
    });
  }

  async requestVirtualAccount(
    customerId: string,
    input: { currency: Currency; preferredCountry: string; purpose: string },
    makerId: string
  ) {
    if (input.currency === 'USDT') throw new ConflictException('virtual_account_must_be_fiat');
    const customer = await this.db.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.status !== 'ACTIVE') throw new ConflictException('active_customer_required');
    return this.db.virtualAccountRequest.create({ data: { customerId, ...input, makerId } });
  }

  listVirtualAccountRequests(customerId: string) {
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
      if (request.status !== 'SUBMITTED') throw new ConflictException('request_not_pending');
      if (request.makerId === checkerId) throw new ForbiddenException('maker_cannot_approve_own_request');
      await this.requireChecker(tx, checkerId);
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
    const request = await this.db.virtualAccountRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('virtual_account_request_not_found');
    if (request.status !== 'SUBMITTED') throw new ConflictException('request_not_pending');
    if (request.makerId === checkerId) throw new ForbiddenException('maker_cannot_review_own_request');
    await this.requireChecker(this.db, checkerId);
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
  }
}
