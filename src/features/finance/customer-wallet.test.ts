import { activeCustomerWalletAccounts, toCustomerCryptoWallet } from './customer-wallet';

const liveWallet = {
  id: 'wallet_usdt_tron',
  customer_id: 'customer_1',
  address: 'TRON_ADDRESS',
  status: 'active',
  custody_provider: 'cregis',
  ownership_verified_at: '2026-08-20T01:00:00.000Z',
  deposit_enabled: true,
  available_balance: '75.000000',
  frozen_balance: '25.000000',
  withdrawal_fee_amount: '5.000000',
  withdrawal_fee_rule_version: '3',
};

describe('customer wallet presentation', () => {
  it('preserves a submitted USDT withdrawal as frozen balance', () => {
    expect(toCustomerCryptoWallet(liveWallet)).toMatchObject({
      availableBalance: '75.000000',
      frozenBalance: '25.000000',
      status: 'ACTIVE',
    });
    expect(activeCustomerWalletAccounts([liveWallet])).toEqual([
      expect.objectContaining({
        kind: 'CRYPTO_WALLET',
        currency: 'USDT',
        network: 'TRON',
        availableBalance: '75.000000',
        frozenBalance: '25.000000',
      }),
    ]);
  });

  it('does not present an inactive custody wallet as customer assets', () => {
    expect(activeCustomerWalletAccounts([{ ...liveWallet, status: 'creating' }])).toEqual([]);
  });
});
