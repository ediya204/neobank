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
  id: 'usdt',
  kind: 'CRYPTO_WALLET',
  currency: 'USDT',
  network: 'TRON',
  availableBalance: '100',
  frozenBalance: '0',
});
const liveUsdt = { ...staleUsdt, availableBalance: '75', frozenBalance: '25' };

describe('OTC account selection', () => {
  it('uses the live customer wallet instead of the stale Core mirror', () => {
    expect(mergeLiveCustomerWallets([usd, hkdVa, staleUsdt], [liveUsdt])).toEqual([
      usd,
      hkdVa,
      liveUsdt,
    ]);
  });

  it('limits buy-USDT flow to fiat sources and the USDT wallet target', () => {
    const accounts = [usd, hkdVa, liveUsdt];
    expect(otcSourceAccounts(accounts, 'BUY_USDT')).toEqual([usd, hkdVa]);
    expect(otcTargetAccounts(accounts, 'BUY_USDT', usd.id)).toEqual([liveUsdt]);
  });

  it('limits sell-USDT flow to the wallet source and fiat targets', () => {
    const accounts = [usd, hkdVa, liveUsdt];
    expect(otcSourceAccounts(accounts, 'SELL_USDT')).toEqual([liveUsdt]);
    expect(otcTargetAccounts(accounts, 'SELL_USDT', liveUsdt.id)).toEqual([usd, hkdVa]);
  });
});
