import type { MoneyAccount, RateVersion } from './core-api';
import {
  formatConversionAmount,
  LIVE_QUOTE_MAX_AGE_MS,
  resolveConversionQuote,
} from './conversion-quote';

const now = Date.parse('2026-08-20T08:00:00.000Z');

const account = (id: string, currency: MoneyAccount['currency']): MoneyAccount => ({
  id,
  customerId: 'customer',
  kind: currency === 'USDT' ? 'CRYPTO_WALLET' : 'SYSTEM_WALLET',
  status: 'ACTIVE',
  currency,
  name: `${currency} account`,
  availableBalance: '1000',
  frozenBalance: '0',
});

const rate = (input: Partial<RateVersion> = {}): RateVersion => ({
  id: 'rate',
  type: 'OTC',
  baseCurrency: 'USD',
  quoteCurrency: 'USDT',
  buyRate: '1',
  sellRate: '1',
  feeBps: 50,
  effectiveFrom: '2026-08-20T00:00:00.000Z',
  active: true,
  marketProvider: 'fastforex',
  marketPriceType: 'midpoint_spot',
  marketRate: '1.01',
  customerRate: '1.00495',
  marketUpdatedAt: '2026-08-20T07:59:30.000Z',
  marketFetchedAt: '2026-08-20T07:59:45.000Z',
  ...input,
});

describe('conversion quote preview', () => {
  it('calculates the target asset from the direct customer rate', () => {
    expect(
      resolveConversionQuote({
        type: 'OTC',
        source: account('usd', 'USD'),
        target: account('usdt', 'USDT'),
        amount: '100',
        rates: [rate()],
        now,
      })
    ).toMatchObject({ status: 'ready', received: 100.495 });
  });

  it('does not guess an inverse rate when the direct pair is unavailable', () => {
    expect(
      resolveConversionQuote({
        type: 'OTC',
        source: account('usd', 'USD'),
        target: account('usdt', 'USDT'),
        amount: '100',
        rates: [rate({ baseCurrency: 'USDT', quoteCurrency: 'USD' })],
        now,
      }).status
    ).toBe('unavailable');
  });

  it('rejects missing, unavailable, and expired live market data', () => {
    const scenarios: RateVersion[] = [
      rate({ marketFetchedAt: undefined }),
      rate({ marketUnavailable: true }),
      rate({ marketFetchedAt: new Date(now - LIVE_QUOTE_MAX_AGE_MS - 1).toISOString() }),
    ];

    expect(
      scenarios.map(
        (row) =>
          resolveConversionQuote({
            type: 'OTC',
            source: account('usd', 'USD'),
            target: account('usdt', 'USDT'),
            amount: '100',
            rates: [row],
            now,
          }).status
      )
    ).toEqual(['stale', 'unavailable', 'stale']);
  });

  it('formats fiat and USDT amounts using target-asset precision', () => {
    expect(formatConversionAmount(100.4951234, 'USDT')).toBe('100.495123');
    expect(formatConversionAmount(100.495, 'USD')).toBe('100.50');
  });
});
