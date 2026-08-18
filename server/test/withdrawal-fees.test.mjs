import assert from 'node:assert/strict';
import test from 'node:test';
import { WithdrawalFeesService } from '../dist/src/withdrawal-fees/withdrawal-fees.service.js';

const admin = {
  id: 'admin_test',
  organizationId: 'org_test',
  active: true,
  role: 'ADMIN',
};

test('organization listing includes crypto rules stored under the production tenant scope', async () => {
  let where;
  const service = new WithdrawalFeesService({
    user: { findUnique: async () => admin },
    withdrawalFeeRule: {
      findMany: async (query) => {
        where = query.where;
        return [];
      },
    },
  });
  await service.list('org_test', admin.id);
  assert.deepEqual(where, { organizationId: 'org_test' });
});

test('fiat fee rules are normalized by channel and stored in exact minor units', async () => {
  let created;
  const transaction = {
    withdrawalFeeRule: {
      findFirst: async () => null,
      create: async ({ data }) => {
        created = data;
        return {
          id: 'fee_test',
          ...data,
          version: 1n,
          createdAt: new Date('2026-08-19T00:00:00Z'),
          updatedAt: new Date('2026-08-19T00:00:00Z'),
        };
      },
    },
  };
  const service = new WithdrawalFeesService({
    user: { findUnique: async () => admin },
    fundingChannel: {
      findFirst: async () => ({
        type: 'POBO_PAYOUT',
        supportedCurrencies: ['USD'],
      }),
    },
    $transaction: async (operation) => operation(transaction),
  });

  const result = await service.upsert(
    {
      organizationId: 'org_test',
      assetClass: 'FIAT',
      currency: 'USD',
      method: 'POBO',
      channelCode: ' bank-out-1 ',
      amount: '12.34',
    },
    admin.id
  );

  assert.equal(created.channelCode, 'BANK-OUT-1');
  assert.equal(created.network, '');
  assert.equal(created.feeAmountMinor, 1234n);
  assert.equal(created.feeDecimals, 2);
  assert.equal(result.amount, '12.34');
  assert.equal(result.version, '1');
});

test('fee resolution returns an immutable versioned snapshot', async () => {
  const service = new WithdrawalFeesService({});
  const result = await service.resolve(
    {
      withdrawalFeeRule: {
        findFirst: async () => ({
          id: 'fee_crypto',
          assetClass: 'CRYPTO',
          currency: 'USDT',
          method: 'ON_CHAIN',
          channelCode: 'CREGIS',
          network: 'TRON',
          feeAmountMinor: 5_000_000n,
          feeDecimals: 6,
          version: 7n,
        }),
      },
    },
    {
      scopeId: 'neobank',
      assetClass: 'CRYPTO',
      currency: 'USDT',
      method: 'ON_CHAIN',
      channelCode: 'cregis',
      network: 'tron',
      expectedVersion: '7',
    }
  );

  assert.equal(result.amount.toString(), '5');
  assert.deepEqual(result.snapshot, {
    id: 'fee_crypto',
    version: '7',
    assetClass: 'CRYPTO',
    currency: 'USDT',
    method: 'ON_CHAIN',
    channelCode: 'CREGIS',
    network: 'TRON',
    amount: '5.000000',
  });
});

test('stale fee confirmation is rejected before a new transfer can be created', async () => {
  const service = new WithdrawalFeesService({});
  await assert.rejects(
    service.resolve(
      {
        withdrawalFeeRule: {
          findFirst: async () => ({
            id: 'fee_crypto',
            assetClass: 'CRYPTO',
            currency: 'USDT',
            method: 'ON_CHAIN',
            channelCode: 'CREGIS',
            network: 'TRON',
            feeAmountMinor: 5_000_000n,
            feeDecimals: 6,
            version: 8n,
          }),
        },
      },
      {
        scopeId: 'neobank',
        assetClass: 'CRYPTO',
        currency: 'USDT',
        method: 'ON_CHAIN',
        channelCode: 'CREGIS',
        network: 'TRON',
        expectedVersion: '7',
      }
    ),
    /withdrawal_fee_changed/
  );
});
