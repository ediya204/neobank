import type {
  Customer,
  JournalEntry,
  MoneyAccount,
  Operation,
  OperationType,
  VirtualAccountRequest,
} from './core-api';

export const OVERVIEW_ASSETS = ['USD', 'HKD', 'USDT'] as const;
export type OverviewAsset = (typeof OVERVIEW_ASSETS)[number];

export const OVERVIEW_ACCOUNT_KINDS = [
  'SYSTEM_WALLET',
  'VIRTUAL_ACCOUNT',
  'CRYPTO_WALLET',
] as const;
export type OverviewAccountKind = (typeof OVERVIEW_ACCOUNT_KINDS)[number];

export type FundSnapshot = {
  asset: OverviewAsset;
  available: number;
  frozen: number;
  total: number;
  accountCount: number;
  products: Array<{
    kind: OverviewAccountKind;
    available: number;
    frozen: number;
    total: number;
    accountCount: number;
  }>;
};

export type FundTrendPoint = {
  date: string;
  inflow: number;
  outflow: number;
  net: number;
};

type OverviewInput = {
  customers: Customer[];
  operations: Operation[];
  vaRequests: VirtualAccountRequest[];
  journals: JournalEntry[];
  now?: Date;
};

const HONG_KONG_TIME_ZONE = 'Asia/Hong_Kong';

function amount(value: string | number | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildIntegerCountAxis(maxCount: number, maxTickAmount = 5) {
  const normalizedMax = Math.max(1, Math.ceil(Number.isFinite(maxCount) ? maxCount : 0));
  const normalizedTickLimit = Math.max(1, Math.floor(maxTickAmount));
  const step = Math.max(1, Math.ceil(normalizedMax / normalizedTickLimit));
  const max = Math.ceil(normalizedMax / step) * step;

  return { max, tickAmount: max / step };
}

function dayKey(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: HONG_KONG_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function operationTime(operation: Operation) {
  return new Date(operation.executedAt || operation.submittedAt || operation.createdAt).getTime();
}

function isOverviewAccount(account: MoneyAccount): account is MoneyAccount & {
  kind: OverviewAccountKind;
  currency: OverviewAsset;
} {
  return (
    OVERVIEW_ACCOUNT_KINDS.includes(account.kind as OverviewAccountKind) &&
    OVERVIEW_ASSETS.includes(account.currency as OverviewAsset) &&
    (account.currency !== 'USDT' || account.network === 'TRON')
  );
}

export function buildOverviewAnalytics({
  customers,
  operations,
  vaRequests,
  journals,
  now = new Date(),
}: OverviewInput) {
  const fundMap = new Map<OverviewAsset, FundSnapshot>();
  OVERVIEW_ASSETS.forEach((asset) => {
    fundMap.set(asset, {
      asset,
      available: 0,
      frozen: 0,
      total: 0,
      accountCount: 0,
      products: [],
    });
  });

  customers
    .flatMap((customer) => customer.accounts || [])
    .filter(isOverviewAccount)
    .forEach((account) => {
      const fund = fundMap.get(account.currency)!;
      const available = amount(account.availableBalance);
      const frozen = amount(account.frozenBalance);
      let product = fund.products.find((item) => item.kind === account.kind);
      if (!product) {
        product = { kind: account.kind, available: 0, frozen: 0, total: 0, accountCount: 0 };
        fund.products.push(product);
      }
      product.available += available;
      product.frozen += frozen;
      product.total += available + frozen;
      product.accountCount += 1;
      fund.available += available;
      fund.frozen += frozen;
      fund.total += available + frozen;
      fund.accountCount += 1;
    });

  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getTime() - (6 - index) * 24 * 60 * 60 * 1000);
    return dayKey(date);
  });
  const trendByAsset = Object.fromEntries(
    OVERVIEW_ASSETS.map((asset) => [
      asset,
      dates.map((date) => ({ date, inflow: 0, outflow: 0, net: 0 })),
    ])
  ) as Record<OverviewAsset, FundTrendPoint[]>;
  const trendLookup = new Map(
    OVERVIEW_ASSETS.flatMap((asset) =>
      trendByAsset[asset].map((point) => [`${asset}:${point.date}`, point] as const)
    )
  );
  const completedToday = new Set<string>();

  journals
    .filter((journal) => journal.operation.type !== 'INTERNAL_TRANSFER')
    .forEach((journal) => {
      const journalDate = dayKey(new Date(journal.postedAt));
      const customerLines = journal.lines.filter(
        (line) => Boolean(line.account.customerId) && isOverviewAccount(line.account)
      );
      customerLines.forEach((line) => {
        const asset = line.account.currency as OverviewAsset;
        const point = trendLookup.get(`${asset}:${journalDate}`);
        if (!point) return;
        const value = amount(line.amount);
        if (line.side === 'CREDIT') point.inflow += value;
        else point.outflow += value;
        point.net = point.inflow - point.outflow;
      });
      if (customerLines.length && journalDate === dayKey(now)) {
        completedToday.add(journal.operation.id);
      }
    });

  const recentWindowStart = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const operationMix = new Map<OperationType, number>();
  operations
    .filter((operation) => operationTime(operation) >= recentWindowStart)
    .forEach((operation) => {
      operationMix.set(operation.type, (operationMix.get(operation.type) || 0) + 1);
    });

  const activeCustomers = customers.filter((customer) => customer.status === 'ACTIVE').length;
  const pendingKyc = customers.filter(
    (customer) => customer.kycStatus === 'PENDING' && customer.status !== 'ACTIVE'
  ).length;
  const pendingVa = vaRequests.filter((request) => request.status === 'SUBMITTED').length;
  const pendingApprovals = operations.filter(
    (operation) => operation.status === 'SUBMITTED'
  ).length;
  const inExecution = operations.filter((operation) =>
    ['APPROVED', 'PROCESSING'].includes(operation.status)
  ).length;
  const failed = operations.filter((operation) => operation.status === 'FAILED').length;

  return {
    snapshotAt: now.toISOString(),
    customers: {
      total: customers.length,
      active: activeCustomers,
      onboarding: customers.length - activeCustomers,
    },
    queue: {
      kyc: pendingKyc,
      va: pendingVa,
      approvals: pendingApprovals,
      execution: inExecution,
      failed,
      total: pendingKyc + pendingVa + pendingApprovals + inExecution + failed,
    },
    completedToday: completedToday.size,
    funds: OVERVIEW_ASSETS.map((asset) => {
      const fund = fundMap.get(asset)!;
      return { ...fund, products: fund.products.sort((left, right) => right.total - left.total) };
    }),
    trendByAsset,
    operationMix: Array.from(operationMix.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => right.count - left.count),
    recentOperations: [...operations]
      .sort((left, right) => operationTime(right) - operationTime(left))
      .slice(0, 6),
  };
}
