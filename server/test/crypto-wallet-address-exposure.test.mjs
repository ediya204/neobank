import assert from 'node:assert/strict';
import test from 'node:test';
import { CryptoWalletsService } from '../dist/src/crypto-wallets/crypto-wallets.service.js';

const customerId = 'customer_verified_wallet';
const verifiedAddress = 'TXsmKpEuW7qWnXzJLGP9eDLvWPR2GRn1FS';

function serviceWithSourceRows(sourceRows) {
  const db = {
    $queryRaw: async () => sourceRows,
    customer: {
      findUnique: async () => ({ organizationId: 'org_neobank' }),
    },
    user: {
      findUnique: async () => ({ active: true, organizationId: 'org_neobank', role: 'ADMIN' }),
    },
    cryptoWallet: {
      findMany: async () => [
        {
          id: 'core-wallet',
          customerId,
          asset: 'USDT',
          network: 'TRON',
          networkLabel: 'TRON (TRC20)',
          tokenStandard: 'TRC20',
          walletAddress: verifiedAddress,
          status: 'ACTIVE',
          availableBalance: '0',
          frozenBalance: '0',
          minimumDeposit: '1',
          confirmationsRequired: 20,
        },
      ],
    },
  };
  const fees = {
    resolve: async () => ({ amount: '10', snapshot: { version: 'fee-v1' } }),
  };
  return new CryptoWalletsService(db, fees);
}

test('wallet list exposes an address only after the PostgreSQL Cregis ownership gate passes', async () => {
  const previousTenant = process.env.NEOBANK_SOURCE_TENANT_ID;
  process.env.NEOBANK_SOURCE_TENANT_ID = 'neobank';
  try {
    const service = serviceWithSourceRows([
      {
        address: verifiedAddress,
        ownership_verified_at: '2026-08-24T11:24:51.000Z',
      },
    ]);

    const [wallet] = await service.listWallets(customerId, 'usr_admin');

    assert.equal(wallet.walletAddress, verifiedAddress);
    assert.equal(wallet.custodyProvider, 'CREGIS');
    assert.equal(wallet.ownershipVerifiedAt, '2026-08-24T11:24:51.000Z');
    assert.equal(wallet.depositEnabled, true);
  } finally {
    if (previousTenant === undefined) delete process.env.NEOBANK_SOURCE_TENANT_ID;
    else process.env.NEOBANK_SOURCE_TENANT_ID = previousTenant;
  }
});

test('wallet list keeps an unverified Cregis address hidden', async () => {
  const previousTenant = process.env.NEOBANK_SOURCE_TENANT_ID;
  process.env.NEOBANK_SOURCE_TENANT_ID = 'neobank';
  try {
    const service = serviceWithSourceRows([]);

    const [wallet] = await service.listWallets(customerId, 'usr_admin');

    assert.equal(wallet.walletAddress, '');
    assert.equal(wallet.custodyProvider, null);
    assert.equal(wallet.ownershipVerifiedAt, null);
    assert.equal(wallet.depositEnabled, false);
  } finally {
    if (previousTenant === undefined) delete process.env.NEOBANK_SOURCE_TENANT_ID;
    else process.env.NEOBANK_SOURCE_TENANT_ID = previousTenant;
  }
});
