import { CryptoWallet, CryptoWalletStatus } from './core-api';

const walletStatuses = new Set<CryptoWalletStatus>([
  'PENDING',
  'CREATING',
  'ACTIVE',
  'ERROR',
  'FROZEN',
  'CLOSED',
  'DISABLED',
]);

export type CryptoWalletStatusPresentation = {
  label: string;
  color: 'default' | 'info' | 'success' | 'warning' | 'error';
};

const walletStatusPresentation: Record<CryptoWalletStatus, CryptoWalletStatusPresentation> = {
  PENDING: { label: '待开通', color: 'warning' },
  CREATING: { label: '创建中', color: 'info' },
  ACTIVE: { label: '正常', color: 'success' },
  ERROR: { label: '异常', color: 'error' },
  FROZEN: { label: '已冻结', color: 'warning' },
  CLOSED: { label: '已关闭', color: 'default' },
  DISABLED: { label: '已停用', color: 'default' },
};

export function normalizeCryptoWalletStatus(value: string): CryptoWalletStatus {
  const normalized = value.trim().toUpperCase() as CryptoWalletStatus;
  return walletStatuses.has(normalized) ? normalized : 'ERROR';
}

export function cryptoWalletStatusDetails(
  status: CryptoWalletStatus
): CryptoWalletStatusPresentation {
  return walletStatusPresentation[status];
}

export function isWithdrawalReady<T extends Pick<CryptoWallet, 'status'>>(
  wallet: T | null | undefined
): wallet is T {
  return wallet?.status === 'ACTIVE';
}
