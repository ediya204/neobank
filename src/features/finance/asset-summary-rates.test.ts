import {
  buildAssetSummaryFromLastKnownRates,
  clearLastKnownAssetRates,
  resolveAssetSummaryRates,
} from './asset-summary-rates';
import { AssetSummary, MoneyAccount } from './core-api';

const liveSummary: AssetSummary = {
  customerId: 'customer-1',
  reportingCurrency: 'USD',
  valuationStatus: 'complete',
  missingRates: [],
  asOf: '2026-08-20T01:02:04Z',
  ratesAsOf: '2026-08-20T01:02:03Z',
  balanceBasis: 'materialized_account_balances',
  totalAvailable: '12.8',
  totalFrozen: '0',
  totalBalance: '12.8',
  accountCount: 1,
  distribution: [
    {
      currency: 'HKD',
      availableBalance: '100',
      frozenBalance: '0',
      totalBalance: '100',
      reportingRate: '0.128',
      reportingValue: '12.8',
      shareBps: 10000,
      accountCount: 1,
      sources: ['balance_account'],
    },
  ],
};

beforeEach(() => clearLastKnownAssetRates());

it('fills a missing live rate with the last successfully acquired rate', () => {
  resolveAssetSummaryRates(liveSummary);
  const partial: AssetSummary = {
    ...liveSummary,
    valuationStatus: 'partial',
    missingRates: ['HKD'],
    totalAvailable: '0',
    totalBalance: '0',
    distribution: [
      {
        ...liveSummary.distribution[0],
        availableBalance: '200',
        totalBalance: '200',
        reportingRate: null,
        reportingValue: null,
        shareBps: 0,
      },
    ],
  };

  const resolved = resolveAssetSummaryRates(partial);

  expect(resolved.lastKnownCurrencies).toEqual(['HKD']);
  expect(resolved.summary.valuationStatus).toBe('complete');
  expect(resolved.summary.totalBalance).toBe('25.60000000');
  expect(resolved.summary.distribution[0].reportingRate).toBe('0.128');
  expect(resolved.summary.ratesAsOf).toBe('2026-08-20T01:02:03.000Z');
});

it('revalues current account balances after the summary request fails', () => {
  resolveAssetSummaryRates(liveSummary);
  const accounts: MoneyAccount[] = [
    {
      id: 'usd-wallet',
      customerId: 'customer-1',
      kind: 'SYSTEM_WALLET',
      status: 'ACTIVE',
      currency: 'USD',
      name: 'USD wallet',
      availableBalance: '10',
      frozenBalance: '2',
    },
    {
      id: 'hkd-wallet',
      customerId: 'customer-1',
      kind: 'SYSTEM_WALLET',
      status: 'ACTIVE',
      currency: 'HKD',
      name: 'HKD wallet',
      availableBalance: '200',
      frozenBalance: '0',
    },
  ];

  const resolved = buildAssetSummaryFromLastKnownRates('customer-1', accounts);

  expect(resolved?.lastKnownCurrencies).toEqual(['HKD']);
  expect(resolved?.summary.totalAvailable).toBe('35.60000000');
  expect(resolved?.summary.totalFrozen).toBe('2.00000000');
  expect(resolved?.summary.totalBalance).toBe('37.60000000');
  expect(resolved?.summary.valuationStatus).toBe('complete');
});

it('keeps currencies without a previous rate out of the valuation', () => {
  const accounts: MoneyAccount[] = [
    {
      id: 'usd-wallet',
      customerId: 'customer-1',
      kind: 'SYSTEM_WALLET',
      status: 'ACTIVE',
      currency: 'USD',
      name: 'USD wallet',
      availableBalance: '10',
      frozenBalance: '0',
    },
    {
      id: 'hkd-wallet',
      customerId: 'customer-1',
      kind: 'SYSTEM_WALLET',
      status: 'ACTIVE',
      currency: 'HKD',
      name: 'HKD wallet',
      availableBalance: '200',
      frozenBalance: '0',
    },
  ];

  const resolved = buildAssetSummaryFromLastKnownRates('customer-1', accounts);

  expect(resolved?.lastKnownCurrencies).toEqual([]);
  expect(resolved?.summary.totalBalance).toBe('10.00000000');
  expect(resolved?.summary.valuationStatus).toBe('partial');
  expect(resolved?.summary.missingRates).toEqual(['HKD']);
});
