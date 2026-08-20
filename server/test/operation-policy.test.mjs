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

test('manual OTC creation and approval stay closed until USDT uses one ledger', async () => {
  const service = new OperationsService({
    $transaction: async (operation) =>
      operation({
        operation: {
          findUnique: async () => ({
            id: 'legacy_otc',
            type: 'OTC',
            status: 'SUBMITTED',
            metadata: null,
          }),
        },
      }),
  });
  await assert.rejects(
    service.create(
      { customerId: customer.id, type: 'OTC', currency: 'USD', amount: '1' },
      maker.id
    ),
    /usdt_otc_disabled_until_single_ledger/
  );
  await assert.rejects(
    service.approve('legacy_otc', maker.id),
    /usdt_otc_disabled_until_single_ledger/
  );
});

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

test('POBO payout accepts an active VA wallet for the same customer and currency', async () => {
  const source = {
    id: 'source_test',
    customerId: customer.id,
    kind: 'VIRTUAL_ACCOUNT',
    status: 'ACTIVE',
    currency: 'USD',
    network: null,
  };
  const payoutChannel = {
    ...channel,
    type: 'POBO_PAYOUT',
  };
  const beneficiary = {
    id: 'beneficiary_test',
    customerId: customer.id,
    type: 'BANK',
    currency: 'USD',
    active: true,
  };
  const service = new OperationsService({});

  assert.doesNotThrow(() =>
    service.validateShape(
      {
        customerId: customer.id,
        type: 'PAYOUT',
        currency: 'USD',
        beneficiaryId: beneficiary.id,
        payoutMethod: 'POBO',
      },
      source,
      null,
      payoutChannel,
      beneficiary
    )
  );
});

test('VA payout reuses the VIRTUAL_ACCOUNT bank channel bound at account opening', () => {
  const source = {
    id: 'source_test',
    customerId: customer.id,
    kind: 'VIRTUAL_ACCOUNT',
    status: 'ACTIVE',
    currency: 'USD',
    network: null,
    fundingChannelId: 'va_bank_channel',
  };
  const beneficiary = {
    id: 'beneficiary_test',
    customerId: customer.id,
    type: 'BANK',
    currency: 'USD',
    active: true,
  };
  const bankChannel = {
    ...channel,
    id: 'va_bank_channel',
    type: 'VIRTUAL_ACCOUNT',
  };
  const service = new OperationsService({});

  assert.doesNotThrow(() =>
    service.validateShape(
      {
        customerId: customer.id,
        type: 'PAYOUT',
        currency: 'USD',
        beneficiaryId: beneficiary.id,
        payoutMethod: 'VA',
      },
      source,
      null,
      bankChannel,
      beneficiary
    )
  );
  assert.throws(
    () =>
      service.validateShape(
        {
          customerId: customer.id,
          type: 'PAYOUT',
          currency: 'USD',
          beneficiaryId: beneficiary.id,
          payoutMethod: 'VA',
        },
        source,
        null,
        { ...bankChannel, id: 'another_va_bank' },
        beneficiary
      ),
    /payout_source_or_channel_mismatch/
  );
  assert.throws(
    () =>
      service.validateShape(
        {
          customerId: customer.id,
          type: 'PAYOUT',
          currency: 'USD',
          beneficiaryId: beneficiary.id,
          payoutMethod: 'VA',
        },
        source,
        null,
        { ...bankChannel, type: 'VA_PAYOUT' },
        beneficiary
      ),
    /payout_source_or_channel_mismatch/
  );
});

test('platform payout continues to reject a VA wallet', async () => {
  const source = {
    id: 'source_test',
    customerId: customer.id,
    kind: 'VIRTUAL_ACCOUNT',
    status: 'ACTIVE',
    currency: 'USD',
    network: null,
  };
  const payoutChannel = {
    ...channel,
    type: 'PLATFORM_PAYOUT',
  };
  const beneficiary = {
    id: 'beneficiary_test',
    customerId: customer.id,
    type: 'BANK',
    currency: 'USD',
    active: true,
  };
  const service = new OperationsService({});

  assert.throws(
    () =>
      service.validateShape(
        {
          customerId: customer.id,
          type: 'PAYOUT',
          currency: 'USD',
          beneficiaryId: beneficiary.id,
          payoutMethod: 'PLATFORM',
        },
        source,
        null,
        payoutChannel,
        beneficiary
      ),
    /payout_source_or_channel_mismatch/
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
        observed.push(query);
        return [];
      },
    },
  });
  await service.list({ organizationId: customer.organizationId }, maker.id);
  await service.approvals(customer.organizationId, maker.id);
  assert.equal(observed.length, 2);
  for (const query of observed) {
    assert.deepEqual(query.where.metadata, {
      path: ['cryptoTransferId'],
      equals: Prisma.AnyNull,
    });
  }
  assert.deepEqual(observed[1].orderBy, { submittedAt: 'desc' });
});
