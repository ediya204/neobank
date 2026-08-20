import assert from 'node:assert/strict';
import test from 'node:test';
import { CustomersService } from '../dist/src/customers/customers.service.js';
import {
  ensureCustomerCryptoWalletMirror,
  syncNeobankCustomers,
} from '../dist/src/customers/neobank-customer-sync.js';

const verifiedTronAddress = 'TXsmKpEuW7qWnXzJLGP9eDLvWPR2GRn1FS';

test('PostgreSQL customer sync preserves business profile and original creation time', async () => {
  let upsert;
  await syncNeobankCustomers(
    {
      $queryRaw: async () => [
        {
          account_type: 'business',
          activated_at: null,
          beneficial_owner_name: 'Test Owner',
          beneficial_owner_ownership: '75.00',
          contact_name: 'Test Contact',
          contact_role: 'Director',
          created_at: '2026-08-18T01:02:03.000Z',
          customer_id: 'cus_business',
          date_of_birth: null,
          display_name: 'Test Business',
          email: 'business@example.test',
          full_name: null,
          incorporation_country: 'HK',
          kyc_review_note: null,
          kyc_reviewed_at: null,
          kyc_status: 'pending',
          legal_name: 'Test Business Limited',
          nationality: null,
          operations_status: 'pending',
          phone: '5550000',
          phone_country_code: '+852',
          registration_number: 'REG-TEST',
          residence_country: 'HK',
          status: 'pending_setup',
        },
      ],
      customer: {
        upsert: async (input) => {
          upsert = input;
        },
      },
    },
    { adminUserId: 'usr_admin', organizationId: 'org_neobank', tenantId: 'neobank' }
  );

  assert.equal(upsert.create.registrationNo, 'REG-TEST');
  assert.equal(upsert.create.contactRole, 'Director');
  assert.equal(upsert.create.beneficialOwnerName, 'Test Owner');
  assert.equal(upsert.create.beneficialOwnerOwnership.toFixed(2), '75.00');
  assert.equal(upsert.create.createdAt.toISOString(), '2026-08-18T01:02:03.000Z');
});

test('PostgreSQL customer sync automatically assigns standard fiat accounts after opening', async () => {
  const accountUpserts = [];
  const customerUpserts = [];
  const activeCustomer = {
    account_type: 'individual',
    activated_at: '2026-08-19T02:03:04.000Z',
    beneficial_owner_name: null,
    beneficial_owner_ownership: null,
    contact_name: null,
    contact_role: null,
    created_at: '2026-08-19T01:02:03.000Z',
    customer_id: 'cus_active',
    date_of_birth: '1990-01-01',
    display_name: 'Active Customer',
    email: 'active@example.test',
    full_name: 'Active Customer',
    incorporation_country: null,
    kyc_review_note: 'approved',
    kyc_reviewed_at: '2026-08-19T02:00:00.000Z',
    kyc_status: 'approved',
    legal_name: null,
    nationality: 'HK',
    operations_status: 'active',
    phone: '5550001',
    phone_country_code: '+852',
    registration_number: null,
    residence_country: 'HK',
    status: 'active',
  };
  let sourceQuery = 0;
  const db = {
    $queryRaw: async () => {
      sourceQuery += 1;
      return sourceQuery % 2 === 1 ? [activeCustomer] : [];
    },
    customer: {
      upsert: async (input) => customerUpserts.push(input),
    },
    account: {
      upsert: async (input) => accountUpserts.push(input),
    },
  };

  await syncNeobankCustomers(db, {
    adminUserId: 'usr_admin',
    organizationId: 'org_neobank',
    tenantId: 'neobank',
  });
  await syncNeobankCustomers(db, {
    adminUserId: 'usr_admin',
    organizationId: 'org_neobank',
    tenantId: 'neobank',
  });

  assert.equal(customerUpserts.length, 2);
  assert.deepEqual(
    accountUpserts.map((input) => input.create.currency),
    ['USD', 'HKD', 'USD', 'HKD']
  );
  assert.deepEqual(
    new Set(accountUpserts.map((input) => input.where.accountNumber)),
    new Set(['WALLET-cus_active-USD', 'WALLET-cus_active-HKD'])
  );
  assert.ok(accountUpserts.every((input) => input.create.kind === 'SYSTEM_WALLET'));
  assert.ok(accountUpserts.every((input) => input.create.status === 'ACTIVE'));
});

test('PostgreSQL customer sync creates zero-balance Core mirrors for one verified Cregis wallet', async () => {
  const accountCreates = [];
  const walletCreates = [];
  const activeCustomer = {
    account_type: 'individual',
    activated_at: '2026-08-19T02:03:04.000Z',
    beneficial_owner_name: null,
    beneficial_owner_ownership: null,
    contact_name: null,
    contact_role: null,
    created_at: '2026-08-19T01:02:03.000Z',
    customer_id: 'cus_verified_wallet',
    date_of_birth: '1990-01-01',
    display_name: 'Verified Wallet Customer',
    email: 'wallet@example.test',
    full_name: 'Verified Wallet Customer',
    incorporation_country: null,
    kyc_review_note: 'approved',
    kyc_reviewed_at: '2026-08-19T02:00:00.000Z',
    kyc_status: 'approved',
    legal_name: null,
    nationality: 'HK',
    operations_status: 'active',
    phone: '5550002',
    phone_country_code: '+852',
    registration_number: null,
    residence_country: 'HK',
    status: 'active',
  };
  let sourceQuery = 0;
  const account = {
    findMany: async () => [],
    upsert: async ({ create }) => {
      if (create.kind === 'CRYPTO_WALLET') accountCreates.push(create);
      return { id: 'core-account', ...create };
    },
    update: async () => assert.fail('new account already has the verified address'),
  };
  const cryptoWallet = {
    findUnique: async () => null,
    upsert: async ({ create }) => {
      walletCreates.push(create);
      return { id: 'core-wallet', ...create };
    },
    update: async () => assert.fail('new wallet already has the verified address'),
  };
  await syncNeobankCustomers(
    {
      $queryRaw: async () => {
        sourceQuery += 1;
        return sourceQuery === 1
          ? [activeCustomer]
          : [
              {
                wallet_id: 'cregis-wallet',
                customer_id: activeCustomer.customer_id,
                address: verifiedTronAddress,
              },
            ];
      },
      customer: { upsert: async () => undefined },
      account: { upsert: async () => undefined },
      $transaction: async (callback) => callback({ account, cryptoWallet }),
    },
    { adminUserId: 'usr_admin', organizationId: 'org_neobank', tenantId: 'neobank' }
  );

  assert.equal(accountCreates.length, 1);
  assert.equal(walletCreates.length, 1);
  assert.equal(accountCreates[0].walletAddress, verifiedTronAddress);
  assert.equal(walletCreates[0].walletAddress, verifiedTronAddress);
  assert.equal(accountCreates[0].availableBalance, 0);
  assert.equal(walletCreates[0].availableBalance, 0);
});

test('Core mirror sync rejects a conflicting existing wallet binding without overwriting it', async () => {
  let writes = 0;
  await assert.rejects(
    ensureCustomerCryptoWalletMirror(
      {
        account: {
          findMany: async () => [
            {
              id: 'core-account',
              customerId: 'cus_conflict',
              kind: 'CRYPTO_WALLET',
              status: 'ACTIVE',
              currency: 'USDT',
              network: 'TRON',
              walletAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
            },
          ],
          update: async () => {
            writes += 1;
          },
        },
        cryptoWallet: {
          findUnique: async () => null,
          upsert: async () => {
            writes += 1;
          },
          update: async () => {
            writes += 1;
          },
        },
      },
      { customerId: 'cus_conflict', address: verifiedTronAddress }
    ),
    /core_crypto_account_binding_conflict:cus_conflict/
  );
  assert.equal(writes, 0);
});

test('Core mirror sync rejects divergent materialized balances instead of reconciling silently', async () => {
  let writes = 0;
  await assert.rejects(
    ensureCustomerCryptoWalletMirror(
      {
        account: {
          findMany: async () => [
            {
              id: 'core-account',
              customerId: 'cus_balance_conflict',
              kind: 'CRYPTO_WALLET',
              status: 'ACTIVE',
              currency: 'USDT',
              network: 'TRON',
              walletAddress: verifiedTronAddress,
              availableBalance: '10',
              frozenBalance: '0',
            },
          ],
          update: async () => {
            writes += 1;
          },
        },
        cryptoWallet: {
          findUnique: async () => ({
            id: 'core-wallet',
            customerId: 'cus_balance_conflict',
            asset: 'USDT',
            network: 'TRON',
            status: 'ACTIVE',
            walletAddress: verifiedTronAddress,
            availableBalance: '9',
            frozenBalance: '0',
          }),
          update: async () => {
            writes += 1;
          },
        },
      },
      { customerId: 'cus_balance_conflict', address: verifiedTronAddress }
    ),
    /core_crypto_wallet_balance_conflict:cus_balance_conflict/
  );
  assert.equal(writes, 0);
});

test('customer detail refreshes the PostgreSQL source customer before reading the Core view', async () => {
  const previousTenant = process.env.NEOBANK_SOURCE_TENANT_ID;
  const previousOrganization = process.env.CORE_ORGANIZATION_ID;
  const previousAdmin = process.env.CORE_ADMIN_USER_ID;
  process.env.NEOBANK_SOURCE_TENANT_ID = 'neobank';
  process.env.CORE_ORGANIZATION_ID = 'org_neobank';
  process.env.CORE_ADMIN_USER_ID = 'usr_neobank_admin';

  let sourceReads = 0;
  let customerReads = 0;
  const customer = {
    id: 'cus_live',
    organizationId: 'org_neobank',
    status: 'ACTIVE',
    accounts: [],
    beneficiaries: [],
    operations: [],
  };
  const service = new CustomersService({
    $queryRaw: async () => {
      sourceReads += 1;
      return [];
    },
    user: {
      findUnique: async () => ({
        id: 'usr_neobank_admin',
        active: true,
        organizationId: 'org_neobank',
        role: 'ADMIN',
      }),
    },
    customer: {
      findUnique: async () => {
        customerReads += 1;
        return customer;
      },
    },
  });

  try {
    const result = await service.get('cus_live', 'usr_neobank_admin');
    assert.equal(result.id, 'cus_live');
    assert.equal(sourceReads, 1);
    assert.equal(customerReads, 2);
  } finally {
    if (previousTenant === undefined) delete process.env.NEOBANK_SOURCE_TENANT_ID;
    else process.env.NEOBANK_SOURCE_TENANT_ID = previousTenant;
    if (previousOrganization === undefined) delete process.env.CORE_ORGANIZATION_ID;
    else process.env.CORE_ORGANIZATION_ID = previousOrganization;
    if (previousAdmin === undefined) delete process.env.CORE_ADMIN_USER_ID;
    else process.env.CORE_ADMIN_USER_ID = previousAdmin;
  }
});
