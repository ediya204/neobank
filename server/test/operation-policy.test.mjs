import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { OperationsService } from '../dist/src/operations/operations.service.js';

const customer = { id: 'customer_test', organizationId: 'org_test' };
const maker = { id: 'admin_test', active: true, organizationId: 'org_test', role: 'ADMIN' };
const channel = {
  id: 'channel_test',
  organizationId: 'org_test',
  type: 'FIAT_INBOUND',
  supportedCurrencies: ['USD', 'HKD'],
  active: true,
};

function depositInput(overrides = {}) {
  return {
    customerId: customer.id,
    type: 'DEPOSIT',
    currency: 'USD',
    amount: '10',
    targetAccountId: 'target_test',
    channelId: channel.id,
    remitterName: 'Sender',
    remittanceReference: ' BANK-REF-1 ',
    receivedAt: '2026-08-13T00:00:00.000Z',
    ...overrides,
  };
}

function databaseForDeposit(target, transaction) {
  return {
    user: { findUnique: async () => maker },
    customer: { findUnique: async () => customer },
    account: { findUnique: async () => target },
    fundingChannel: { findUnique: async () => channel },
    beneficiary: { findUnique: async () => null },
    $transaction: async (operation) => operation(transaction),
  };
}

test('fiat deposit rejects a target account with a different currency', async () => {
  const target = {
    id: 'target_test',
    customerId: customer.id,
    kind: 'SYSTEM_WALLET',
    status: 'ACTIVE',
    currency: 'HKD',
    network: null,
  };
  const service = new OperationsService(databaseForDeposit(target, {}));
  await assert.rejects(
    service.create(depositInput(), maker.id),
    /deposit_target_currency_mismatch/
  );
});

test('same channel remittance reference is idempotent only for the same deposit payload', async () => {
  const target = {
    id: 'target_test',
    customerId: customer.id,
    kind: 'SYSTEM_WALLET',
    status: 'ACTIVE',
    currency: 'USD',
    network: null,
  };
  const existing = {
    id: 'operation_existing',
    type: 'DEPOSIT',
    customerId: customer.id,
    targetAccountId: target.id,
    currency: 'USD',
    amount: new Prisma.Decimal('10'),
  };
  const transaction = { operation: { findFirst: async () => existing } };
  const service = new OperationsService(databaseForDeposit(target, transaction));
  assert.equal(await service.create(depositInput(), maker.id), existing);
  await assert.rejects(
    service.create(depositInput({ amount: '11' }), maker.id),
    /duplicate_remittance_reference/
  );
});

test('mirrored USDT operations cannot use generic approval, rejection, or execution', async () => {
  const mirrored = {
    id: 'crypto_transfer_test',
    type: 'PAYOUT',
    status: 'SUBMITTED',
    metadata: { rail: 'TRON', cryptoTransferId: 'crypto_transfer_test' },
  };
  const service = new OperationsService({
    $transaction: async (operation) =>
      operation({ operation: { findUnique: async () => mirrored } }),
  });
  await assert.rejects(
    service.approve(mirrored.id, maker.id),
    /crypto_transfer_requires_crypto_workflow/
  );
  await assert.rejects(
    service.reject(mirrored.id, 'reject', maker.id),
    /crypto_transfer_requires_crypto_workflow/
  );
  await assert.rejects(
    service.execute(mirrored.id, 'external-ref', maker.id),
    /crypto_transfer_requires_crypto_workflow/
  );
});

test('generic operation lists and approval queues exclude mirrored crypto operations', async () => {
  const observed = [];
  const service = new OperationsService({
    user: {
      findUnique: async () => ({ ...maker, organizationId: customer.organizationId }),
    },
    operation: {
      findMany: async (query) => {
        observed.push(query.where);
        return [];
      },
    },
  });
  await service.list({ organizationId: customer.organizationId }, maker.id);
  await service.approvals(customer.organizationId, maker.id);
  assert.equal(observed.length, 2);
  for (const where of observed) {
    assert.deepEqual(where.metadata, {
      path: ['cryptoTransferId'],
      equals: Prisma.AnyNull,
    });
  }
});
