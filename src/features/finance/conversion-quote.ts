import type { MoneyAccount, RateVersion } from './core-api';

export const LIVE_QUOTE_MAX_AGE_MS = 2 * 60 * 1000;

export type ConversionQuoteStatus = 'incomplete' | 'loading' | 'unavailable' | 'stale' | 'ready';

export type ConversionQuote = {
  status: ConversionQuoteStatus;
  rate?: RateVersion;
  received?: number;
};

export function resolveConversionQuote({
  type,
  source,
  target,
  amount,
  rates,
  loading = false,
  now = Date.now(),
}: {
  type: RateVersion['type'];
  source?: MoneyAccount;
  target?: MoneyAccount;
  amount: string;
  rates: RateVersion[];
  loading?: boolean;
  now?: number;
}): ConversionQuote {
  const sourceAmount = Number(amount);
  if (!source || !target || !amount || !Number.isFinite(sourceAmount) || sourceAmount <= 0) {
    return { status: 'incomplete' };
  }

  const rate = rates.find(
    (row) =>
      row.active &&
      row.type === type &&
      row.baseCurrency === source.currency &&
      row.quoteCurrency === target.currency &&
      isRateVersionEffective(row, now)
  );
  if (!rate) return { status: loading ? 'loading' : 'unavailable' };

  const marketRate = Number(rate.marketRate);
  const customerRate = Number(rate.customerRate);
  if (
    rate.marketUnavailable ||
    !Number.isFinite(marketRate) ||
    marketRate <= 0 ||
    !Number.isFinite(customerRate) ||
    customerRate <= 0
  ) {
    return { status: loading ? 'loading' : 'unavailable', rate };
  }

  const fetchedAt = rate.marketFetchedAt ? Date.parse(rate.marketFetchedAt) : Number.NaN;
  if (
    !Number.isFinite(fetchedAt) ||
    fetchedAt < now - LIVE_QUOTE_MAX_AGE_MS ||
    fetchedAt > now + 30 * 1000
  ) {
    return { status: 'stale', rate };
  }

  const received = sourceAmount * customerRate;
  if (!Number.isFinite(received) || received <= 0) return { status: 'unavailable', rate };
  return { status: 'ready', rate, received };
}

export function formatConversionAmount(value: number, currency: MoneyAccount['currency']) {
  const isCrypto = currency === 'USDT';
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: isCrypto ? 2 : 2,
    maximumFractionDigits: isCrypto ? 6 : 2,
  }).format(value);
}

function isRateVersionEffective(rate: RateVersion, now: number) {
  const effectiveFrom = Date.parse(rate.effectiveFrom);
  if (!Number.isFinite(effectiveFrom) || effectiveFrom > now) return false;
  if (!rate.effectiveUntil) return true;
  const effectiveUntil = Date.parse(rate.effectiveUntil);
  return Number.isFinite(effectiveUntil) && effectiveUntil > now;
}
