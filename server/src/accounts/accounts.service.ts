import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountKind, Currency, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requireActiveUser, requireCustomerAccess } from '../common/tenant-access';
import {
  supportedCustomerAccountWhere,
  supportedCryptoAsset,
  supportedCryptoNetwork,
  supportedFiatCurrencies,
} from '../supported-assets';

const assetAccountKinds: AccountKind[] = ['SYSTEM_WALLET', 'VIRTUAL_ACCOUNT'];

type AssetBucket = {
  currency: Currency;
  available: Prisma.Decimal;
  frozen: Prisma.Decimal;
  accountCount: number;
  sources: Set<'balance_account' | 'virtual_account' | 'digital_wallet'>;
};

@Injectable()
export class AccountsService {
  constructor(private readonly db: PrismaService) {}

  async list(customerId: string, userId: string, kind?: AccountKind) {
    await requireCustomerAccess(this.db, userId, customerId);
    return this.db.account.findMany({
      where: {
        customerId,
        AND: [supportedCustomerAccountWhere, ...(kind ? [{ kind }] : [])],
      },
      orderBy: [{ kind: 'asc' }, { currency: 'asc' }],
    });
  }

  async summary(customerId: string, userId: string) {
    if (!customerId) throw new BadRequestException('customer_id_required');
    const [user, customer] = await Promise.all([
      this.db.user.findUnique({
        where: { id: userId },
        select: { active: true, organizationId: true },
      }),
      this.db.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          organizationId: true,
          accounts: {
            where: {
              status: 'ACTIVE',
              kind: { in: assetAccountKinds },
              currency: { in: supportedFiatCurrencies },
            },
            select: {
              kind: true,
              currency: true,
              availableBalance: true,
              frozenBalance: true,
            },
          },
          cryptoWallets: {
            where: {
              status: 'ACTIVE',
              asset: supportedCryptoAsset,
              network: supportedCryptoNetwork,
            },
            select: {
              asset: true,
              availableBalance: true,
              frozenBalance: true,
            },
          },
        },
      }),
    ]);

    if (!customer) throw new NotFoundException('customer_not_found');
    if (!user?.active || !user.organizationId || user.organizationId !== customer.organizationId) {
      throw new ForbiddenException('cross_tenant_customer');
    }

    const buckets = new Map<Currency, AssetBucket>();
    const bucketFor = (currency: Currency) => {
      const existing = buckets.get(currency);
      if (existing) return existing;
      const created: AssetBucket = {
        currency,
        available: new Prisma.Decimal(0),
        frozen: new Prisma.Decimal(0),
        accountCount: 0,
        sources: new Set(),
      };
      buckets.set(currency, created);
      return created;
    };

    for (const account of customer.accounts) {
      const bucket = bucketFor(account.currency);
      bucket.available = bucket.available.add(account.availableBalance);
      bucket.frozen = bucket.frozen.add(account.frozenBalance);
      bucket.accountCount += 1;
      bucket.sources.add(
        account.kind === 'VIRTUAL_ACCOUNT' ? 'virtual_account' : 'balance_account'
      );
    }

    for (const wallet of customer.cryptoWallets) {
      const bucket = bucketFor(wallet.asset);
      bucket.available = bucket.available.add(wallet.availableBalance);
      bucket.frozen = bucket.frozen.add(wallet.frozenBalance);
      bucket.accountCount += 1;
      bucket.sources.add('digital_wallet');
    }

    const currencies = [...buckets.keys()].filter(
      (currency): currency is Exclude<Currency, 'USD' | 'USDT'> =>
        currency !== 'USD' && currency !== 'USDT'
    );
    const rates = await this.db.rateVersion.findMany({
      where: {
        type: 'FX',
        quoteCurrency: 'USD',
        baseCurrency: { in: currencies },
        active: true,
        effectiveFrom: { lte: new Date() },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    const ratesByCurrency = new Map<Currency, { rate: Prisma.Decimal; effectiveFrom: Date }>();
    for (const rate of rates) {
      if (!ratesByCurrency.has(rate.baseCurrency)) {
        ratesByCurrency.set(rate.baseCurrency, {
          rate: rate.buyRate.add(rate.sellRate).div(2),
          effectiveFrom: rate.effectiveFrom,
        });
      }
    }
    ratesByCurrency.set('USD', { rate: new Prisma.Decimal(1), effectiveFrom: new Date() });
    ratesByCurrency.set('USDT', { rate: new Prisma.Decimal(1), effectiveFrom: new Date() });

    let totalAvailable = new Prisma.Decimal(0);
    let totalFrozen = new Prisma.Decimal(0);
    const missingRates: Currency[] = [];
    const distribution = [...buckets.values()]
      .map((bucket) => {
        const rate = ratesByCurrency.get(bucket.currency);
        if (!rate) {
          missingRates.push(bucket.currency);
          return {
            ...bucket,
            rate: null,
            reportingValue: null,
          };
        }
        const availableValue = bucket.available.mul(rate.rate);
        const frozenValue = bucket.frozen.mul(rate.rate);
        totalAvailable = totalAvailable.add(availableValue);
        totalFrozen = totalFrozen.add(frozenValue);
        return {
          ...bucket,
          rate: rate.rate,
          reportingValue: availableValue.add(frozenValue),
        };
      })
      .sort((left, right) => {
        if (!left.reportingValue && !right.reportingValue) {
          return left.currency.localeCompare(right.currency);
        }
        if (!left.reportingValue) return 1;
        if (!right.reportingValue) return -1;
        return right.reportingValue.comparedTo(left.reportingValue);
      });
    const totalBalance = totalAvailable.add(totalFrozen);
    const rateDates = [...ratesByCurrency.values()].map((item) => item.effectiveFrom.getTime());

    return {
      customerId: customer.id,
      reportingCurrency: 'USD' as const,
      valuationStatus: missingRates.length ? ('partial' as const) : ('complete' as const),
      missingRates,
      asOf: new Date().toISOString(),
      ratesAsOf: rateDates.length ? new Date(Math.min(...rateDates)).toISOString() : null,
      balanceBasis: 'materialized_account_balances' as const,
      totalAvailable: totalAvailable.toFixed(8),
      totalFrozen: totalFrozen.toFixed(8),
      totalBalance: totalBalance.toFixed(8),
      accountCount: distribution.reduce((total, item) => total + item.accountCount, 0),
      distribution: distribution.map((item) => ({
        currency: item.currency,
        availableBalance: item.available.toFixed(8),
        frozenBalance: item.frozen.toFixed(8),
        totalBalance: item.available.add(item.frozen).toFixed(8),
        reportingRate: item.rate?.toFixed(12) || null,
        reportingValue: item.reportingValue?.toFixed(8) || null,
        shareBps:
          item.reportingValue && !totalBalance.isZero()
            ? Math.round(item.reportingValue.div(totalBalance).mul(10000).toNumber())
            : 0,
        accountCount: item.accountCount,
        sources: [...item.sources],
      })),
    };
  }

  async get(id: string, userId: string) {
    const user = await requireActiveUser(this.db, userId);
    const account = await this.db.account.findUnique({
      where: { id },
      include: {
        customer: { select: { organizationId: true } },
        journalLines: {
          include: { journalEntry: true },
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
      },
    });
    if (
      !account?.customer ||
      account.customer.organizationId !== user.organizationId ||
      !this.isSupportedCustomerAccount(account)
    ) {
      throw new NotFoundException('account_not_found');
    }
    return account;
  }

  private isSupportedCustomerAccount(account: {
    kind: AccountKind;
    currency: Currency;
    network: string | null;
  }) {
    if (
      assetAccountKinds.includes(account.kind) &&
      supportedFiatCurrencies.includes(
        account.currency as (typeof supportedFiatCurrencies)[number]
      )
    ) {
      return true;
    }
    return (
      account.kind === 'CRYPTO_WALLET' &&
      account.currency === supportedCryptoAsset &&
      account.network === supportedCryptoNetwork
    );
  }
}
