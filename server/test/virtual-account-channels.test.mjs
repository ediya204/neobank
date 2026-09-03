import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { CustomersService } from '../dist/src/customers/customers.service.js';

const channel = {
  id: 'channel_hk_va',
  organizationId: 'org_neobank',
  code: 'VA-HK-01',
  name: 'Hong Kong VA',
  type: 'VIRTUAL_ACCOUNT',
  active: true,
  supportedCurrencies: ['USD', 'HKD'],
  settlementBankName: 'Example Bank Hong Kong',
  settlementAccount: null,
  swiftBic: 'EXAMPLEHKHKG',
  bankCountry: 'HK',
  bankAddress: '1 Finance Street, Hong Kong',
  branchName: 'Central Branch',
  openingFeeUsdMinor: 2500n,
  openingFeeVersion: 2n,
};

const customer = {
  id: 'customer_001',
  organizationId: 'org_neobank',
  status: 'ACTIVE',
};

test('VA opening fee schema keeps one request snapshot and one optional operation', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  assert.match(schema, /VA_OPENING_FEE/);
  assert.match(schema, /CANCELLED/);
  assert.match(schema, /openingFeeUsdMinor\s+BigInt\?/);
  assert.match(schema, /feeOperationId\s+String\?\s+@unique/);
  assert.match(schema, /@@unique\(\[customerId, idempotencyKey\]\)/);
});

test('customer selects a VA bank and the service enforces its supported currencies', async () => {
  let created;
  let activeChannel = { ...channel, openingFeeUsdMinor: 0n };
  const database = {
    fundingChannel: { findUnique: async () => activeChannel },
    customer: { findUnique: async () => customer },
    virtualAccountRequest: {
      findFirst: async () => null,
      create: async ({ data }) => {
        created = data;
        return data;
      },
    },
    $transaction: async (callback) => callback(database),
  };
  const service = new CustomersService(database);

  await service.requestVirtualAccount(
    customer.id,
    {
      channelId: channel.id,
      currency: 'HKD',
      purpose: 'Receive customer payments',
      expectedOpeningFeeUsd: '0.00',
      expectedOpeningFeeVersion: '2',
      idempotencyKey: 'va-bank-selection-key',
    },
    { userId: 'usr_neobank_admin', customerId: customer.id, email: 'client@example.com' }
  );

  assert.equal(created.channelId, channel.id);
  assert.equal(created.currency, 'HKD');
  assert.equal(created.preferredCountry, 'HK');
  assert.equal(created.requestSource, 'CUSTOMER');
  assert.equal(created.requesterEmail, 'client@example.com');

  activeChannel = { ...activeChannel, supportedCurrencies: ['USD'] };
  await assert.rejects(
    service.requestVirtualAccount(
      customer.id,
      {
        channelId: channel.id,
        currency: 'HKD',
        purpose: 'Unsupported request',
        expectedOpeningFeeUsd: '0.00',
        expectedOpeningFeeVersion: '2',
        idempotencyKey: 'va-bank-unsupported-key',
      },
      { userId: 'usr_neobank_admin', customerId: customer.id }
    ),
    /virtual_account_channel_currency_unsupported/
  );
});

test('customer VA submission freezes the bank fee once from the USD wallet', async () => {
  const wallet = {
    id: 'wallet_usd',
    customerId: customer.id,
    kind: 'SYSTEM_WALLET',
    status: 'ACTIVE',
    currency: 'USD',
    availableBalance: new Prisma.Decimal('100'),
    frozenBalance: new Prisma.Decimal('0'),
  };
  const feeAccount = {
    id: 'fees_usd',
    customerId: null,
    kind: 'FEE_REVENUE',
    status: 'ACTIVE',
    currency: 'USD',
  };
  let balanceUpdate;
  let operationData;
  let requestData;
  const tx = {
    virtualAccountRequest: {
      findFirst: async () => null,
      create: async ({ data }) => {
        requestData = data;
        return {
          ...data,
          channel,
          feeOperation: { id: data.feeOperationId, ...operationData, sourceAccount: wallet },
        };
      },
    },
    fundingChannel: { findUnique: async () => channel },
    customer: { findUnique: async () => customer },
    account: {
      findMany: async ({ where }) => (where.kind === 'SYSTEM_WALLET' ? [wallet] : [feeAccount]),
      updateMany: async (input) => {
        balanceUpdate = input;
        return { count: 1 };
      },
    },
    operation: {
      create: async ({ data }) => {
        operationData = data;
        return { ...data };
      },
    },
  };
  const service = new CustomersService({
    customer: { findUnique: async () => customer },
    $transaction: async (callback) => callback(tx),
  });

  const result = await service.requestVirtualAccount(
    customer.id,
    {
      channelId: channel.id,
      currency: 'HKD',
      purpose: 'Receive customer payments',
      expectedOpeningFeeUsd: '25.00',
      expectedOpeningFeeVersion: '2',
      idempotencyKey: 'va-request-key-1',
    },
    { userId: 'usr_neobank_admin', customerId: customer.id, email: 'client@example.com' }
  );

  assert.deepEqual(balanceUpdate.where, {
    id: wallet.id,
    status: 'ACTIVE',
    availableBalance: { gte: new Prisma.Decimal('25') },
  });
  assert.equal(balanceUpdate.data.availableBalance.decrement.toString(), '25');
  assert.equal(balanceUpdate.data.frozenBalance.increment.toString(), '25');
  assert.equal(operationData.type, 'VA_OPENING_FEE');
  assert.equal(operationData.status, 'SUBMITTED');
  assert.equal(operationData.currency, 'USD');
  assert.equal(operationData.amount.toString(), '25');
  assert.equal(operationData.sourceAccountId, wallet.id);
  assert.equal(operationData.targetAccountId, feeAccount.id);
  assert.equal(operationData.idempotencyKey, 'va-opening-fee:va-request-key-1');
  assert.equal(requestData.openingFeeUsdMinor, 2500n);
  assert.equal(requestData.openingFeeVersion, 2n);
  assert.equal(result.openingFeeUsd, '25.00');
  assert.equal(result.openingFeeVersion, '2');
});

test('free VA submission snapshots zero without accounts or an operation', async () => {
  const freeChannel = { ...channel, openingFeeUsdMinor: 0n, openingFeeVersion: 4n };
  let accountQueries = 0;
  let operationWrites = 0;
  const tx = {
    virtualAccountRequest: {
      findFirst: async () => null,
      create: async ({ data }) => ({ ...data, channel: freeChannel, feeOperation: null }),
    },
    fundingChannel: { findUnique: async () => freeChannel },
    customer: { findUnique: async () => customer },
    account: {
      findMany: async () => {
        accountQueries += 1;
        return [];
      },
    },
    operation: {
      create: async () => {
        operationWrites += 1;
      },
    },
  };
  const service = new CustomersService({
    customer: { findUnique: async () => customer },
    $transaction: async (callback) => callback(tx),
  });

  const result = await service.requestVirtualAccount(
    customer.id,
    {
      channelId: freeChannel.id,
      currency: 'USD',
      purpose: 'Receive payments',
      expectedOpeningFeeUsd: '0.00',
      expectedOpeningFeeVersion: '4',
      idempotencyKey: 'va-free-key',
    },
    { userId: 'usr_neobank_admin', customerId: customer.id }
  );

  assert.equal(accountQueries, 0);
  assert.equal(operationWrites, 0);
  assert.equal(result.openingFeeUsd, '0.00');
  assert.equal(result.feeOperationId, null);
});

test('VA submission rejects missing configuration, stale confirmation, and insufficient USD', async () => {
  const wallet = {
    id: 'wallet_usd',
    customerId: customer.id,
    kind: 'SYSTEM_WALLET',
    status: 'ACTIVE',
    currency: 'USD',
  };
  const feeAccount = {
    id: 'fees_usd',
    customerId: null,
    kind: 'FEE_REVENUE',
    status: 'ACTIVE',
    currency: 'USD',
  };
  let activeChannel = { ...channel, openingFeeUsdMinor: null };
  let accountMode = 'normal';
  let balanceWrites = 0;
  const tx = {
    virtualAccountRequest: { findFirst: async () => null },
    fundingChannel: { findUnique: async () => activeChannel },
    customer: { findUnique: async () => customer },
    account: {
      findMany: async ({ where }) => {
        if (where.kind === 'SYSTEM_WALLET') return accountMode === 'missing-wallet' ? [] : [wallet];
        return accountMode === 'missing-fee-account' ? [] : [feeAccount];
      },
      updateMany: async () => {
        balanceWrites += 1;
        return { count: 0 };
      },
    },
  };
  const service = new CustomersService({
    customer: { findUnique: async () => customer },
    $transaction: async (callback) => callback(tx),
  });
  const input = {
    channelId: channel.id,
    currency: 'USD',
    purpose: 'Receive payments',
    expectedOpeningFeeUsd: '25.00',
    expectedOpeningFeeVersion: '2',
    idempotencyKey: 'va-error-key',
  };
  const actor = { userId: 'usr_neobank_admin', customerId: customer.id };

  await assert.rejects(
    service.requestVirtualAccount(customer.id, input, actor),
    /virtual_account_opening_fee_not_configured/
  );
  activeChannel = channel;
  await assert.rejects(
    service.requestVirtualAccount(customer.id, { ...input, expectedOpeningFeeVersion: '1' }, actor),
    /virtual_account_opening_fee_changed/
  );
  accountMode = 'missing-wallet';
  await assert.rejects(
    service.requestVirtualAccount(customer.id, input, actor),
    /usd_wallet_not_found/
  );
  accountMode = 'missing-fee-account';
  await assert.rejects(
    service.requestVirtualAccount(customer.id, input, actor),
    /fee_account_not_configured/
  );
  accountMode = 'normal';
  await assert.rejects(
    service.requestVirtualAccount(customer.id, input, actor),
    /insufficient_available_balance/
  );
  assert.equal(balanceWrites, 1);
});

test('VA submission idempotency returns the original snapshot before reading the current fee', async () => {
  const existing = {
    id: 'request_existing',
    customerId: customer.id,
    channelId: channel.id,
    currency: 'USD',
    purpose: 'Receive payments',
    status: 'SUBMITTED',
    idempotencyKey: 'va-existing-key',
    openingFeeUsdMinor: 2500n,
    openingFeeVersion: 2n,
    feeOperationId: 'fee_existing',
    channel,
    feeOperation: null,
  };
  let channelReads = 0;
  const service = new CustomersService({
    customer: { findUnique: async () => customer },
    $transaction: async (callback) =>
      callback({
        virtualAccountRequest: { findFirst: async () => existing },
        fundingChannel: {
          findUnique: async () => {
            channelReads += 1;
            return null;
          },
        },
      }),
  });

  const result = await service.requestVirtualAccount(
    customer.id,
    {
      channelId: channel.id,
      currency: 'USD',
      purpose: 'Receive payments',
      expectedOpeningFeeUsd: '25.00',
      expectedOpeningFeeVersion: '2',
      idempotencyKey: 'va-existing-key',
    },
    { userId: 'usr_neobank_admin', customerId: customer.id }
  );

  assert.equal(result.id, existing.id);
  assert.equal(result.openingFeeUsd, '25.00');
  assert.equal(channelReads, 0);
  await assert.rejects(
    service.requestVirtualAccount(
      customer.id,
      {
        channelId: channel.id,
        currency: 'USD',
        purpose: 'Different payload',
        expectedOpeningFeeUsd: '25.00',
        expectedOpeningFeeVersion: '2',
        idempotencyKey: 'va-existing-key',
      },
      { userId: 'usr_neobank_admin', customerId: customer.id }
    ),
    /idempotency_key_reused/
  );
});

test('admin must enter the assigned account while bank details come from the channel', async () => {
  let accountData;
  const request = {
    id: 'va_request_001',
    customerId: customer.id,
    customer: { ...customer, email: 'client@example.com', displayName: 'Client Ltd' },
    currency: 'USD',
    status: 'SUBMITTED',
    makerId: 'usr_neobank_admin',
    channel,
  };
  const transaction = {
    virtualAccountRequest: {
      findUnique: async () => request,
      update: async ({ data }) => ({ ...request, ...data }),
    },
    user: {
      findUnique: async () => ({
        id: 'usr_neobank_admin',
        organizationId: 'org_neobank',
        active: true,
        role: 'ADMIN',
      }),
    },
    account: {
      create: async ({ data }) => {
        accountData = data;
        return { id: 'account_001', ...data };
      },
    },
  };
  const service = new CustomersService({
    $transaction: async (operation) => operation(transaction),
  });

  await service.approveVirtualAccountRequest(
    request.id,
    { accountName: 'Client Ltd', accountNumber: '00123456789', iban: 'HK00EXAMPLE001' },
    'usr_neobank_admin'
  );

  assert.equal(accountData.name, 'Client Ltd');
  assert.equal(accountData.accountNumber, '00123456789');
  assert.equal(accountData.iban, 'HK00EXAMPLE001');
  assert.equal(accountData.bankName, channel.settlementBankName);
  assert.equal(accountData.bankAddress, channel.bankAddress);
  assert.equal(accountData.bankCountry, channel.bankCountry);
  assert.equal(accountData.swiftBic, channel.swiftBic);
  assert.equal(accountData.branchName, undefined);
  assert.equal(accountData.fundingChannelId, channel.id);
});

test('VA rejection trims a customer-visible reason and rejects whitespace-only input', async () => {
  let rejectionData;
  const request = {
    id: 'va_request_reject_001',
    customerId: customer.id,
    customer: { ...customer, email: 'client@example.com', displayName: 'Client Ltd' },
    currency: 'USD',
    status: 'SUBMITTED',
    makerId: 'usr_neobank_admin',
  };
  const transaction = {
    virtualAccountRequest: {
      findUnique: async () => request,
      update: async ({ data }) => {
        rejectionData = data;
        return { ...request, ...data };
      },
    },
    user: {
      findUnique: async () => ({
        id: 'usr_neobank_admin',
        organizationId: 'org_neobank',
        active: true,
        role: 'ADMIN',
      }),
    },
  };
  const service = new CustomersService({
    $transaction: async (operation) => operation(transaction),
  });

  await assert.rejects(
    service.rejectVirtualAccountRequest(request.id, 'usr_neobank_admin', '   '),
    /virtual_account_rejection_reason_required/
  );
  await service.rejectVirtualAccountRequest(
    request.id,
    'usr_neobank_admin',
    '  The requested purpose is not supported.  '
  );

  assert.equal(rejectionData.rejectionReason, 'The requested purpose is not supported.');
});
