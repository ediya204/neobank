import type { CryptoWallet, MoneyAccount } from './core-api';
import { normalizeCryptoWalletStatus } from './crypto-wallet-status';

export type CustomerWalletRow = {
  id: string;
  customer_id: string;
  address?: string | null;
  status: string;
  custody_provider?: string | null;
  ownership_verified_at?: string | null;
  deposit_enabled?: boolean | number;
  available_balance?: string;
  frozen_balance?: string;
  withdrawal_fee_amount?: string;
  withdrawal_fee_rule_version?: string;
};

export function toCustomerCryptoWallet(row: CustomerWalletRow): CryptoWallet {
  return {
    id: row.id,
    customerId: row.customer_id,
    asset: 'USDT',
    network: 'TRON',
    networkLabel: 'Tron',
    tokenStandard: 'TRC20',
    walletAddress: row.deposit_enabled && row.address ? row.address : '',
    status: normalizeCryptoWalletStatus(row.status),
    availableBalance: row.available_balance || '0',
    frozenBalance: row.frozen_balance || '0',
    minimumDeposit: '0',
    withdrawalFee: row.withdrawal_fee_amount || '0',
    withdrawalFeeRuleVersion: row.withdrawal_fee_rule_version,
    confirmationsRequired: 20,
    custodyProvider: row.custody_provider === 'cregis' ? 'CREGIS' : null,
    ownershipVerifiedAt: row.ownership_verified_at || null,
    depositEnabled: Boolean(row.deposit_enabled && row.address),
  };
}

export function activeCustomerWalletAccounts(rows: CustomerWalletRow[]): MoneyAccount[] {
  return rows.flatMap((row) => {
    const wallet = toCustomerCryptoWallet(row);
    if (wallet.status !== 'ACTIVE') return [];
    return [
      {
        id: wallet.id,
        customerId: wallet.customerId,
        kind: 'CRYPTO_WALLET',
        status: 'ACTIVE',
        currency: 'USDT',
        name: 'USDT 数字钱包',
        walletAddress: wallet.walletAddress,
        network: wallet.network,
        availableBalance: wallet.availableBalance,
        frozenBalance: wallet.frozenBalance,
      },
    ];
  });
}
