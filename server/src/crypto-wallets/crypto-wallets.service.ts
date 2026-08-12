import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CryptoNetwork,
  CryptoTransferDirection,
  CryptoTransferStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';

type CreateWithdrawalInput = {
  customerId: string;
  walletId: string;
  network: CryptoNetwork;
  amount: string;
  toAddress: string;
  idempotencyKey: string;
};

@Injectable()
export class CryptoWalletsService {
  constructor(private readonly db: PrismaService) {}

  listWallets(customerId: string) {
    return this.db.cryptoWallet.findMany({
      where: { customerId },
      orderBy: { network: 'asc' },
    });
  }

  listTransfers(
    customerId: string,
    direction?: CryptoTransferDirection,
    status?: CryptoTransferStatus
  ) {
    return this.db.cryptoTransfer.findMany({
      where: { customerId, ...(direction ? { direction } : {}), ...(status ? { status } : {}) },
      include: {
        wallet: true,
        maker: { select: { id: true, displayName: true } },
        checker: { select: { id: true, displayName: true } },
        operator: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async qrCode(id: string, customerId: string) {
    const wallet = await this.db.cryptoWallet.findFirst({ where: { id, customerId } });
    if (!wallet) throw new NotFoundException('crypto_wallet_not_found');
    return {
      dataUrl: await QRCode.toDataURL(wallet.walletAddress, {
        width: 280,
        margin: 2,
        color: { dark: '#0B1F1A', light: '#FFFFFFFF' },
      }),
    };
  }

  async createWithdrawal(input: CreateWithdrawalInput, makerId: string) {
    const amount = new Prisma.Decimal(input.amount);
    if (!amount.isPositive()) throw new BadRequestException('withdrawal_amount_must_be_positive');
    this.validateAddress(input.network, input.toAddress);

    return this.db.$transaction(
      async (tx) => {
        const existing = await tx.cryptoTransfer.findFirst({
          where: { customerId: input.customerId, idempotencyKey: input.idempotencyKey },
        });
        if (existing) return existing;
        const wallet = await tx.cryptoWallet.findUnique({ where: { id: input.walletId } });
        if (
          !wallet ||
          wallet.customerId !== input.customerId ||
          wallet.network !== input.network ||
          wallet.status !== 'ACTIVE'
        ) {
          throw new BadRequestException('invalid_crypto_wallet');
        }
        const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
        if (!customer || customer.status !== 'ACTIVE') {
          throw new ForbiddenException('active_customer_required');
        }
        if (amount.lte(wallet.withdrawalFee)) {
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
        const netAmount = amount.sub(wallet.withdrawalFee);
        return tx.cryptoTransfer.create({
          data: {
            reference: this.reference('CWO'),
            idempotencyKey: input.idempotencyKey,
            customerId: input.customerId,
            walletId: wallet.id,
            asset: wallet.asset,
            network: wallet.network,
            direction: 'WITHDRAWAL',
            status: 'SUBMITTED',
            amount,
            feeAmount: wallet.withdrawalFee,
            netAmount,
            fromAddress: wallet.walletAddress,
            toAddress: input.toAddress,
            makerId,
          },
          include: { wallet: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async approve(id: string, checkerId: string) {
    return this.db.$transaction(async (tx) => {
      const transfer = await tx.cryptoTransfer.findUnique({ where: { id } });
      if (!transfer) throw new NotFoundException('crypto_transfer_not_found');
      if (transfer.status !== 'SUBMITTED') throw new ConflictException('transfer_not_submitted');
      if (transfer.makerId === checkerId) {
        throw new ForbiddenException('maker_cannot_approve_own_crypto_transfer');
      }
      await this.requireRole(tx, checkerId, ['ADMIN', 'CHECKER']);
      return tx.cryptoTransfer.update({
        where: { id },
        data: { status: 'PROCESSING', checkerId, approvedAt: new Date() },
        include: { wallet: true },
      });
    });
  }

  async reject(id: string, reason: string, checkerId: string) {
    return this.db.$transaction(async (tx) => {
      const transfer = await tx.cryptoTransfer.findUnique({ where: { id } });
      if (!transfer) throw new NotFoundException('crypto_transfer_not_found');
      if (transfer.status !== 'SUBMITTED') throw new ConflictException('transfer_not_submitted');
      if (transfer.makerId === checkerId) {
        throw new ForbiddenException('maker_cannot_review_own_crypto_transfer');
      }
      await this.requireRole(tx, checkerId, ['ADMIN', 'CHECKER']);
      await tx.cryptoWallet.update({
        where: { id: transfer.walletId },
        data: {
          availableBalance: { increment: transfer.amount },
          frozenBalance: { decrement: transfer.amount },
          version: { increment: 1 },
        },
      });
      return tx.cryptoTransfer.update({
        where: { id },
        data: { status: 'REJECTED', checkerId, rejectionReason: reason, approvedAt: new Date() },
        include: { wallet: true },
      });
    });
  }

  async execute(id: string, txHash: string, operatorId: string) {
    return this.db.$transaction(async (tx) => {
      const transfer = await tx.cryptoTransfer.findUnique({ where: { id } });
      if (!transfer) throw new NotFoundException('crypto_transfer_not_found');
      if (transfer.status !== 'PROCESSING') throw new ConflictException('transfer_not_processing');
      await this.requireRole(tx, operatorId, ['ADMIN', 'OPERATOR']);
      if (!/^0x[a-fA-F0-9]{64}$/.test(txHash))
        throw new BadRequestException('invalid_transaction_hash');
      await tx.cryptoWallet.update({
        where: { id: transfer.walletId },
        data: { frozenBalance: { decrement: transfer.amount }, version: { increment: 1 } },
      });
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
      network === 'TRON'
        ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)
        : /^0x[a-fA-F0-9]{40}$/.test(address);
    if (!valid) throw new BadRequestException('invalid_destination_address');
  }

  private async requireRole(tx: Prisma.TransactionClient, userId: string, roles: UserRole[]) {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || !user.active || !roles.includes(user.role)) {
      throw new ForbiddenException('insufficient_crypto_operation_role');
    }
  }

  private reference(prefix: string) {
    return `${prefix}${Date.now()}${randomBytes(3).toString('hex').toUpperCase()}`;
  }
}
