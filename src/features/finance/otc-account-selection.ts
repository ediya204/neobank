import type { MoneyAccount } from './core-api';
import { isSupportedPortalAccount, supportedFiatCurrencies } from './core-api';

export type OtcDirection = 'BUY_USDT' | 'SELL_USDT';

function isFiatAccount(account: MoneyAccount) {
  return account.kind !== 'CRYPTO_WALLET' && supportedFiatCurrencies.includes(account.currency);
}

function isUsdtWallet(account: MoneyAccount) {
  return (
    account.kind === 'CRYPTO_WALLET' && account.currency === 'USDT' && account.network === 'TRON'
  );
}

export function mergeLiveCustomerWallets(
  detailAccounts: MoneyAccount[],
  customerAccounts: MoneyAccount[]
) {
  const activeLiveWallets = customerAccounts.filter(
    (account) =>
      account.status === 'ACTIVE' && isUsdtWallet(account) && isSupportedPortalAccount(account)
  );
  return [
    ...detailAccounts.filter((account) => account.kind !== 'CRYPTO_WALLET'),
    ...activeLiveWallets,
  ];
}

export function otcSourceAccounts(accounts: MoneyAccount[], direction: OtcDirection) {
  return accounts.filter((account) =>
    direction === 'BUY_USDT' ? isFiatAccount(account) : isUsdtWallet(account)
  );
}

export function otcTargetAccounts(
  accounts: MoneyAccount[],
  direction: OtcDirection,
  sourceId: string
) {
  return accounts.filter(
    (account) =>
      account.id !== sourceId &&
      (direction === 'BUY_USDT' ? isUsdtWallet(account) : isFiatAccount(account))
  );
}
