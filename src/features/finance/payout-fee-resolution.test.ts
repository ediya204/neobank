import type { FundingChannel, WithdrawalFeeRule } from './core-api';
import { resolveConfiguredPayout } from './payout-fee-resolution';

const channels: FundingChannel[] = [
  {
    id: 'platform-other',
    code: 'OTHER PAY',
    name: 'Other Pay',
    type: 'PLATFORM_PAYOUT',
    supportedCurrencies: ['USD'],
    active: true,
  },
  {
    id: 'platform-scc',
    code: 'SCC PAY',
    name: 'SCC PAY',
    type: 'PLATFORM_PAYOUT',
    supportedCurrencies: ['USD', 'HKD'],
    active: true,
  },
];

const fees: WithdrawalFeeRule[] = [
  {
    id: 'fee-scc-usd',
    scope: 'ORGANIZATION',
    assetClass: 'FIAT',
    currency: 'USD',
    method: 'PLATFORM',
    channelCode: 'SCC PAY',
    amount: '20.00',
    active: true,
    version: '1',
    updatedAt: '2026-08-26T00:00:00.000Z',
  },
];

describe('payout fee resolution', () => {
  it('selects the channel that owns the configured fee instead of the first channel', () => {
    const configured = resolveConfiguredPayout({
      channels,
      fees,
      method: 'PLATFORM',
      currency: 'USD',
    });

    expect(configured?.channel.code).toBe('SCC PAY');
    expect(configured?.fee.amount).toBe('20.00');
  });
});
