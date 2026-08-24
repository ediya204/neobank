import { CryptoWallet, MoneyAccount } from './core-api';

export type DigitalWalletPresentation = {
  label: string;
  color: 'default' | 'error' | 'success' | 'warning';
  description: string;
};

export function digitalWalletPresentation(
  account: MoneyAccount,
  wallet?: CryptoWallet,
  state: { loading?: boolean; error?: boolean } = {}
): DigitalWalletPresentation {
  const network = account.network || wallet?.network || 'TRON';

  if (account.status !== 'ACTIVE') {
    return {
      label: account.status,
      color: 'warning',
      description: `${network} · 操作已禁用`,
    };
  }
  if (state.loading) {
    return {
      label: '状态读取中',
      color: 'default',
      description: `${network} · 正在读取 Cregis 状态`,
    };
  }
  if (state.error) {
    return {
      label: '状态异常',
      color: 'error',
      description: `${network} · Cregis 状态读取失败`,
    };
  }
  if (
    wallet?.status === 'ACTIVE' &&
    wallet.custodyProvider === 'CREGIS' &&
    wallet.ownershipVerifiedAt &&
    wallet.depositEnabled &&
    wallet.walletAddress
  ) {
    return {
      label: 'ACTIVE',
      color: 'success',
      description: `${network} · Cregis 已验证`,
    };
  }
  return {
    label: '等待 Cregis',
    color: 'default',
    description: `${network} · 地址归属待验证`,
  };
}
