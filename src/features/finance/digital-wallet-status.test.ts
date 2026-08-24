import { CryptoWallet, MoneyAccount } from './core-api';
import { digitalWalletPresentation } from './digital-wallet-status';

const account: MoneyAccount = {
  id: 'account_usdt',
  customerId: 'customer_1',
  kind: 'CRYPTO_WALLET',
  status: 'ACTIVE',
  currency: 'USDT',
  accountNumber: 'CRYPTO-customer_1-USDT',
  name: 'USDT 钱包（Cregis TRON）',
  network: 'TRON',
  availableBalance: '0',
  frozenBalance: '0',
};

const verifiedWallet: CryptoWallet = {
  id: 'wallet_usdt',
  customerId: 'customer_1',
  asset: 'USDT',
  network: 'TRON',
  networkLabel: 'TRON (TRC20)',
  tokenStandard: 'TRC20',
  walletAddress: 'TRON_ADDRESS',
  status: 'ACTIVE',
  availableBalance: '0',
  frozenBalance: '0',
  minimumDeposit: '1',
  withdrawalFee: '5',
  confirmationsRequired: 20,
  custodyProvider: 'CREGIS',
  ownershipVerifiedAt: '2026-08-24T11:24:51.000Z',
  depositEnabled: true,
};

describe('digital wallet account status', () => {
  it('shows an ownership-verified Cregis wallet as active', () => {
    expect(digitalWalletPresentation(account, verifiedWallet)).toEqual({
      label: 'ACTIVE',
      color: 'success',
      description: 'TRON · Cregis 已验证',
    });
  });

  it('keeps an unverified wallet in the waiting state', () => {
    expect(
      digitalWalletPresentation(account, {
        ...verifiedWallet,
        walletAddress: '',
        custodyProvider: null,
        ownershipVerifiedAt: null,
        depositEnabled: false,
      })
    ).toEqual({
      label: '等待 Cregis',
      color: 'default',
      description: 'TRON · 地址归属待验证',
    });
  });

  it('does not misreport an API failure as a custody waiting state', () => {
    expect(digitalWalletPresentation(account, undefined, { error: true })).toEqual({
      label: '状态异常',
      color: 'error',
      description: 'TRON · Cregis 状态读取失败',
    });
  });

  it('preserves a disabled account state even if custody data exists', () => {
    expect(digitalWalletPresentation({ ...account, status: 'DISABLED' }, verifiedWallet)).toEqual({
      label: 'DISABLED',
      color: 'warning',
      description: 'TRON · 操作已禁用',
    });
  });
});
