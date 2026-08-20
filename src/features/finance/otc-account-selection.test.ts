import type { MoneyAccount } from './core-api';
import {
  mergeLiveCustomerWallets,
  otcSourceAccounts,
  otcTargetAccounts,
} from './otc-account-selection';

const account = (input: Partial<MoneyAccount>): MoneyAccount => ({
  id: 'account',
  customerId: 'customer',
  kind: 'SYSTEM_WALLET',
  status: 'ACTIVE',
  currency: 'USD',
  name: 'Account',
  availableBalance: '0',
  frozenBalance: '0',
  ...input,
});

const usd = account({ id: 'usd' });
const hkdVa = account({ id: 'hkd-va', kind: 'VIRTUAL_ACCOUNT', currency: 'HKD' });
const staleUsdt = account({
  id: 'core-usdt-account',
  kind: 'CRYPTO_WALLET',
  currency: 'USDT',
  network: 'TRON',
  availableBalance: '100',
  frozenBalance: '0',
});
const liveUsdt = {
  ...staleUsdt,
  id: 'custody-wallet',
  walletAddress: 'TLiveWalletAddress',
  availableBalance: '75',
  frozenBalance: '25',
};

describe('OTC account selection', () => {
  it('uses live wallet balances while preserving the Core account identity', () => {
    expect(mergeLiveCustomerWallets([usd, hkdVa, staleUsdt], [liveUsdt])).toEqual([
      usd,
      hkdVa,
      {
        ...staleUsdt,
        walletAddress: liveUsdt.walletAddress,
        availableBalance: '75',
        frozenBalance: '25',
      },
    ]);
  });

  it('does not offer a custody wallet that has no Core ledger account', () => {
    expect(mergeLiveCustomerWallets([usd, hkdVa], [liveUsdt])).toEqual([usd, hkdVa]);
  });

  it('limits buy-USDT flow to fiat sources and the USDT wallet target', () => {
    const accounts = mergeLiveCustomerWallets([usd, hkdVa, staleUsdt], [liveUsdt]);
    expect(otcSourceAccounts(accounts, 'BUY_USDT')).toEqual([usd, hkdVa]);
    expect(otcTargetAccounts(accounts, 'BUY_USDT', usd.id)).toEqual([
      expect.objectContaining({ id: staleUsdt.id, availableBalance: '75' }),
    ]);
  });

  it('limits sell-USDT flow to the wallet source and fiat targets', () => {
    const accounts = mergeLiveCustomerWallets([usd, hkdVa, staleUsdt], [liveUsdt]);
    expect(otcSourceAccounts(accounts, 'SELL_USDT')).toEqual([
      expect.objectContaining({ id: staleUsdt.id, availableBalance: '75' }),
    ]);
    expect(otcTargetAccounts(accounts, 'SELL_USDT', staleUsdt.id)).toEqual([usd, hkdVa]);
  });
});
