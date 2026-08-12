import {
  cryptoWalletStatusDetails,
  isWithdrawalReady,
  normalizeCryptoWalletStatus,
} from './crypto-wallet-status';

describe('crypto wallet status hardening', () => {
  it.each([
    ['creating', 'CREATING'],
    ['active', 'ACTIVE'],
    ['error', 'ERROR'],
    ['frozen', 'FROZEN'],
    ['closed', 'CLOSED'],
  ] as const)('normalizes %s to %s', (input, expected) => {
    expect(normalizeCryptoWalletStatus(input)).toBe(expected);
  });

  it('fails closed for an unknown provider status', () => {
    expect(normalizeCryptoWalletStatus('unexpected')).toBe('ERROR');
  });

  it.each(['CREATING', 'ERROR', 'FROZEN', 'CLOSED'] as const)(
    'does not allow withdrawals from %s wallets',
    (status) => {
      expect(isWithdrawalReady({ status })).toBe(false);
    }
  );

  it('allows withdrawals only from an active wallet', () => {
    expect(isWithdrawalReady({ status: 'ACTIVE' })).toBe(true);
  });

  it('provides a non-success presentation for every unavailable wallet state', () => {
    (['CREATING', 'ERROR', 'FROZEN', 'CLOSED'] as const).forEach((status) => {
      expect(cryptoWalletStatusDetails(status).color).not.toBe('success');
    });
  });
});
