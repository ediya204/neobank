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

test('VA channel creation stores an exact USD opening fee while remaining inactive', async () => {
  let createData;
  const controller = new ChannelsController({
    user: { findUnique: async () => admin },
    fundingChannel: {
      create: async ({ data }) => {
        createData = data;
        return { id: 'channel_va_fee', ...data, createdAt: new Date(), updatedAt: new Date() };
      },
    },
  });

  const result = await controller.create(
    {
      organizationId: 'org_test',
      code: 'VA-FEE-01',
      name: 'VA Fee Bank',
      type: 'VIRTUAL_ACCOUNT',
      supportedCurrencies: ['USD'],
      openingFeeUsd: '25.00',
    },
    request
  );

  assert.equal(createData.openingFeeUsdMinor, 2500n);
  assert.equal(createData.openingFeeVersion, 1n);
  assert.equal(createData.openingFeeUpdatedBy, admin.id);
  assert.equal(result.openingFeeUsd, '25.00');
  assert.equal(result.openingFeeVersion, '1');
  assert.equal(result.active, false);
});

test('VA opening fee accepts zero but rejects negative and fractional cents', async () => {
  let createData;
  const controller = new ChannelsController({
    user: { findUnique: async () => admin },
    fundingChannel: {
      create: async ({ data }) => {
        createData = data;
        return { id: 'channel_va_free', ...data, createdAt: new Date(), updatedAt: new Date() };
      },
    },
  });
  const base = {
    organizationId: 'org_test',
    code: 'VA-FREE-01',
    name: 'VA Free Bank',
    type: 'VIRTUAL_ACCOUNT',
    supportedCurrencies: ['USD'],
  };

  await controller.create({ ...base, openingFeeUsd: '0.00' }, request);
  assert.equal(createData.openingFeeUsdMinor, 0n);
  await assert.rejects(
    controller.create({ ...base, code: 'VA-BAD-01', openingFeeUsd: '-1.00' }, request),
    /invalid_virtual_account_opening_fee/
  );
  await assert.rejects(
    controller.create({ ...base, code: 'VA-BAD-02', openingFeeUsd: '1.001' }, request),
    /invalid_virtual_account_opening_fee/
  );
});

test('non-VA channels reject an opening fee and VA activation requires an explicit fee', async () => {
  const controller = new ChannelsController({
    user: { findUnique: async () => admin },
    fundingChannel: {
      create: async () => assert.fail('non-VA fee must not be stored'),
      findUnique: async () => ({
        id: 'channel_va_unpriced',
        organizationId: 'org_test',
        type: 'VIRTUAL_ACCOUNT',
        active: false,
        settlementBankName: 'VA Bank',
        swiftBic: 'VABANKHK',
        bankCountry: 'HK',
        bankAddress: 'Central',
        openingFeeUsdMinor: null,
        openingFeeVersion: 0n,
      }),
      update: async () => assert.fail('unpriced VA channel must not activate'),
    },
  });

  await assert.rejects(
    controller.create(
      {
        organizationId: 'org_test',
        code: 'INBOUND-FEE',
        name: 'Inbound',
        type: 'FIAT_INBOUND',
        supportedCurrencies: ['USD'],
        openingFeeUsd: '1.00',
      },
      request
    ),
    /virtual_account_opening_fee_va_only/
  );
  await assert.rejects(
    controller.update('channel_va_unpriced', { active: true }, request),
    /virtual_account_opening_fee_not_configured/
  );
});

test('VA opening fee update uses optimistic versioning', async () => {
  let updateWhere;
  let updateData;
  const current = {
    id: 'channel_va_priced',
    organizationId: 'org_test',
    type: 'VIRTUAL_ACCOUNT',
    active: true,
    settlementBankName: 'VA Bank',
    swiftBic: 'VABANKHK',
    bankCountry: 'HK',
    bankAddress: 'Central',
    openingFeeUsdMinor: 2500n,
    openingFeeVersion: 3n,
  };
  const database = {
    user: { findUnique: async () => admin },
    fundingChannel: {
      findUnique: async () => current,
      updateMany: async ({ where, data }) => {
        updateWhere = where;
        updateData = data;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({
        ...current,
        openingFeeUsdMinor: 3000n,
        openingFeeVersion: 4n,
        openingFeeUpdatedBy: admin.id,
        openingFeeUpdatedAt: new Date('2026-09-03T00:00:00.000Z'),
      }),
    },
  };
  const controller = new ChannelsController(database);

  const result = await controller.update(
    current.id,
    { openingFeeUsd: '30.00', expectedOpeningFeeVersion: '3' },
    request
  );

  assert.deepEqual(updateWhere, { id: current.id, openingFeeVersion: 3n });
  assert.equal(updateData.openingFeeUsdMinor, 3000n);
  assert.deepEqual(updateData.openingFeeVersion, { increment: 1 });
  assert.equal(result.openingFeeUsd, '30.00');
  assert.equal(result.openingFeeVersion, '4');

  database.fundingChannel.updateMany = async () => ({ count: 0 });
  await assert.rejects(
    controller.update(
      current.id,
      { openingFeeUsd: '35.00', expectedOpeningFeeVersion: '3' },
      request
    ),
    /virtual_account_opening_fee_changed/
  );
});

test('customer VA channel reads expose fee quote without updater identity', async () => {
  const customerRequest = {
    header: (name) => {
      if (name === 'x-user-id') return admin.id;
      if (name === 'x-authenticated-customer-id') return 'customer_test';
      return undefined;
    },
  };
  const controller = new ChannelsController({
    user: { findUnique: async () => admin },
    fundingChannel: {
      findMany: async () => [
        {
          id: 'channel_va_customer',
          organizationId: 'org_test',
          code: 'VA-CUSTOMER',
          name: 'VA Customer Bank',
          type: 'VIRTUAL_ACCOUNT',
          supportedCurrencies: ['USD'],
          active: true,
          settlementBankName: 'VA Customer Bank',
          swiftBic: 'VACUSTHK',
          bankCountry: 'HK',
          bankAddress: 'Central',
          openingFeeUsdMinor: 2500n,
          openingFeeVersion: 7n,
          openingFeeUpdatedBy: 'admin_secret',
          openingFeeUpdatedAt: new Date('2026-09-03T00:00:00.000Z'),
        },
      ],
    },
  });

  const [result] = await controller.list(
    'org_test',
    customerRequest,
    'VIRTUAL_ACCOUNT',
    'true'
  );
  assert.equal(result.openingFeeUsd, '25.00');
  assert.equal(result.openingFeeVersion, '7');
  assert.equal('openingFeeUpdatedBy' in result, false);
});
