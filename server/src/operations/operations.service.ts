import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountKind,
  AccountStatus,
  AdjustmentDirection,
  BeneficiaryType,
  ChannelType,
  Currency,
  JournalSide,
  Operation,
  OperationStatus,
  OperationType,
  PayoutMethod,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { requireActiveUser, requireOrganizationAccess } from '../common/tenant-access';
import { PrismaService } from '../prisma/prisma.service';
import { isSupportedFiatCurrency, supportedCryptoNetwork } from '../supported-assets';
import { WithdrawalFeesService } from '../withdrawal-fees/withdrawal-fees.service';

type CreateOperationInput = {
  customerId: string;
  type: OperationType;
  currency: Currency;
  amount: string;
  feeAmount?: string;
  expectedFeeAmount?: string;
  expectedFeeRuleVersion?: string;
  sourceAccountId?: string;
  targetAccountId?: string;
  beneficiaryId?: string;
  channelId?: string;
  payoutMethod?: PayoutMethod;
  adjustmentDirection?: AdjustmentDirection;
  quoteCurrency?: Currency;
  narrative?: string;
  idempotencyKey?: string;
  remitterName?: string;
  remitterBank?: string;
  remittanceReference?: string;
  receivedAt?: string;
  proofUrl?: string;
  marketProvider?: string;
  marketPriceType?: string;
  marketReferenceOnly?: boolean;
  marketRate?: string;
  marketUpdatedAt?: string;
  marketFetchedAt?: string;
};

const operationInclude = {
  customer: true,
  sourceAccount: true,
  targetAccount: true,
  beneficiary: true,
  channel: true,
  maker: { select: { id: true, displayName: true, email: true } },
  checker: { select: { id: true, displayName: true, email: true } },
  operator: { select: { id: true, displayName: true, email: true } },
} satisfies Prisma.OperationInclude;

@Injectable()
export class OperationsService {
  constructor(
    private readonly db: PrismaService,
    private readonly withdrawalFees: WithdrawalFeesService
  ) {}

  async list(
    filters: {
      organizationId: string;
      status?: OperationStatus;
      type?: OperationType;
      customerId?: string;
    },
    userId: string
  ) {
    await requireOrganizationAccess(this.db, userId, filters.organizationId);
    return this.db.operation.findMany({
      where: {
        customer: { organizationId: filters.organizationId },
        metadata: { path: ['cryptoTransferId'], equals: Prisma.AnyNull },
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
      },
      include: operationInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async approvals(organizationId: string, userId: string) {
    const user = await requireOrganizationAccess(this.db, userId, organizationId);
    return this.db.operation.findMany({
      where: {
        customer: { organizationId },
        status: 'SUBMITTED',
        metadata: { path: ['cryptoTransferId'], equals: Prisma.AnyNull },
        ...(user.role === 'ADMIN' ? {} : { makerId: { not: userId } }),
      },
      include: operationInclude,
      orderBy: { submittedAt: 'desc' },
    });
  }

  async get(id: string, userId: string) {
    const user = await requireActiveUser(this.db, userId);
    const operation = await this.db.operation.findUnique({
      where: { id },
      include: {
        ...operationInclude,
        journals: { include: { lines: { include: { account: true } } } },
      },
    });
    if (!operation || operation.customer.organizationId !== user.organizationId) {
      throw new NotFoundException('operation_not_found');
    }
    return operation;
  }

  async create(input: CreateOperationInput, makerId: string) {
    if (input.type === 'INTERNAL_TRANSFER') {
      throw new BadRequestException('internal_transfer_not_supported');
    }
    if (input.currency !== 'USDT' && !isSupportedFiatCurrency(input.currency)) {
      throw new BadRequestException('unsupported_currency');
    }
    if (
      input.quoteCurrency &&
      input.quoteCurrency !== 'USDT' &&
      !isSupportedFiatCurrency(input.quoteCurrency)
    ) {
      throw new BadRequestException('unsupported_quote_currency');
    }
    const amount = this.positiveMoney(input.amount, 'amount', input.currency);
    const requestedFeeAmount = new Prisma.Decimal(input.feeAmount || 0);
    if (requestedFeeAmount.isNegative()) throw new BadRequestException('fee_must_not_be_negative');

    const [maker, customer, source, target, channel, beneficiary] = await Promise.all([
      this.db.user.findUnique({ where: { id: makerId } }),
      this.db.customer.findUnique({ where: { id: input.customerId } }),
      input.sourceAccountId
        ? this.db.account.findUnique({ where: { id: input.sourceAccountId } })
        : null,
      input.targetAccountId
        ? this.db.account.findUnique({ where: { id: input.targetAccountId } })
        : null,
      input.channelId
        ? this.db.fundingChannel.findUnique({ where: { id: input.channelId } })
        : null,
      input.beneficiaryId
        ? this.db.beneficiary.findUnique({ where: { id: input.beneficiaryId } })
        : null,
    ]);
    if (!maker || !maker.active || maker.role !== 'ADMIN') {
      throw new ForbiddenException('admin_role_required');
    }
    if (!customer) throw new NotFoundException('customer_not_found');
    if (maker.organizationId && maker.organizationId !== customer.organizationId) {
      throw new ForbiddenException('cross_tenant_operation');
    }
    if (channel && channel.organizationId !== customer.organizationId)
      throw new ForbiddenException('cross_tenant_channel');
    this.validateShape(input, source, target, channel, beneficiary);

    const reference = `OP-${new Date()
      .toISOString()
      .slice(0, 10)
      .replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const frozen =
      input.type === 'PAYOUT' ||
      input.type === 'FX' ||
      input.type === 'OTC' ||
      (input.type === 'ADJUSTMENT' && input.adjustmentDirection === 'DEBIT');
    try {
      return await this.db.$transaction(
        async (tx) => {
          if (input.idempotencyKey) {
            const existing = await tx.operation.findFirst({
              where: { customerId: input.customerId, idempotencyKey: input.idempotencyKey },
              include: operationInclude,
            });
            if (existing) return existing;
          }
          if (input.type === 'DEPOSIT' && input.channelId && input.remittanceReference) {
            const existingReceipt = await tx.operation.findFirst({
              where: {
                channelId: input.channelId,
                remittanceReference: input.remittanceReference.trim(),
              },
              include: operationInclude,
            });
            if (existingReceipt) {
              const sameReceipt =
                existingReceipt.type === 'DEPOSIT' &&
                existingReceipt.customerId === input.customerId &&
                existingReceipt.targetAccountId === input.targetAccountId &&
                existingReceipt.currency === input.currency &&
                existingReceipt.amount.equals(amount);
              if (sameReceipt) return existingReceipt;
              throw new ConflictException('duplicate_remittance_reference');
            }
          }
          let feeAmount = requestedFeeAmount;
          let withdrawalFeeSnapshot: Record<string, string> | undefined;
          let conversionSnapshot:
            | {
                rateVersionId: string;
                customerRate: Prisma.Decimal;
                quoteAmount: Prisma.Decimal;
                metadata: Record<string, string | number | boolean>;
              }
            | undefined;
          if (input.type === 'PAYOUT') {
            if (!channel || !input.payoutMethod) {
              throw new BadRequestException('payout_details_required');
            }
            const resolvedFee = await this.withdrawalFees.resolve(tx, {
              scopeId: customer.organizationId,
              customerId: input.customerId,
              assetClass: 'FIAT',
              currency: input.currency,
              method: input.payoutMethod,
              channelCode: channel.code,
              expectedVersion: input.expectedFeeRuleVersion,
            });
            feeAmount = resolvedFee.amount;
            withdrawalFeeSnapshot = resolvedFee.snapshot;
            if (
              input.expectedFeeAmount !== undefined &&
              !feeAmount.equals(new Prisma.Decimal(input.expectedFeeAmount))
            ) {
              throw new ConflictException('withdrawal_fee_changed');
            }
          }
          if (input.type === 'FX' || input.type === 'OTC') {
            if (!input.quoteCurrency) throw new BadRequestException('quote_currency_required');
            if (
              input.marketProvider !== 'fastforex' ||
              input.marketPriceType !== 'midpoint_spot' ||
              input.marketReferenceOnly !== true ||
              !input.marketRate ||
              !input.marketUpdatedAt ||
              !input.marketFetchedAt
            ) {
              throw new BadRequestException('live_market_quote_required');
            }
            const fetchedAt = new Date(input.marketFetchedAt);
            const updatedAt = new Date(input.marketUpdatedAt);
            const now = Date.now();
            if (
              !Number.isFinite(fetchedAt.getTime()) ||
              !Number.isFinite(updatedAt.getTime()) ||
              fetchedAt.getTime() < now - 2 * 60 * 1000 ||
              fetchedAt.getTime() > now + 30 * 1000 ||
              updatedAt.getTime() > now + 30 * 1000
            ) {
              throw new ConflictException('live_market_quote_expired');
            }
            let marketRate: Prisma.Decimal;
            try {
              marketRate = new Prisma.Decimal(input.marketRate);
            } catch {
              throw new BadRequestException('invalid_market_rate');
            }
            if (!marketRate.isFinite() || marketRate.lessThanOrEqualTo(0)) {
              throw new BadRequestException('invalid_market_rate');
            }
            const rateVersion = await tx.rateVersion.findFirst({
              where: {
                type: input.type,
                baseCurrency: input.currency,
                quoteCurrency: input.quoteCurrency,
                active: true,
                effectiveFrom: { lte: new Date() },
                OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
              },
              orderBy: { effectiveFrom: 'desc' },
            });
            if (!rateVersion) throw new ConflictException('active_rate_not_found');
            const customerRate = marketRate
              .mul(new Prisma.Decimal(1).sub(new Prisma.Decimal(rateVersion.feeBps).div(10000)))
              .toDecimalPlaces(12);
            conversionSnapshot = {
              rateVersionId: rateVersion.id,
              customerRate,
              quoteAmount: amount.mul(customerRate).toDecimalPlaces(8),
              metadata: {
                provider: input.marketProvider,
                priceType: input.marketPriceType,
                referenceOnly: input.marketReferenceOnly,
                marketRate: marketRate.toString(),
                customerRate: customerRate.toString(),
                feeBps: rateVersion.feeBps,
                updatedAt: updatedAt.toISOString(),
                fetchedAt: fetchedAt.toISOString(),
              },
            };
          }
          const reserve = amount.add(feeAmount);
          if (frozen && source) {
            await this.freeze(tx, source.id, reserve);
            if (input.type === 'OTC' && input.currency === 'USDT') {
              await this.freezeCryptoWallet(tx, input.customerId, reserve);
            }
          }
          return tx.operation.create({
            data: {
              reference,
              idempotencyKey: input.idempotencyKey,
              customerId: input.customerId,
              channelId: input.channelId,
              type: input.type,
              status: 'SUBMITTED',
              currency: input.currency,
              amount,
              feeAmount,
              sourceAccountId: input.sourceAccountId,
              targetAccountId: input.targetAccountId,
              beneficiaryId: input.beneficiaryId,
              payoutMethod: input.payoutMethod,
              adjustmentDirection: input.adjustmentDirection,
              quoteCurrency: input.quoteCurrency,
              quoteAmount: conversionSnapshot?.quoteAmount,
              rate: conversionSnapshot?.customerRate,
              rateVersionId: conversionSnapshot?.rateVersionId,
              makerId,
              narrative: input.narrative,
              remitterName: input.remitterName,
              remitterBank: input.remitterBank,
              remittanceReference: input.remittanceReference?.trim(),
              receivedAt: input.receivedAt ? new Date(input.receivedAt) : undefined,
              proofUrl: input.proofUrl,
              metadata:
                withdrawalFeeSnapshot || conversionSnapshot
                  ? {
                      ...(withdrawalFeeSnapshot ? { withdrawalFee: withdrawalFeeSnapshot } : {}),
                      ...(conversionSnapshot ? { marketQuote: conversionSnapshot.metadata } : {}),
                    }
                  : undefined,
              submittedAt: new Date(),
            },
            include: operationInclude,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        Array.isArray(error.meta?.target) &&
        error.meta.target.includes('remittanceReference')
      ) {
        throw new ConflictException('duplicate_remittance_reference');
      }
      throw error;
    }
  }

  async approve(id: string, checkerId: string) {
    return this.db.$transaction(
      async (tx) => {
        const operation = await tx.operation.findUnique({
          where: { id },
          include: operationInclude,
        });
        if (!operation) throw new NotFoundException('operation_not_found');
        this.requireNonCryptoWorkflow(operation);
        if (operation.status !== 'SUBMITTED')
          throw new ConflictException('operation_not_pending_approval');
        const checker = await this.requireRole(tx, checkerId, ['ADMIN']);
        if (checker.organizationId !== operation.customer.organizationId) {
          throw new NotFoundException('operation_not_found');
        }
        if (operation.makerId === checkerId && checker.role !== 'ADMIN') {
          throw new ForbiddenException('admin_required_for_self_approval');
        }

        if (operation.type === 'PAYOUT') {
          return tx.operation.update({
            where: { id },
            data: { status: 'PROCESSING', checkerId, approvedAt: new Date() },
            include: operationInclude,
          });
        }

        await this.postApprovedOperation(tx, operation);
        return tx.operation.update({
          where: { id },
          data: { status: 'COMPLETED', checkerId, approvedAt: new Date(), executedAt: new Date() },
          include: operationInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async reject(id: string, reason: string, checkerId: string) {
    if (!reason.trim()) throw new BadRequestException('rejection_reason_required');
    return this.db.$transaction(
      async (tx) => {
        const operation = await tx.operation.findUnique({
          where: { id },
          include: operationInclude,
        });
        if (!operation) throw new NotFoundException('operation_not_found');
        this.requireNonCryptoWorkflow(operation);
        if (operation.status !== 'SUBMITTED')
          throw new ConflictException('operation_not_pending_approval');
        const checker = await this.requireRole(tx, checkerId, ['ADMIN']);
        if (checker.organizationId !== operation.customer.organizationId) {
          throw new NotFoundException('operation_not_found');
        }
        if (operation.makerId === checkerId && checker.role !== 'ADMIN') {
          throw new ForbiddenException('admin_required_for_self_approval');
        }
        if (this.usesReservation(operation) && operation.sourceAccountId) {
          await this.unfreeze(
            tx,
            operation.sourceAccountId,
            operation.amount.add(operation.feeAmount)
          );
          if (operation.type === 'OTC' && operation.currency === 'USDT') {
            await this.unfreezeCryptoWallet(
              tx,
              operation.customerId,
              operation.amount.add(operation.feeAmount)
            );
          }
        }
        return tx.operation.update({
          where: { id },
          data: {
            status: 'REJECTED',
            checkerId,
            approvedAt: new Date(),
            rejectionReason: reason.trim(),
          },
          include: operationInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async execute(id: string, externalReference: string, operatorId: string) {
    if (!externalReference.trim()) throw new BadRequestException('external_reference_required');
    return this.db.$transaction(
      async (tx) => {
        const operation = await tx.operation.findUnique({
          where: { id },
          include: operationInclude,
        });
        if (!operation) throw new NotFoundException('operation_not_found');
        this.requireNonCryptoWorkflow(operation);
        if (operation.type !== 'PAYOUT' || operation.status !== 'PROCESSING') {
          throw new ConflictException('payout_not_ready_for_execution');
        }
        const operator = await this.requireRole(tx, operatorId, ['ADMIN']);
        if (operator.organizationId !== operation.customer.organizationId) {
          throw new NotFoundException('operation_not_found');
        }
        await this.postPayout(tx, operation);
        return tx.operation.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            operatorId,
            externalReference: externalReference.trim(),
            executedAt: new Date(),
          },
          include: operationInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  private validateShape(
    input: CreateOperationInput,
    source: {
      id: string;
      customerId: string | null;
      kind: AccountKind;
      status: AccountStatus;
      currency: Currency;
      network: string | null;
      fundingChannelId: string | null;
    } | null,
    target: {
      id: string;
      customerId: string | null;
      kind: AccountKind;
      status: AccountStatus;
      currency: Currency;
      network: string | null;
    } | null,
    channel: {
      id: string;
      type: ChannelType;
      supportedCurrencies: Currency[];
      active: boolean;
    } | null,
    beneficiary: {
      customerId: string;
      type: BeneficiaryType;
      currency: Currency;
      active: boolean;
    } | null
  ) {
    if (input.currency === 'USDT' && input.type !== 'OTC') {
      throw new BadRequestException('crypto_wallet_operations_disabled_until_cregis');
    }
    if (source && (source.status !== 'ACTIVE' || source.currency !== input.currency)) {
      throw new BadRequestException('invalid_source_account');
    }
    if (source && source.customerId !== input.customerId) {
      throw new BadRequestException('source_account_customer_mismatch');
    }
    if (target && target.status !== 'ACTIVE')
      throw new BadRequestException('invalid_target_account');
    if (
      [source, target].some(
        (account) =>
          account?.currency === 'USDT' &&
          (account.kind !== 'CRYPTO_WALLET' || account.network !== supportedCryptoNetwork)
      )
    ) {
      throw new BadRequestException('unsupported_crypto_account');
    }
    if (channel && (!channel.active || !channel.supportedCurrencies.includes(input.currency))) {
      throw new BadRequestException('channel_does_not_support_currency');
    }
    if (input.type === 'DEPOSIT') {
      if (!target || !channel || channel.type !== 'FIAT_INBOUND' || input.currency === 'USDT') {
        throw new BadRequestException('fiat_deposit_requires_target_and_inbound_channel');
      }
      if (!input.remitterName || !input.remittanceReference || !input.receivedAt) {
        throw new BadRequestException('deposit_remittance_details_required');
      }
      if (target.customerId !== input.customerId)
        throw new BadRequestException('deposit_target_customer_mismatch');
      if (target.currency !== input.currency)
        throw new BadRequestException('deposit_target_currency_mismatch');
    }
    if (input.type === 'PAYOUT') {
      if (!source || !input.beneficiaryId || !input.payoutMethod || !channel) {
        throw new BadRequestException('payout_details_required');
      }
      const allowedSourceKinds: AccountKind[] =
        input.payoutMethod === 'VA'
          ? ['VIRTUAL_ACCOUNT']
          : input.payoutMethod === 'POBO'
          ? ['SYSTEM_WALLET', 'VIRTUAL_ACCOUNT']
          : ['SYSTEM_WALLET'];
      const expectedChannel: ChannelType =
        input.payoutMethod === 'VA'
          ? 'VIRTUAL_ACCOUNT'
          : input.payoutMethod === 'POBO'
          ? 'POBO_PAYOUT'
          : 'PLATFORM_PAYOUT';
      const vaChannelMismatch =
        input.payoutMethod === 'VA' && source.fundingChannelId !== channel.id;
      if (
        !allowedSourceKinds.includes(source.kind) ||
        channel.type !== expectedChannel ||
        vaChannelMismatch
      ) {
        throw new BadRequestException('payout_source_or_channel_mismatch');
      }
      if (
        source.customerId !== input.customerId ||
        !beneficiary ||
        !beneficiary.active ||
        beneficiary.type !== BeneficiaryType.BANK ||
        beneficiary.customerId !== input.customerId ||
        beneficiary.currency !== input.currency
      ) {
        throw new BadRequestException('payout_customer_or_beneficiary_mismatch');
      }
    }
    if (input.type === 'INTERNAL_TRANSFER') {
      if (
        !source ||
        !target ||
        !target.customerId ||
        source.id === target.id ||
        target.currency !== input.currency
      ) {
        throw new BadRequestException('invalid_internal_transfer_accounts');
      }
    }
    if (input.type === 'FX' || input.type === 'OTC') {
      if (
        !source ||
        !target ||
        !input.quoteCurrency ||
        target.currency !== input.quoteCurrency ||
        input.currency === input.quoteCurrency
      ) {
        throw new BadRequestException('invalid_conversion_accounts');
      }
      if (input.type === 'FX' && (input.currency === 'USDT' || input.quoteCurrency === 'USDT')) {
        throw new BadRequestException('fx_is_fiat_only');
      }
      if (input.type === 'OTC' && input.currency !== 'USDT' && input.quoteCurrency !== 'USDT') {
        throw new BadRequestException('otc_requires_usdt_leg');
      }
      if (target.customerId !== input.customerId) {
        throw new BadRequestException('conversion_target_customer_mismatch');
      }
    }
    if (input.type === 'ADJUSTMENT') {
      if (
        !input.adjustmentDirection ||
        (input.adjustmentDirection === 'CREDIT' ? !target : !source)
      ) {
        throw new BadRequestException('adjustment_direction_account_required');
      }
      const adjustmentAccount = input.adjustmentDirection === 'CREDIT' ? target : source;
      if (adjustmentAccount?.customerId !== input.customerId) {
        throw new BadRequestException('adjustment_account_customer_mismatch');
      }
    }
  }

  private requireNonCryptoWorkflow(operation: Operation) {
    const metadata = operation.metadata;
    if (
      metadata &&
      typeof metadata === 'object' &&
      !Array.isArray(metadata) &&
      'cryptoTransferId' in metadata
    ) {
      throw new ConflictException('crypto_transfer_requires_crypto_workflow');
    }
  }

  private async postApprovedOperation(tx: Prisma.TransactionClient, operation: Operation) {
    if (
      operation.type === 'DEPOSIT' ||
      (operation.type === 'ADJUSTMENT' && operation.adjustmentDirection === 'CREDIT')
    ) {
      if (!operation.targetAccountId) throw new BadRequestException('target_account_required');
      const clearing = await this.clearingAccount(tx, operation.currency);
      await this.creditAvailable(tx, operation.targetAccountId, operation.amount);
      await this.journal(tx, operation, [
        [clearing.id, JournalSide.DEBIT, operation.currency, operation.amount],
        [operation.targetAccountId, JournalSide.CREDIT, operation.currency, operation.amount],
      ]);
      return;
    }
    if (operation.type === 'INTERNAL_TRANSFER') {
      if (!operation.sourceAccountId || !operation.targetAccountId)
        throw new BadRequestException('transfer_accounts_required');
      await this.consumeFrozen(
        tx,
        operation.sourceAccountId,
        operation.amount.add(operation.feeAmount)
      );
      await this.creditAvailable(tx, operation.targetAccountId, operation.amount);
      await this.journal(tx, operation, [
        [operation.sourceAccountId, JournalSide.DEBIT, operation.currency, operation.amount],
        [operation.targetAccountId, JournalSide.CREDIT, operation.currency, operation.amount],
      ]);
      await this.postFee(tx, operation);
      return;
    }
    if (operation.type === 'FX' || operation.type === 'OTC') {
      await this.postConversion(tx, operation);
      return;
    }
    if (operation.type === 'ADJUSTMENT' && operation.adjustmentDirection === 'DEBIT') {
      if (!operation.sourceAccountId) throw new BadRequestException('source_account_required');
      const clearing = await this.clearingAccount(tx, operation.currency);
      await this.consumeFrozen(tx, operation.sourceAccountId, operation.amount);
      await this.journal(tx, operation, [
        [operation.sourceAccountId, JournalSide.DEBIT, operation.currency, operation.amount],
        [clearing.id, JournalSide.CREDIT, operation.currency, operation.amount],
      ]);
    }
  }

  private async postConversion(tx: Prisma.TransactionClient, operation: Operation) {
    if (!operation.sourceAccountId || !operation.targetAccountId || !operation.quoteCurrency) {
      throw new BadRequestException('conversion_accounts_required');
    }
    if (!operation.rate || !operation.quoteAmount || !operation.rateVersionId) {
      throw new ConflictException('conversion_quote_snapshot_missing');
    }
    const quoteAmount = operation.quoteAmount;
    const sourceClearing = await this.clearingAccount(tx, operation.currency);
    const targetClearing = await this.clearingAccount(tx, operation.quoteCurrency);
    await this.consumeFrozen(
      tx,
      operation.sourceAccountId,
      operation.amount.add(operation.feeAmount)
    );
    if (operation.currency === 'USDT') {
      await this.consumeCryptoWalletFrozen(
        tx,
        operation.customerId,
        operation.amount.add(operation.feeAmount)
      );
    }
    await this.creditAvailable(tx, operation.targetAccountId, quoteAmount);
    if (operation.quoteCurrency === 'USDT') {
      await this.creditCryptoWallet(tx, operation.customerId, quoteAmount);
    }
    await this.journal(tx, operation, [
      [operation.sourceAccountId, JournalSide.DEBIT, operation.currency, operation.amount],
      [sourceClearing.id, JournalSide.CREDIT, operation.currency, operation.amount],
      [targetClearing.id, JournalSide.DEBIT, operation.quoteCurrency, quoteAmount],
      [operation.targetAccountId, JournalSide.CREDIT, operation.quoteCurrency, quoteAmount],
    ]);
    await tx.operation.update({
      where: { id: operation.id },
      data: { quoteAmount, rate: operation.rate, rateVersionId: operation.rateVersionId },
    });
    await this.postFee(tx, operation);
  }

  private async postPayout(tx: Prisma.TransactionClient, operation: Operation) {
    if (!operation.sourceAccountId) throw new BadRequestException('source_account_required');
    const clearing = await this.clearingAccount(tx, operation.currency);
    await this.consumeFrozen(
      tx,
      operation.sourceAccountId,
      operation.amount.add(operation.feeAmount)
    );
    await this.journal(tx, operation, [
      [operation.sourceAccountId, JournalSide.DEBIT, operation.currency, operation.amount],
      [clearing.id, JournalSide.CREDIT, operation.currency, operation.amount],
    ]);
    await this.postFee(tx, operation);
  }

  private async postFee(tx: Prisma.TransactionClient, operation: Operation) {
    if (operation.feeAmount.isZero() || !operation.sourceAccountId) return;
    const fee = await tx.account.findFirst({
      where: { kind: 'FEE_REVENUE', currency: operation.currency },
    });
    if (!fee) throw new ConflictException('fee_account_not_configured');
    await this.journal(
      tx,
      operation,
      [
        [operation.sourceAccountId, JournalSide.DEBIT, operation.currency, operation.feeAmount],
        [fee.id, JournalSide.CREDIT, operation.currency, operation.feeAmount],
      ],
      'fee'
    );
  }

  private async journal(
    tx: Prisma.TransactionClient,
    operation: Operation,
    lines: Array<[string, JournalSide, Currency, Prisma.Decimal]>,
    suffix = 'principal'
  ) {
    const totals = new Map<Currency, Prisma.Decimal>();
    for (const [, side, currency, amount] of lines) {
      const signed = side === 'DEBIT' ? amount : amount.negated();
      totals.set(currency, (totals.get(currency) || new Prisma.Decimal(0)).add(signed));
    }
    if ([...totals.values()].some((total) => !total.isZero()))
      throw new ConflictException('unbalanced_journal');
    await tx.journalEntry.create({
      data: {
        reference: `${operation.reference}-${suffix}`,
        operationId: operation.id,
        description: operation.narrative || `${operation.type} ${operation.reference}`,
        lines: {
          create: lines.map(([accountId, side, currency, amount]) => ({
            accountId,
            side,
            currency,
            amount,
          })),
        },
      },
    });
  }

  private clearingAccount(tx: Prisma.TransactionClient, currency: Currency) {
    return tx.account.findFirstOrThrow({
      where: { kind: 'PLATFORM_CLEARING', currency, status: 'ACTIVE' },
    });
  }

  private async freeze(tx: Prisma.TransactionClient, accountId: string, amount: Prisma.Decimal) {
    const result = await tx.account.updateMany({
      where: { id: accountId, status: 'ACTIVE', availableBalance: { gte: amount } },
      data: {
        availableBalance: { decrement: amount },
        frozenBalance: { increment: amount },
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new ConflictException('insufficient_available_balance');
  }

  private async unfreeze(tx: Prisma.TransactionClient, accountId: string, amount: Prisma.Decimal) {
    const result = await tx.account.updateMany({
      where: { id: accountId, frozenBalance: { gte: amount } },
      data: {
        availableBalance: { increment: amount },
        frozenBalance: { decrement: amount },
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new ConflictException('invalid_frozen_balance');
  }

  private async consumeFrozen(
    tx: Prisma.TransactionClient,
    accountId: string,
    amount: Prisma.Decimal
  ) {
    const result = await tx.account.updateMany({
      where: { id: accountId, frozenBalance: { gte: amount } },
      data: { frozenBalance: { decrement: amount }, version: { increment: 1 } },
    });
    if (result.count !== 1) throw new ConflictException('invalid_frozen_balance');
  }

  private async creditAvailable(
    tx: Prisma.TransactionClient,
    accountId: string,
    amount: Prisma.Decimal
  ) {
    const result = await tx.account.updateMany({
      where: { id: accountId, status: 'ACTIVE' },
      data: { availableBalance: { increment: amount }, version: { increment: 1 } },
    });
    if (result.count !== 1) throw new ConflictException('target_account_unavailable');
  }

  private async freezeCryptoWallet(
    tx: Prisma.TransactionClient,
    customerId: string,
    amount: Prisma.Decimal
  ) {
    const result = await tx.cryptoWallet.updateMany({
      where: {
        customerId,
        asset: 'USDT',
        network: 'TRON',
        status: 'ACTIVE',
        availableBalance: { gte: amount },
      },
      data: {
        availableBalance: { decrement: amount },
        frozenBalance: { increment: amount },
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new ConflictException('insufficient_crypto_balance');
  }

  private async unfreezeCryptoWallet(
    tx: Prisma.TransactionClient,
    customerId: string,
    amount: Prisma.Decimal
  ) {
    const result = await tx.cryptoWallet.updateMany({
      where: {
        customerId,
        asset: 'USDT',
        network: 'TRON',
        frozenBalance: { gte: amount },
      },
      data: {
        availableBalance: { increment: amount },
        frozenBalance: { decrement: amount },
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new ConflictException('invalid_crypto_frozen_balance');
  }

  private async consumeCryptoWalletFrozen(
    tx: Prisma.TransactionClient,
    customerId: string,
    amount: Prisma.Decimal
  ) {
    const result = await tx.cryptoWallet.updateMany({
      where: {
        customerId,
        asset: 'USDT',
        network: 'TRON',
        frozenBalance: { gte: amount },
      },
      data: { frozenBalance: { decrement: amount }, version: { increment: 1 } },
    });
    if (result.count !== 1) throw new ConflictException('invalid_crypto_frozen_balance');
  }

  private async creditCryptoWallet(
    tx: Prisma.TransactionClient,
    customerId: string,
    amount: Prisma.Decimal
  ) {
    const result = await tx.cryptoWallet.updateMany({
      where: { customerId, asset: 'USDT', network: 'TRON', status: 'ACTIVE' },
      data: { availableBalance: { increment: amount }, version: { increment: 1 } },
    });
    if (result.count !== 1) throw new ConflictException('crypto_wallet_unavailable');
  }

  private usesReservation(operation: Operation) {
    return (
      operation.type === 'PAYOUT' ||
      operation.type === 'INTERNAL_TRANSFER' ||
      operation.type === 'FX' ||
      operation.type === 'OTC' ||
      (operation.type === 'ADJUSTMENT' && operation.adjustmentDirection === 'DEBIT')
    );
  }

  private async requireRole(tx: Prisma.TransactionClient, userId: string, roles: UserRole[]) {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || !user.active || !roles.includes(user.role))
      throw new ForbiddenException('insufficient_role');
    return user;
  }

  private positiveMoney(value: string, field: string, currency: Currency) {
    const amount = new Prisma.Decimal(value);
    if (!amount.isPositive()) throw new BadRequestException(`${field}_must_be_positive`);
    const precision = currency === 'USDT' ? 6 : 2;
    if (amount.decimalPlaces() > precision)
      throw new BadRequestException(`${field}_precision_exceeded`);
    return amount;
  }
}
