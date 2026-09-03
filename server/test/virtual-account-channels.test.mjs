import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
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
  const database = {
    fundingChannel: { findUnique: async () => channel },
    customer: { findUnique: async () => customer },
    virtualAccountRequest: {
      findFirst: async () => null,
      create: async ({ data }) => {
        created = data;
        return data;
      },
    },
  };
  const service = new CustomersService(database);

  await service.requestVirtualAccount(
    customer.id,
    { channelId: channel.id, currency: 'HKD', purpose: 'Receive customer payments' },
    { userId: 'usr_neobank_admin', customerId: customer.id, email: 'client@example.com' }
  );

  assert.equal(created.channelId, channel.id);
  assert.equal(created.currency, 'HKD');
  assert.equal(created.preferredCountry, 'HK');
  assert.equal(created.requestSource, 'CUSTOMER');
  assert.equal(created.requesterEmail, 'client@example.com');

  database.fundingChannel.findUnique = async () => ({ ...channel, supportedCurrencies: ['USD'] });
  await assert.rejects(
    service.requestVirtualAccount(
      customer.id,
      { channelId: channel.id, currency: 'HKD', purpose: 'Unsupported request' },
      { userId: 'usr_neobank_admin', customerId: customer.id }
    ),
    /virtual_account_channel_currency_unsupported/
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
