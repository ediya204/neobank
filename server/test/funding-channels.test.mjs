import assert from 'node:assert/strict';
import test from 'node:test';
import { ChannelsController } from '../dist/src/channels/channels.controller.js';

const admin = {
  id: 'admin_test',
  organizationId: 'org_test',
  active: true,
  role: 'ADMIN',
};

const request = { header: (name) => (name === 'x-user-id' ? 'admin_test' : undefined) };

test('new funding channels are normalized and remain inactive until explicitly enabled', async () => {
  let createData;
  const controller = new ChannelsController({
    user: { findUnique: async () => admin },
    fundingChannel: {
      create: async ({ data }) => {
        createData = data;
        return { id: 'channel_test', ...data };
      },
    },
  });

  const result = await controller.create(
    {
      organizationId: 'org_test',
      code: 'BANK-IN-02',
      name: '  新法币入账通道  ',
      type: 'FIAT_INBOUND',
      supportedCurrencies: ['USD', 'HKD'],
      settlementBankName: '  Example Bank  ',
      settlementAccount: '  123-456  ',
      swiftBic: '  exampLe1  ',
    },
    request
  );

  assert.equal(result.active, false);
  assert.equal(createData.name, '新法币入账通道');
  assert.equal(createData.settlementBankName, 'Example Bank');
  assert.equal(createData.settlementAccount, '123-456');
  assert.equal(createData.swiftBic, 'EXAMPLE1');
});

test('non-VA channels can be activated without bank or settlement details', async () => {
  for (const type of ['FIAT_INBOUND', 'POBO_PAYOUT', 'PLATFORM_PAYOUT']) {
    let updateData;
    const controller = new ChannelsController({
      user: { findUnique: async () => admin },
      fundingChannel: {
        findUnique: async () => ({
          organizationId: 'org_test',
          type,
          active: false,
        }),
        update: async ({ data }) => {
          updateData = data;
          return { id: `channel_${type}`, type, ...data };
        },
      },
    });

    const result = await controller.update(`channel_${type}`, { active: true }, request);
    assert.equal(result.active, true);
    assert.deepEqual(updateData, { active: true });
  }
});

test('non-admin users cannot create funding channels', async () => {
  const controller = new ChannelsController({
    user: { findUnique: async () => ({ ...admin, role: 'MAKER' }) },
    fundingChannel: { create: async () => assert.fail('create must not be called') },
  });

  await assert.rejects(
    controller.create(
      {
        organizationId: 'org_test',
        code: 'BANK-IN-02',
        name: 'New channel',
        type: 'FIAT_INBOUND',
        supportedCurrencies: ['USD'],
      },
      request
    ),
    /admin_role_required/
  );
});

test('VA payout cannot be configured as a separate new funding channel', async () => {
  const controller = new ChannelsController({
    user: { findUnique: async () => admin },
    fundingChannel: { create: async () => assert.fail('create must not be called') },
  });

  await assert.rejects(
    controller.create(
      {
        organizationId: 'org_test',
        code: 'VA-PAYOUT-02',
        name: 'Duplicate VA payout channel',
        type: 'VA_PAYOUT',
        supportedCurrencies: ['USD'],
      },
      request
    ),
    /va_payout_channel_merged/
  );
});

test('VA bank channels reject customer-specific account and branch details', async () => {
  const controller = new ChannelsController({
    user: { findUnique: async () => admin },
    fundingChannel: { create: async () => assert.fail('create must not be called') },
  });

  await assert.rejects(
    controller.create(
      {
        organizationId: 'org_test',
        code: 'VA-BANK-01',
        name: 'VA Bank',
        type: 'VIRTUAL_ACCOUNT',
        supportedCurrencies: ['USD'],
        settlementAccount: 'customer-account-001',
      },
      request
    ),
    /virtual_account_channel_customer_details_not_allowed/
  );

  await assert.rejects(
    controller.create(
      {
        organizationId: 'org_test',
        code: 'VA-BANK-02',
        name: 'VA Bank',
        type: 'VIRTUAL_ACCOUNT',
        supportedCurrencies: ['USD'],
        branchName: 'Customer Branch',
      },
      request
    ),
    /virtual_account_channel_customer_details_not_allowed/
  );
});

test('an existing VA bank channel cannot be assigned a shared account or branch', async () => {
  const controller = new ChannelsController({
    user: { findUnique: async () => admin },
    fundingChannel: {
      findUnique: async () => ({
        organizationId: 'org_test',
        type: 'VIRTUAL_ACCOUNT',
        active: false,
      }),
      update: async () => assert.fail('update must not be called'),
    },
  });

  await assert.rejects(
    controller.update('channel_va', { branchName: 'Shared Branch' }, request),
    /virtual_account_channel_customer_details_not_allowed/
  );
  await assert.rejects(
    controller.update('channel_va', { settlementAccount: 'shared-account' }, request),
    /virtual_account_channel_customer_details_not_allowed/
  );
});

test('customer channel reads expose active inbound instructions but keep VA account details hidden', async () => {
  const customerRequest = {
    header: (name) => {
      if (name === 'x-user-id') return 'admin_test';
      if (name === 'x-authenticated-customer-id') return 'customer_test';
      return undefined;
    },
  };
  let selectedType;
  const controller = new ChannelsController({
    user: { findUnique: async () => admin },
    fundingChannel: {
      findMany: async ({ where }) => {
        selectedType = where.type;
        return [
          {
            id: 'channel_customer',
            organizationId: 'org_test',
            code: 'CHANNEL-01',
            name: 'Customer Bank',
            type: where.type,
            supportedCurrencies: ['USD'],
            active: true,
            settlementBankName: 'Example Bank',
            settlementAccount: '123-456',
            swiftBic: 'EXAMPLE1',
            bankCountry: 'HK',
            bankAddress: 'Central',
          },
        ];
      },
    },
  });

  const inbound = await controller.list('org_test', customerRequest, 'FIAT_INBOUND', 'true');
  assert.equal(selectedType, 'FIAT_INBOUND');
  assert.equal(inbound[0].settlementAccount, '123-456');

  const virtualAccount = await controller.list(
    'org_test',
    customerRequest,
    'VIRTUAL_ACCOUNT',
    'true'
  );
  assert.equal(selectedType, 'VIRTUAL_ACCOUNT');
  assert.equal('settlementAccount' in virtualAccount[0], false);

  const platformPayout = await controller.list(
    'org_test',
    customerRequest,
    'PLATFORM_PAYOUT',
    'true'
  );
  assert.equal(selectedType, 'PLATFORM_PAYOUT');
  assert.equal(platformPayout[0].code, 'CHANNEL-01');
  assert.equal('settlementAccount' in platformPayout[0], false);
});
