import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { CustomersService } from '../dist/src/customers/customers.service.js';

// Execute the actual eligibility SQL on disposable local PostgreSQL tables.
const url = process.env.INTERNAL_IDENTITY_TEST_DATABASE_URL;
test(
  'internal identity accepts audited admin openings and rejects untrusted sources',
  { skip: !url },
  async (t) => {
    assert.ok(['127.0.0.1', 'localhost'].includes(new URL(url).hostname));
    const original = process.env.NEOBANK_SOURCE_TENANT_ID;
    process.env.NEOBANK_SOURCE_TENANT_ID = 'tenant_test';
    t.after(() => {
      if (original === undefined) delete process.env.NEOBANK_SOURCE_TENANT_ID;
      else process.env.NEOBANK_SOURCE_TENANT_ID = original;
    });
    const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
    for (const [createdBy, event, actor, tenant, allowed] of [
      ['admin_direct_opening', 'customer.admin_opened', 'admin_test', 'tenant_test', true],
      ['admin_test', 'customer.created', 'admin_test', 'tenant_test', true],
      ['public_registration', 'customer.admin_opened', 'admin_test', 'tenant_test', false],
      ['admin_direct_opening', 'wrong_event', 'admin_test', 'tenant_test', false],
      ['admin_direct_opening', 'customer.admin_opened', 'other_admin', 'tenant_test', false],
      ['admin_direct_opening', 'customer.admin_opened', 'admin_test', 'other_tenant', false],
    ]) {
      let updates = 0;
      let audits = 0;
      const tx = {
        user: {
          findUnique: async () => ({ active: true, role: 'ADMIN', organizationId: 'org_test' }),
        },
        customer: {
          findUnique: async () => ({
            organizationId: 'org_test',
            isInternal: false,
            vaFeeExempt: false,
            vaFeePolicyVersion: 0,
          }),
          updateMany: async () => {
            updates += 1;
            return { count: 1 };
          },
        },
        vaFeePolicyEvent: {
          create: async () => {
            audits += 1;
          },
        },
        $queryRaw: async (query) => {
          const sql = query.text.replace(/\$(\d+)/g, (_, index) =>
            quote(query.values[Number(index) - 1])
          );
          const setup = `CREATE TEMP TABLE customers(id text, tenant_id text, created_by text, activated_by text);
          CREATE TEMP TABLE customer_auth_audit_events(customer_id text,event_type text,actor text);
          INSERT INTO customers VALUES ('customer_test',${quote(tenant)},${quote(
            createdBy
          )},'admin_test');
          INSERT INTO customer_auth_audit_events VALUES ('customer_test',${quote(event)},${quote(
            actor
          )});`;
          const output = execFileSync(
            process.env.PSQL_BIN || 'psql',
            [url, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', setup + sql],
            { encoding: 'utf8' }
          );
          return output.trim() ? [{ id: output.trim() }] : [];
        },
      };
      const service = new CustomersService({ $transaction: async (callback) => callback(tx) });
      const action = () =>
        service.updateVaFeePolicy(
          'customer_test',
          'identity',
          { enabled: true, expectedVersion: 0, reason: 'Confirmed employee' },
          { userId: 'admin_test' }
        );
      if (allowed)
        assert.deepEqual(await action(), { isInternal: true, vaFeeExempt: false, version: 1 });
      else await assert.rejects(action, /admin_created_customer_required/);
      assert.equal(updates, allowed ? 1 : 0);
      assert.equal(audits, allowed ? 1 : 0);
    }
  }
);
