import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BeneficiaryType,
  CryptoNetwork,
  CryptoTransferDirection,
  CryptoTransferStatus,
  JournalSide,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { supportedCryptoAsset, supportedCryptoNetwork } from '../supported-assets';
import { isValidTronAddress } from './tron-address';
import { WithdrawalFeesService } from '../withdrawal-fees/withdrawal-fees.service';

type CreateWithdrawalInput = {
  customerId: string;
  walletId: string;
  network: CryptoNetwork;
  amount: string;
  toAddress: string;
  beneficiaryId?: string;
  idempotencyKey: string;
  expectedFeeAmount?: string;
  expectedFeeRuleVersion?: string;
};

@Injectable()
export class CryptoWalletsService {
  constructor(
    private readonly db: PrismaService,
    private readonly withdrawalFees: WithdrawalFeesService
  ) {}

  async listWallets(customerId: string, userId: string) {
    const customer = await this.requireCustomerTenant(customerId, userId);
    const resolvedFee = await this.withdrawalFees.resolve(this.db, {
      scopeId: process.env.NEOBANK_SOURCE_TENANT_ID?.trim() || customer.organizationId,
      customerId,
      assetClass: 'CRYPTO',
      currency: supportedCryptoAsset,
      method: 'ON_CHAIN',
      channelCode: 'CREGIS',
      network: supportedCryptoNetwork,
    });
    const wallets = await this.db.cryptoWallet.findMany({
      where: {
        customerId,
        asset: supportedCryptoAsset,
        network: supportedCryptoNetwork,
        status: 'ACTIVE',
      },
      orderBy: { network: 'asc' },
    });
    return wallets.map((wallet) => ({
      ...wallet,
      withdrawalFee: resolvedFee.amount,
      withdrawalFeeRuleVersion: resolvedFee.snapshot.version,
      walletAddress: '',
      custodyProvider: null,
      ownershipVerifiedAt: null,
      depositEnabled: false,
    }));
  }

  async listTransfers(
    customerId: string,
    userId: string,
    direction?: CryptoTransferDirection,
    status?: CryptoTransferStatus
  ) {
    await this.requireCustomerTenant(customerId, userId);
    const transfers = await this.db.cryptoTransfer.findMany({
      where: {
        customerId,
        asset: supportedCryptoAsset,
        network: supportedCryptoNetwork,
        ...(direction ? { direction } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        wallet: true,
        maker: { select: { id: true, displayName: true } },
        checker: { select: { id: true, displayName: true } },
        operator: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return transfers.map((transfer) => ({
      ...transfer,
      ...(transfer.direction === 'DEPOSIT' ? { toAddress: '' } : {}),
      wallet: {
        ...transfer.wallet,
        walletAddress: '',
        custodyProvider: null,
        ownershipVerifiedAt: null,
        depositEnabled: false,
      },
    }));
  }

  async qrCode(id: string, customerId: string, userId: string) {
    await this.requireCustomerTenant(customerId, userId);
    const wallet = await this.db.cryptoWallet.findFirst({
      where: {
        id,
        customerId,
        asset: supportedCryptoAsset,
        network: supportedCryptoNetwork,
        status: 'ACTIVE',
      },
    });
    if (!wallet) throw new NotFoundException('crypto_wallet_not_found');
    throw new ConflictException('crypto_deposit_unavailable_until_cregis_ownership_verified');
  }

  async createWithdrawal(input: CreateWithdrawalInput, makerId: string) {
    if (input.network !== supportedCryptoNetwork) {
      throw new BadRequestException('unsupported_crypto_network');
    }
    const amount = new Prisma.Decimal(input.amount);
    if (!amount.isPositive()) throw new BadRequestException('withdrawal_amount_must_be_positive');
    this.validateAddress(input.network, input.toAddress);

    return this.db.$transaction(
      async (tx) => {
        const existing = await tx.cryptoTransfer.findFirst({
          where: { customerId: input.customerId, idempotencyKey: input.idempotencyKey },
        });
        if (existing) return existing;
        const [wallet, customer, maker, mirrorAccount, beneficiary] = await Promise.all([
          tx.cryptoWallet.findUnique({ where: { id: input.walletId } }),
          tx.customer.findUnique({ where: { id: input.customerId } }),
          tx.user.findUnique({ where: { id: makerId } }),
          this.mirrorAccount(tx, input.customerId),
          input.beneficiaryId
            ? tx.beneficiary.findUnique({ where: { id: input.beneficiaryId } })
            : null,
        ]);
        if (
          !wallet ||
          wallet.customerId !== input.customerId ||
          wallet.network !== input.network ||
          wallet.status !== 'ACTIVE'
        ) {
          throw new BadRequestException('invalid_crypto_wallet');
        }
        if (!customer || customer.status !== 'ACTIVE') {
          throw new ForbiddenException('active_customer_required');
        }
        if (
          !maker?.active ||
          maker.role !== 'ADMIN' ||
          !maker.organizationId ||
          maker.organizationId !== customer.organizationId
        ) {
          throw new ForbiddenException('cross_tenant_crypto_operation');
        }
        if (!mirrorAccount) throw new ConflictException('crypto_account_mirror_not_configured');
        if (
          input.beneficiaryId &&
          (!beneficiary ||
            !beneficiary.active ||
            beneficiary.customerId !== input.customerId ||
            beneficiary.type !== BeneficiaryType.CRYPTO ||
            beneficiary.currency !== supportedCryptoAsset ||
            beneficiary.network !== input.network ||
            beneficiary.walletAddress !== input.toAddress)
        ) {
          throw new BadRequestException('crypto_beneficiary_mismatch');
        }
        const resolvedFee = await this.withdrawalFees.resolve(tx, {
          scopeId: process.env.NEOBANK_SOURCE_TENANT_ID?.trim() || customer.organizationId,
          customerId: input.customerId,
          assetClass: 'CRYPTO',
          currency: supportedCryptoAsset,
          method: 'ON_CHAIN',
          channelCode: 'CREGIS',
          network: supportedCryptoNetwork,
          expectedVersion: input.expectedFeeRuleVersion,
        });
        const withdrawalFee = resolvedFee.amount;
        if (
          input.expectedFeeAmount !== undefined &&
          !withdrawalFee.equals(new Prisma.Decimal(input.expectedFeeAmount))
        ) {
          throw new ConflictException('withdrawal_fee_changed');
        }
        if (amount.lte(withdrawalFee)) {
          throw new BadRequestException('amount_must_exceed_network_fee');
        }
        const frozen = await tx.cryptoWallet.updateMany({
          where: { id: wallet.id, status: 'ACTIVE', availableBalance: { gte: amount } },
          data: {
            availableBalance: { decrement: amount },
            frozenBalance: { increment: amount },
            version: { increment: 1 },
          },
        });
        if (frozen.count !== 1) throw new ConflictException('insufficient_crypto_balance');
        const mirrorFrozen = await tx.account.updateMany({
          where: {
            id: mirrorAccount.id,
            status: 'ACTIVE',
            availableBalance: { gte: amount },
          },
          data: {
            availableBalance: { decrement: amount },
            frozenBalance: { increment: amount },
            version: { increment: 1 },
          },
        });
        if (mirrorFrozen.count !== 1) {
          throw new ConflictException('crypto_account_mirror_balance_mismatch');
        }
        const netAmount = amount.sub(withdrawalFee);
        const transferId = randomUUID();
        const reference = this.reference('CWO');
        const transfer = await tx.cryptoTransfer.create({
          data: {
            id: transferId,
            reference,
            idempotencyKey: input.idempotencyKey,
            customerId: input.customerId,
            walletId: wallet.id,
            asset: wallet.asset,
            network: wallet.network,
            direction: 'WITHDRAWAL',
            status: 'SUBMITTED',
            amount,
            feeAmount: withdrawalFee,
            netAmount,
            fromAddress: wallet.walletAddress,
            toAddress: input.toAddress,
            makerId,
          },
          include: { wallet: true },
        });
        await tx.operation.create({
          data: {
            id: transferId,
            reference: `OP-${reference}`,
            idempotencyKey: `crypto:${input.idempotencyKey}`,
            customerId: input.customerId,
            type: 'PAYOUT',
            status: 'SUBMITTED',
            currency: 'USDT',
            amount: netAmount,
            feeAmount: withdrawalFee,
            sourceAccountId: mirrorAccount.id,
            beneficiaryId: input.beneficiaryId,
            makerId,
            narrative: `USDT TRON withdrawal ${reference}`,
            submittedAt: new Date(),
            metadata: {
              rail: 'TRON',
              cryptoTransferId: transferId,
              withdrawalFee: resolvedFee.snapshot,
            },
          },
        });
        return transfer;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async approve(id: string, checkerId: string) {
    return this.db.$transaction(async (tx) => {
      const transfer = await tx.cryptoTransfer.findUnique({
        where: { id },
        include: { customer: { select: { organizationId: true } } },
      });
      if (!transfer) throw new NotFoundException('crypto_transfer_not_found');
      if (transfer.status !== 'SUBMITTED') throw new ConflictException('transfer_not_submitted');
      const checker = await this.requireRole(tx, checkerId, ['ADMIN']);
      if (checker.organizationId !== transfer.customer.organizationId) {
        throw new NotFoundException('crypto_transfer_not_found');
      }
      if (transfer.makerId === checkerId && checker.role !== 'ADMIN') {
        throw new ForbiddenException('admin_required_for_self_approval');
      }
      await tx.operation.updateMany({
        where: { id: transfer.id, status: 'SUBMITTED' },
        data: { status: 'PROCESSING', checkerId, approvedAt: new Date() },
      });
      return tx.cryptoTransfer.update({
        where: { id },
        data: { status: 'PROCESSING', checkerId, approvedAt: new Date() },
        include: { wallet: true },
      });
    });
  }

  async reject(id: string, reason: string, checkerId: string) {
    if (!reason.trim()) throw new BadRequestException('rejection_reason_required');
    return this.db.$transaction(async (tx) => {
      const transfer = await tx.cryptoTransfer.findUnique({
        where: { id },
        include: { customer: { select: { organizationId: true } } },
      });
      if (!transfer) throw new NotFoundException('crypto_transfer_not_found');
      if (transfer.status !== 'SUBMITTED') throw new ConflictException('transfer_not_submitted');
      const checker = await this.requireRole(tx, checkerId, ['ADMIN']);
      if (checker.organizationId !== transfer.customer.organizationId) {
        throw new NotFoundException('crypto_transfer_not_found');
      }
      if (transfer.makerId === checkerId && checker.role !== 'ADMIN') {
        throw new ForbiddenException('admin_required_for_self_approval');
      }
      await tx.cryptoWallet.update({
        where: { id: transfer.walletId },
        data: {
          availableBalance: { increment: transfer.amount },
          frozenBalance: { decrement: transfer.amount },
          version: { increment: 1 },
        },
      });
      const mirrorAccount = await this.mirrorAccount(tx, transfer.customerId);
      if (!mirrorAccount) throw new ConflictException('crypto_account_mirror_not_configured');
      const mirrorReleased = await tx.account.updateMany({
        where: { id: mirrorAccount.id, frozenBalance: { gte: transfer.amount } },
        data: {
          availableBalance: { increment: transfer.amount },
          frozenBalance: { decrement: transfer.amount },
          version: { increment: 1 },
        },
      });
      if (mirrorReleased.count !== 1) {
        throw new ConflictException('crypto_account_mirror_balance_mismatch');
      }
      await tx.operation.updateMany({
        where: { id: transfer.id, status: 'SUBMITTED' },
        data: {
          status: 'REJECTED',
          checkerId,
          rejectionReason: reason.trim(),
          approvedAt: new Date(),
        },
      });
      return tx.cryptoTransfer.update({
        where: { id },
        data: {
          status: 'REJECTED',
          checkerId,
          rejectionReason: reason.trim(),
          approvedAt: new Date(),
        },
        include: { wallet: true },
      });
    });
  }

  async execute(id: string, txHash: string, operatorId: string) {
    return this.db.$transaction(async (tx) => {
      const transfer = await tx.cryptoTransfer.findUnique({
        where: { id },
        include: { customer: { select: { organizationId: true } } },
      });
      if (!transfer) throw new NotFoundException('crypto_transfer_not_found');
      if (transfer.status !== 'PROCESSING') throw new ConflictException('transfer_not_processing');
      const operator = await this.requireRole(tx, operatorId, ['ADMIN']);
      if (operator.organizationId !== transfer.customer.organizationId) {
        throw new NotFoundException('crypto_transfer_not_found');
      }
      if (!/^0x[a-fA-F0-9]{64}$/.test(txHash))
        throw new BadRequestException('invalid_transaction_hash');
      await tx.cryptoWallet.update({
        where: { id: transfer.walletId },
        data: { frozenBalance: { decrement: transfer.amount }, version: { increment: 1 } },
      });
      const mirrorAccount = await this.mirrorAccount(tx, transfer.customerId);
      if (!mirrorAccount) throw new ConflictException('crypto_account_mirror_not_configured');
      const mirrorConsumed = await tx.account.updateMany({
        where: { id: mirrorAccount.id, frozenBalance: { gte: transfer.amount } },
        data: { frozenBalance: { decrement: transfer.amount }, version: { increment: 1 } },
      });
      if (mirrorConsumed.count !== 1) {
        throw new ConflictException('crypto_account_mirror_balance_mismatch');
      }
      const linkedOperation = await tx.operation.findUnique({ where: { id: transfer.id } });
      if (linkedOperation) {
        const [clearing, feeAccount] = await Promise.all([
          tx.account.findFirst({
            where: { kind: 'PLATFORM_CLEARING', currency: 'USDT', status: 'ACTIVE' },
          }),
          tx.account.findFirst({
            where: { kind: 'FEE_REVENUE', currency: 'USDT', status: 'ACTIVE' },
          }),
        ]);
        if (!clearing || !feeAccount) {
          throw new ConflictException('crypto_ledger_accounts_not_configured');
        }
        await tx.journalEntry.create({
          data: {
            reference: `${linkedOperation.reference}-principal`,
            operationId: linkedOperation.id,
            description: linkedOperation.narrative || `USDT withdrawal ${transfer.reference}`,
            lines: {
              create: [
                {
                  accountId: mirrorAccount.id,
                  side: JournalSide.DEBIT,
                  currency: 'USDT',
                  amount: transfer.netAmount,
                },
                {
                  accountId: clearing.id,
                  side: JournalSide.CREDIT,
                  currency: 'USDT',
                  amount: transfer.netAmount,
                },
              ],
            },
          },
        });
        if (!transfer.feeAmount.isZero()) {
          await tx.journalEntry.create({
            data: {
              reference: `${linkedOperation.reference}-fee`,
              operationId: linkedOperation.id,
              description: `USDT TRON network fee ${transfer.reference}`,
              lines: {
                create: [
                  {
                    accountId: mirrorAccount.id,
                    side: JournalSide.DEBIT,
                    currency: 'USDT',
                    amount: transfer.feeAmount,
                  },
                  {
                    accountId: feeAccount.id,
                    side: JournalSide.CREDIT,
                    currency: 'USDT',
                    amount: transfer.feeAmount,
                  },
                ],
              },
            },
          });
        }
        await tx.operation.update({
          where: { id: linkedOperation.id },
          data: {
            status: 'COMPLETED',
            operatorId,
            externalReference: txHash,
            executedAt: new Date(),
          },
        });
      }
      return tx.cryptoTransfer.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          operatorId,
          txHash,
          confirmations: transfer.network === 'TRON' ? 20 : 12,
          completedAt: new Date(),
        },
        include: { wallet: true },
      });
    });
  }

  private validateAddress(network: CryptoNetwork, address: string) {
    const valid =
      network === 'TRON' ? isValidTronAddress(address) : /^0x[a-fA-F0-9]{40}$/.test(address);
    if (!valid) throw new BadRequestException('invalid_destination_address');
  }

  private async requireRole(tx: Prisma.TransactionClient, userId: string, roles: UserRole[]) {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || !user.active || !roles.includes(user.role)) {
      throw new ForbiddenException('insufficient_crypto_operation_role');
    }
    return user;
  }

  private mirrorAccount(tx: Prisma.TransactionClient, customerId: string) {
    return tx.account.findFirst({
      where: {
        customerId,
        kind: 'CRYPTO_WALLET',
        currency: 'USDT',
        network: supportedCryptoNetwork,
        status: 'ACTIVE',
      },
    });
  }

  private async requireCustomerTenant(customerId: string, userId: string) {
    const [customer, user] = await Promise.all([
      this.db.customer.findUnique({
        where: { id: customerId },
        select: { organizationId: true },
      }),
      this.db.user.findUnique({
        where: { id: userId },
        select: { active: true, organizationId: true, role: true },
      }),
    ]);
    if (!customer) throw new NotFoundException('customer_not_found');
    if (
      !user?.active ||
      user.role !== 'ADMIN' ||
      !user.organizationId ||
      user.organizationId !== customer.organizationId
    ) {
      throw new ForbiddenException('cross_tenant_crypto_customer');
    }
    return customer;
  }

  private reference(prefix: string) {
    return `${prefix}${Date.now()}${randomBytes(3).toString('hex').toUpperCase()}`;
  }
}
