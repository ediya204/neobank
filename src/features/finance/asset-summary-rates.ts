import {
  AssetDistributionItem,
  AssetSource,
  AssetSummary,
  Currency,
  isSupportedPortalAccount,
  MoneyAccount,
} from './core-api';

type StoredRate = {
  rate: number;
  asOf: string;
};

type StoredRates = Partial<Record<Currency, StoredRate>>;

export type ResolvedAssetSummary = {
  summary: AssetSummary;
  lastKnownCurrencies: Currency[];
};

const STORAGE_KEY = 'ssc-digital-bank.asset-usd-rates.v1';

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function readStoredRates(): StoredRates {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as StoredRates;
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, item]) =>
          item &&
          Number.isFinite(Number(item.rate)) &&
          Number(item.rate) > 0 &&
          validDate(item.asOf)
      )
    ) as StoredRates;
  } catch {
    return {};
  }
}

function writeStoredRates(rates: StoredRates) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rates));
  } catch {
    // A disabled or full browser store must not block the live valuation path.
  }
}

function rememberLiveRates(summary: AssetSummary) {
  const rates = readStoredRates();
  const asOf = validDate(summary.ratesAsOf) ? summary.ratesAsOf : summary.asOf;
  summary.distribution.forEach((item) => {
    if (item.currency === 'USD' || item.reportingRate === null) return;
    const rate = Number(item.reportingRate);
    if (Number.isFinite(rate) && rate > 0 && validDate(asOf)) {
      rates[item.currency] = { rate, asOf };
    }
  });
  writeStoredRates(rates);
}

function revalue(
  source: Omit<AssetSummary, 'distribution'> & { distribution: AssetDistributionItem[] },
  rates: StoredRates,
  lastKnownCurrencies: Currency[]
): AssetSummary {
  let totalAvailable = 0;
  let totalFrozen = 0;
  const missingRates: Currency[] = [];
  const valued = source.distribution.map((item) => {
    const stored = item.currency === 'USD' ? { rate: 1, asOf: source.asOf } : rates[item.currency];
    const available = Number(item.availableBalance);
    const frozen = Number(item.frozenBalance);
    if (
      !stored ||
      !Number.isFinite(available) ||
      !Number.isFinite(frozen) ||
      available < 0 ||
      frozen < 0
    ) {
      missingRates.push(item.currency);
      return { ...item, reportingRate: null, reportingValue: null, shareBps: 0 };
    }
    const availableValue = available * stored.rate;
    const frozenValue = frozen * stored.rate;
    totalAvailable += availableValue;
    totalFrozen += frozenValue;
    return {
      ...item,
      reportingRate: String(stored.rate),
      reportingValue: (availableValue + frozenValue).toFixed(8),
      shareBps: 0,
    };
  });
  const totalBalance = totalAvailable + totalFrozen;
  const rateDates = lastKnownCurrencies.flatMap((currency) => {
    const asOf = rates[currency]?.asOf;
    return asOf ? [Date.parse(asOf)] : [];
  });
  return {
    ...source,
    valuationStatus: missingRates.length ? 'partial' : 'complete',
    missingRates,
    ratesAsOf: rateDates.length ? new Date(Math.min(...rateDates)).toISOString() : source.ratesAsOf,
    totalAvailable: totalAvailable.toFixed(8),
    totalFrozen: totalFrozen.toFixed(8),
    totalBalance: totalBalance.toFixed(8),
    distribution: valued.map((item) => ({
      ...item,
      shareBps:
        item.reportingValue !== null && totalBalance > 0
          ? Math.round((Number(item.reportingValue) / totalBalance) * 10000)
          : 0,
    })),
  };
}

export function resolveAssetSummaryRates(summary: AssetSummary): ResolvedAssetSummary {
  const storedRates = readStoredRates();
  const lastKnownCurrencies = summary.distribution.flatMap((item) => {
    if (item.reportingRate !== null || item.currency === 'USD' || !storedRates[item.currency]) {
      return [];
    }
    return [item.currency];
  });
  rememberLiveRates(summary);
  if (!lastKnownCurrencies.length) return { summary, lastKnownCurrencies };
  const liveRates = readStoredRates();
  summary.distribution.forEach((item) => {
    if (item.reportingRate === null || item.currency === 'USD') return;
    const rate = Number(item.reportingRate);
    if (Number.isFinite(rate) && rate > 0) {
      liveRates[item.currency] = {
        rate,
        asOf: summary.ratesAsOf || summary.asOf,
      };
    }
  });
  return {
    summary: revalue(summary, liveRates, lastKnownCurrencies),
    lastKnownCurrencies,
  };
}

function accountSource(account: MoneyAccount): AssetSource {
  if (account.kind === 'VIRTUAL_ACCOUNT') return 'virtual_account';
  if (account.kind === 'CRYPTO_WALLET') return 'digital_wallet';
  return 'balance_account';
}

export function buildAssetSummaryFromLastKnownRates(
  customerId: string,
  accounts: MoneyAccount[]
): ResolvedAssetSummary | null {
  const supported = accounts.filter(
    (account) => account.status === 'ACTIVE' && isSupportedPortalAccount(account)
  );
  if (!supported.length) return null;

  const grouped = new Map<
    Currency,
    { available: number; frozen: number; accountCount: number; sources: Set<AssetSource> }
  >();
  supported.forEach((account) => {
    const available = Number(account.availableBalance);
    const frozen = Number(account.frozenBalance);
    if (Number.isFinite(available) && Number.isFinite(frozen) && available >= 0 && frozen >= 0) {
      const bucket = grouped.get(account.currency) || {
        available: 0,
        frozen: 0,
        accountCount: 0,
        sources: new Set<AssetSource>(),
      };
      bucket.available += available;
      bucket.frozen += frozen;
      bucket.accountCount += 1;
      bucket.sources.add(accountSource(account));
      grouped.set(account.currency, bucket);
    }
  });
  if (!grouped.size) return null;

  const storedRates = readStoredRates();
  const lastKnownCurrencies = Array.from(grouped.keys()).filter(
    (currency) => currency !== 'USD' && Boolean(storedRates[currency])
  );
  const now = new Date().toISOString();
  const distribution: AssetDistributionItem[] = Array.from(grouped.entries()).map(
    ([currency, bucket]) => ({
      currency,
      availableBalance: bucket.available.toFixed(8),
      frozenBalance: bucket.frozen.toFixed(8),
      totalBalance: (bucket.available + bucket.frozen).toFixed(8),
      reportingRate: null,
      reportingValue: null,
      shareBps: 0,
      accountCount: bucket.accountCount,
      sources: Array.from(bucket.sources),
    })
  );
  const summary: AssetSummary = {
    customerId,
    reportingCurrency: 'USD',
    valuationStatus: 'partial',
    missingRates: [],
    asOf: now,
    ratesAsOf: null,
    balanceBasis: 'materialized_account_balances',
    totalAvailable: '0',
    totalFrozen: '0',
    totalBalance: '0',
    accountCount: distribution.reduce((total, item) => total + item.accountCount, 0),
    distribution,
  };
  return {
    summary: revalue(summary, storedRates, lastKnownCurrencies),
    lastKnownCurrencies,
  };
}

export function clearLastKnownAssetRates() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Test and privacy-mode helper; no action is needed when storage is disabled.
  }
}
