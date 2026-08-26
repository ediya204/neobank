import assert from 'node:assert/strict';
import test from 'node:test';
import { WithdrawalFeesController } from '../dist/src/withdrawal-fees/withdrawal-fees.controller.js';
import { WithdrawalFeesService } from '../dist/src/withdrawal-fees/withdrawal-fees.service.js';

const admin = {
  id: 'admin_test',
  organizationId: 'org_test',
  active: true,
  role: 'ADMIN',
};

test('customer fee reads are limited to active organization defaults', async () => {
  const calls = [];
  const controller = new WithdrawalFeesController({
    list: async (...args) => {
      calls.push(args);
      return [];
    },
  });
  const customerRequest = {
    header: (name) => {
      if (name === 'x-user-id') return 'admin_test';
      if (name === 'x-authenticated-customer-id') return 'customer_test';
      return undefined;
    },
  };

  await controller.list('org_test', customerRequest, 'true');
  assert.deepEqual(calls, [['org_test', 'admin_test', true, undefined]]);
  assert.throws(
    () => controller.list('org_test', customerRequest, 'false'),
    /customer_active_withdrawal_fees_only/
  );
  assert.throws(
    () => controller.list('org_test', customerRequest, 'true', 'customer_other'),
    /customer_active_withdrawal_fees_only/
  );
});

test('organization listing excludes customer overrides unless a customer is requested', async () => {
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
  assert.deepEqual(where, {
    organizationId: 'org_test',
    scopeId: { in: ['org_test'] },
  });
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
        findMany: async () => [
          {
            id: 'fee_crypto',
            scopeId: 'neobank',
            assetClass: 'CRYPTO',
            currency: 'USDT',
            method: 'ON_CHAIN',
            channelCode: 'CREGIS',
            network: 'TRON',
            feeAmountMinor: 5_000_000n,
            feeDecimals: 6,
            version: 7n,
          },
        ],
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
          findMany: async () => [
            {
              id: 'fee_crypto',
              scopeId: 'neobank',
              assetClass: 'CRYPTO',
              currency: 'USDT',
              method: 'ON_CHAIN',
              channelCode: 'CREGIS',
              network: 'TRON',
              feeAmountMinor: 5_000_000n,
              feeDecimals: 6,
              version: 8n,
            },
          ],
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

test('customer fee override wins over the organization default', async () => {
  let where;
  const service = new WithdrawalFeesService({});
  const result = await service.resolve(
    {
      withdrawalFeeRule: {
        findMany: async (query) => {
          where = query.where;
          return [
            {
              id: 'fee_default',
              scopeId: 'org_test',
              assetClass: 'FIAT',
              currency: 'USD',
              method: 'POBO',
              channelCode: 'BANK-OUT-1',
              network: '',
              feeAmountMinor: 1500n,
              feeDecimals: 2,
              version: 4n,
            },
            {
              id: 'fee_customer',
              scopeId: 'cus_test',
              assetClass: 'FIAT',
              currency: 'USD',
              method: 'POBO',
              channelCode: 'BANK-OUT-1',
              network: '',
              feeAmountMinor: 1000n,
              feeDecimals: 2,
              version: 2n,
            },
          ];
        },
      },
    },
    {
      scopeId: 'org_test',
      customerId: 'cus_test',
      assetClass: 'FIAT',
      currency: 'USD',
      method: 'POBO',
      channelCode: 'bank-out-1',
    }
  );

  assert.deepEqual(where.scopeId, { in: ['cus_test', 'org_test'] });
  assert.equal(result.snapshot.id, 'fee_customer');
  assert.equal(result.snapshot.amount, '10.00');
});

test('an active customer fiat fee remains resolvable when the organization default is missing', async () => {
  const service = new WithdrawalFeesService({});
  const result = await service.resolve(
    {
      withdrawalFeeRule: {
        findMany: async () => [
          {
            id: 'fee_customer_only',
            scopeId: 'cus_test',
            assetClass: 'FIAT',
            currency: 'HKD',
            method: 'VA',
            channelCode: 'VA-BOCHK-HK',
            network: '',
            feeAmountMinor: 8800n,
            feeDecimals: 2,
            version: 3n,
          },
        ],
      },
    },
    {
      scopeId: 'org_test',
      customerId: 'cus_test',
      assetClass: 'FIAT',
      currency: 'HKD',
      method: 'VA',
      channelCode: 'va-bochk-hk',
    }
  );

  assert.equal(result.snapshot.id, 'fee_customer_only');
  assert.equal(result.snapshot.amount, '88.00');
  assert.equal(result.snapshot.version, '3');
});

test('customer fee override cannot cross organization boundaries', async () => {
  const service = new WithdrawalFeesService({
    user: { findUnique: async () => admin },
    customer: {
      findUnique: async () => ({ id: 'cus_other', organizationId: 'org_other' }),
    },
  });

  await assert.rejects(
    service.upsert(
      {
        organizationId: 'org_test',
        customerId: 'cus_other',
        assetClass: 'CRYPTO',
        currency: 'USDT',
        method: 'ON_CHAIN',
        channelCode: 'CREGIS',
        network: 'TRON',
        amount: '5.00',
      },
      admin.id
    ),
    /customer_not_found/
  );
});
