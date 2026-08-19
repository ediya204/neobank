import assert from 'node:assert/strict';
import test from 'node:test';
import { CustomersService } from '../dist/src/customers/customers.service.js';
import { syncNeobankCustomers } from '../dist/src/customers/neobank-customer-sync.js';

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
  const db = {
    $queryRaw: async () => [activeCustomer],
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
