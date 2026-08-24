import assert from 'node:assert/strict';
import test from 'node:test';
import { UsdtInboundService } from '../dist/src/usdt-inbound/usdt-inbound.service.js';

const admin = { id: 'admin_test', active: true, organizationId: 'org_test', role: 'ADMIN' };

function row(overrides = {}) {
  return {
    id: 'deposit_test',
    source: 'ON_CHAIN',
    customer_id: 'customer_test',
    customer_name: '测试客户',
    status: 'COMPLETED',
    amount: '25.50000000',
    asset: 'USDT',
    network: 'TRON',
    occurred_at: '2026-08-24T08:00:00.000Z',
    completed_at: '2026-08-24T08:00:01.000Z',
    reference: 'cregis_cid_test',
    tx_hash: 'tx_test',
    from_address: 'from_test',
    to_address: 'to_test',
    source_currency: null,
    source_amount: null,
    rate: null,
    custody_status: 'completed',
    accounting_status: 'posted',
    exception_reason: null,
    core_operation_id: 'operation_test',
    total_count: 2n,
    chain_count: 1n,
    otc_count: 1n,
    completed_count: 2n,
    processing_count: 0n,
    attention_count: 0n,
    ...overrides,
  };
}

test('USDT inbound maps chain and local OTC records into one tenant-scoped response', async () => {
  let query;
  let queryCount = 0;
  const service = new UsdtInboundService({
    user: { findUnique: async () => admin },
    $queryRaw: async (value) => {
      queryCount += 1;
      if (queryCount === 1) return [{ available: true }];
      query = value;
      return [
        row(),
        row({
          id: 'otc_test',
          source: 'LOCAL_OTC',
          reference: 'OP-OTC-TEST',
          tx_hash: null,
          source_currency: 'USD',
          source_amount: '25.6',
          rate: '0.99609375',
          custody_status: null,
        }),
      ];
    },
  });

  const result = await service.list(
    { organizationId: 'org_test', source: 'ON_CHAIN', status: 'COMPLETED', search: 'tx_test' },
    admin.id
  );

  assert.equal(result.pagination.total, 2);
  assert.deepEqual(result.summary, {
    chain: 1,
    localOtc: 1,
    completed: 2,
    processing: 0,
    attention: 0,
  });
  assert.equal(result.data[0].customerName, '测试客户');
  assert.equal(result.data[0].txHash, 'tx_test');
  assert.equal(result.data[1].sourceCurrency, 'USD');
  assert.equal(result.data[1].sourceAmount, '25.6');
  assert.ok(query.strings.join(' ').includes('cregis_deposits'));
  assert.ok(query.strings.join(' ').includes('operation."quoteCurrency"'));
  assert.ok(query.strings.join(' ').includes("operation.status<>'DRAFT'"));
});

test('USDT inbound uses Core crypto deposits when local PostgreSQL has no custody tables', async () => {
  let query;
  let queryCount = 0;
  const service = new UsdtInboundService({
    user: { findUnique: async () => admin },
    $queryRaw: async (value) => {
      queryCount += 1;
      if (queryCount === 1) return [{ available: false }];
      query = value;
      return [];
    },
  });

  const result = await service.list({ organizationId: 'org_test' }, admin.id);
  assert.equal(result.pagination.total, 0);
  assert.ok(query.strings.join(' ').includes('FROM "CryptoTransfer" transfer'));
  assert.ok(query.strings.join(' ').includes("transfer.direction='DEPOSIT'"));
});

test('USDT inbound rejects invalid filters before querying financial records', async () => {
  const service = new UsdtInboundService({});
  await assert.rejects(
    service.list({ organizationId: 'org_test', source: 'MANUAL' }, admin.id),
    /invalid_usdt_inbound_source/
  );
  await assert.rejects(
    service.list({ organizationId: 'org_test', limit: 101 }, admin.id),
    /invalid_usdt_inbound_limit/
  );
  await assert.rejects(
    service.list({ organizationId: 'org_test', offset: -1 }, admin.id),
    /invalid_usdt_inbound_offset/
  );
});

test('USDT inbound rejects cross-tenant admin access', async () => {
  const service = new UsdtInboundService({
    user: { findUnique: async () => admin },
  });
  await assert.rejects(
    service.list({ organizationId: 'org_other' }, admin.id),
    /cross_tenant_organization/
  );
});
