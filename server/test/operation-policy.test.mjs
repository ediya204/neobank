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

test('OTC bypass creation and approval stay closed in favor of quote confirmation', async () => {
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
    /otc_quote_confirmation_required/
  );
  await assert.rejects(service.approve('legacy_otc', maker.id), /otc_does_not_require_approval/);
});

test('customer OTC quote stays draft for five seconds without reserving funds', async () => {
  const source = {
    id: 'source_usd',
    customerId: customer.id,
    kind: 'SYSTEM_WALLET',
    status: 'ACTIVE',
    currency: 'USD',
    network: null,
    fundingChannelId: null,
  };
  const target = {
    id: 'target_usdt',
    customerId: customer.id,
    kind: 'CRYPTO_WALLET',
    status: 'ACTIVE',
    currency: 'USDT',
    network: 'TRON',
  };
  let createdData;
  let balanceWrites = 0;
  const tx = {
    operation: {
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => null,
      create: async ({ data }) => {
        createdData = data;
        return { id: 'quote_test', ...data, customer, metadata: data.metadata };
      },
    },
    rateVersion: {
      findFirst: async () => ({ id: 'rate_test', feeBps: 20 }),
    },
    account: {
      updateMany: async () => {
        balanceWrites += 1;
        return { count: 1 };
      },
    },
  };
  const service = new OperationsService({
    user: { findUnique: async () => maker },
    customer: { findUnique: async () => customer },
    account: {
      findUnique: async ({ where }) => (where.id === source.id ? source : target),
    },
    fundingChannel: { findUnique: async () => null },
    beneficiary: { findUnique: async () => null },
    $transaction: async (callback) => callback(tx),
  });
  const before = Date.now();
  const quote = await service.createQuote(
    {
      customerId: customer.id,
      type: 'OTC',
      currency: 'USD',
      quoteCurrency: 'USDT',
      amount: '100',
      feeAmount: '0',
      sourceAccountId: source.id,
      targetAccountId: target.id,
      idempotencyKey: 'quote-key-1',
      marketProvider: 'fastforex',
      marketPriceType: 'midpoint_spot',
      marketReferenceOnly: true,
      marketRate: '1.001',
      marketUpdatedAt: new Date().toISOString(),
      marketFetchedAt: new Date().toISOString(),
    },
    maker.id,
    { customerId: customer.id, email: 'customer@example.com' }
  );
  const expiresAt = Date.parse(quote.quoteExpiresAt);
  assert.equal(createdData.status, 'DRAFT');
  assert.equal(createdData.submittedAt, undefined);
  assert.equal(createdData.rate.toString(), '0.998998');
  assert.equal(createdData.quoteAmount.toString(), '99.8998');
  assert.equal(balanceWrites, 0);
  assert.ok(expiresAt >= before + 4_900 && expiresAt <= Date.now() + 5_100);
});

test('OTC quote confirmation atomically completes without an approval step', async () => {
  const expiresAt = new Date(Date.now() + 5_000).toISOString();
  const operation = {
    id: 'quote_confirm_test',
    reference: 'OP-QUOTE',
    customerId: customer.id,
    customer,
    type: 'OTC',
    status: 'DRAFT',
    currency: 'USD',
    quoteCurrency: 'USDT',
    amount: new Prisma.Decimal('100'),
    feeAmount: new Prisma.Decimal('0'),
    quoteAmount: new Prisma.Decimal('99.8998'),
    rate: new Prisma.Decimal('0.998998'),
    rateVersionId: 'rate_test',
    sourceAccountId: 'source_usd',
    targetAccountId: 'target_usdt',
    makerId: maker.id,
    narrative: 'confirmed quote',
    metadata: { quoteConfirmation: { customerId: customer.id, expiresAt } },
  };
  const statusWrites = [];
  let journalCount = 0;
  const tx = {
    operation: {
      findUnique: async () => operation,
      updateMany: async ({ data }) => {
        statusWrites.push(data.status);
        return { count: 1 };
      },
      update: async ({ data }) => {
        statusWrites.push(data.status || 'SNAPSHOT');
        return { ...operation, ...data, status: data.status || operation.status };
      },
    },
    account: {
      updateMany: async () => ({ count: 1 }),
      findFirst: async ({ where }) => ({ id: `clearing_${where.currency}` }),
    },
    cryptoWallet: { updateMany: async () => ({ count: 1 }) },
    journalEntry: {
      create: async () => {
        journalCount += 1;
      },
    },
  };
  const service = new OperationsService({
    $transaction: async (callback) => callback(tx),
  });
  const completed = await service.confirmQuote(operation.id, { customerId: customer.id });
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.approvedAt, undefined);
  assert.equal(completed.checkerId, undefined);
  assert.deepEqual(statusWrites, ['PROCESSING', 'SNAPSHOT', 'COMPLETED']);
  assert.equal(journalCount, 1);
});

test('expired OTC quote is cancelled without touching balances', async () => {
  const operation = {
    id: 'expired_quote',
    customerId: customer.id,
    customer,
    type: 'OTC',
    status: 'DRAFT',
    metadata: {
      quoteConfirmation: {
        customerId: customer.id,
        expiresAt: new Date(Date.now() - 1).toISOString(),
      },
    },
  };
  let cancelled = false;
  let balanceWrites = 0;
  const service = new OperationsService({
    $transaction: async (callback) =>
      callback({
        operation: {
          findUnique: async () => operation,
          updateMany: async ({ data }) => {
            cancelled = data.status === 'CANCELLED';
            return { count: 1 };
          },
        },
        account: {
          updateMany: async () => {
            balanceWrites += 1;
            return { count: 1 };
          },
        },
      }),
  });
  await assert.rejects(
    service.confirmQuote(operation.id, { customerId: customer.id }),
    /quote_expired/
  );
  assert.equal(cancelled, true);
  assert.equal(balanceWrites, 0);
});

test('deposit approval fails closed with an actionable error when clearing is missing', async () => {
  let credited = false;
  const operation = {
    id: 'deposit_without_clearing',
    type: 'DEPOSIT',
    status: 'SUBMITTED',
    currency: 'USD',
    amount: new Prisma.Decimal('10'),
    feeAmount: new Prisma.Decimal('0'),
    targetAccountId: 'target_test',
    makerId: maker.id,
    metadata: null,
    customer,
  };
  const service = new OperationsService({
    $transaction: async (callback) =>
      callback({
        operation: { findUnique: async () => operation },
        user: { findUnique: async () => maker },
        account: {
          findFirst: async () => null,
          update: async () => {
            credited = true;
          },
        },
      }),
  });

  await assert.rejects(
    service.approve(operation.id, maker.id),
    /clearing_account_not_configured/
  );
  assert.equal(credited, false);
});

test('deposit approval fails closed with an actionable error when clearing is missing', async () => {
  let credited = false;
  const operation = {
    id: 'deposit_without_clearing',
    type: 'DEPOSIT',
    status: 'SUBMITTED',
    currency: 'USD',
    amount: new Prisma.Decimal('10'),
    feeAmount: new Prisma.Decimal('0'),
    targetAccountId: 'target_test',
    makerId: maker.id,
    metadata: null,
    customer,
  };
  const service = new OperationsService({
    $transaction: async (callback) =>
      callback({
        operation: { findUnique: async () => operation },
        user: { findUnique: async () => maker },
        account: {
          findFirst: async () => null,
          update: async () => {
            credited = true;
          },
        },
      }),
  });

  await assert.rejects(service.approve(operation.id, maker.id), /clearing_account_not_configured/);
  assert.equal(credited, false);
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

test('generic operation lists support a bounded recent view and exclude mirrored crypto operations', async () => {
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
  await service.list({ organizationId: customer.organizationId, limit: 5 }, maker.id);
  await service.approvals(customer.organizationId, maker.id);
  assert.equal(observed.length, 2);
  for (const query of observed) {
    assert.deepEqual(query.where.metadata, {
      path: ['cryptoTransferId'],
      equals: Prisma.AnyNull,
    });
  }
  assert.equal(observed[0].take, 5);
  assert.deepEqual(observed[1].orderBy, { submittedAt: 'desc' });
  await assert.rejects(
    service.list({ organizationId: customer.organizationId, limit: 0 }, maker.id),
    /invalid_operations_limit/
  );
});
