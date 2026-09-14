import assert from 'node:assert/strict';
import test from 'node:test';
import { CustomersService } from '../dist/src/customers/customers.service.js';

test('customer detail reads opening source by tenant and ID independently of the recent list', async (t) => {
  const savedTenant = process.env.NEOBANK_SOURCE_TENANT_ID;
  const savedOrganization = process.env.CORE_ORGANIZATION_ID;
  process.env.NEOBANK_SOURCE_TENANT_ID = 'tenant_test';
  process.env.CORE_ORGANIZATION_ID = 'org_test';
  t.after(() => {
    if (savedTenant === undefined) delete process.env.NEOBANK_SOURCE_TENANT_ID;
    else process.env.NEOBANK_SOURCE_TENANT_ID = savedTenant;
    if (savedOrganization === undefined) delete process.env.CORE_ORGANIZATION_ID;
    else process.env.CORE_ORGANIZATION_ID = savedOrganization;
  });

  const customer = { id: 'customer_older_than_200', organizationId: 'org_test', accounts: [] };
  let source = [{ openingSource: 'admin_direct_opening' }];
  let sourceReads = 0;
  let userOrganization = 'org_test';
  const db = {
    user: { findUnique: async () => ({ active: true, role: 'ADMIN', organizationId: userOrganization }) },
    customer: { findUnique: async () => customer },
    $queryRaw: async (query) => {
      if (!query.sql.includes('AS "openingSource"')) return []; // Existing synchronization.
      sourceReads += 1;
      assert.match(query.sql, /WHERE tenant_id = \? AND id = \?/);
      assert.deepEqual(query.values, ['tenant_test', customer.id]);
      assert.doesNotMatch(query.sql, /LIMIT|ORDER BY/i);
      return source;
    },
  };
  const service = new CustomersService(db);
  assert.equal((await service.get(customer.id, 'admin_test')).openingSource, 'admin_direct_opening');
  source = [{ openingSource: 'standard' }];
  assert.equal((await service.get(customer.id, 'admin_test')).openingSource, 'standard');
  source = [];
  await assert.rejects(service.get(customer.id, 'admin_test'), /customer_not_found/);
  userOrganization = 'another_org';
  const beforeDenied = sourceReads;
  await assert.rejects(service.get(customer.id, 'admin_test'), /customer_not_found/);
  assert.equal(sourceReads, beforeDenied);
});
