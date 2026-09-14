import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
  customerCoreRouteAllowed,
  redactCustomerCorePayload,
} from './customer-core-route-policy.ts';

const customerId = 'customer_test';
const organizationId = 'org_test';

test('Admin waiver mutations retain their dedicated permissions with optional trailing slash and case variants', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const policy = source.slice(
    source.indexOf('const ADMIN_PERMISSIONS ='),
    source.indexOf('function isDisabledAdminCustomerLifecycleMutation')
  );
  const required = runInNewContext(ts.transpile(policy) + '\nrequiredAdminCorePermission;');
  for (const suffix of ['va-fee-policy', 'VA-FEE-POLICY', 'va-fee-policy/']) {
    assert.equal(required(`/api/core/customers/customer/${suffix}`, 'PATCH'), 'settings.manage');
  }
  for (const suffix of ['waive-opening-fee', 'WAIVE-OPENING-FEE', 'waive-opening-fee/']) {
    assert.equal(
      required(`/api/core/virtual-account-requests/request/${suffix}`, 'PATCH'),
      'funds.manage'
    );
  }
  assert.equal(
    required('/api/core/customers/customer/internal-identity', 'PATCH'),
    'customers.review'
  );
});

test('fee quotes are own-customer only and waiver administration is never customer-accessible', () => {
  assert.equal(
    allowed('/api/core/customers/customer_test/va-opening-fee-quote?channelId=bank'),
    true
  );
  assert.equal(
    allowed('/api/core/customers/customer_other/va-opening-fee-quote?channelId=bank'),
    false
  );
  assert.equal(
    allowed(
      '/api/core/customers/customer_test/va-opening-fee-quote?channelId=bank&isInternal=true'
    ),
    false
  );
  for (const route of [
    '/api/core/customers/customer_test/va-fee-policy',
    '/api/core/customers/customer_test/internal-identity',
    '/api/core/virtual-account-requests/request/waive-opening-fee',
  ]) {
    assert.equal(allowed(route, 'PATCH'), false);
    assert.equal(allowed(route), false);
  }
  assert.deepEqual(
    redactCustomerCorePayload(
      {
        isInternal: true,
        vaFeeExempt: true,
        openingFeeBasis: 'INTERNAL',
        openingFeeWaiverBasis: 'INTERNAL',
        openingFeeWaiverReason: 'private',
        openingFeeWaivedBy: 'admin',
        openingFeeEffectiveUsd: '0.00',
        openingFeeExempt: true,
      },
      customerId
    ),
    { openingFeeEffectiveUsd: '0.00', openingFeeExempt: true }
  );
});

function allowed(path: string, method = 'GET') {
  return customerCoreRouteAllowed(
    new URL(path, 'https://portal.example'),
    method,
    customerId,
    organizationId
  );
}

test('customer can read active payout channels for the current organization', () => {
  assert.equal(
    allowed('/api/core/funding-channels?organizationId=org_test&type=PLATFORM_PAYOUT&active=true'),
    true
  );
  assert.equal(
    allowed('/api/core/funding-channels?organizationId=org_test&type=POBO_PAYOUT&active=true'),
    true
  );
});

test('customer fee reads expose only active organization defaults', () => {
  assert.equal(allowed('/api/core/withdrawal-fees?organizationId=org_test&active=true'), true);
  assert.equal(allowed('/api/core/withdrawal-fees?organizationId=org_test'), false);
  assert.equal(allowed('/api/core/withdrawal-fees?organizationId=org_other&active=true'), false);
  assert.equal(
    allowed(
      '/api/core/withdrawal-fees?organizationId=org_test&active=true&customerId=customer_other'
    ),
    false
  );
  assert.equal(
    allowed('/api/core/withdrawal-fees?organizationId=org_test&active=true', 'PATCH'),
    false
  );
});

test('customer may cancel only an owned VA request through the exact route', () => {
  const path = '/api/core/customers/customer_test/virtual-account-requests/request_001/cancel';
  assert.equal(allowed(path, 'PATCH'), true);
  assert.equal(
    allowed(
      '/api/core/customers/customer_other/virtual-account-requests/request_001/cancel',
      'PATCH'
    ),
    false
  );
  assert.equal(allowed(`${path}/extra`, 'PATCH'), false);
  assert.equal(allowed(`${path}?force=true`, 'PATCH'), false);
  assert.equal(allowed(path, 'GET'), false);
  assert.equal(allowed(path, 'POST'), false);
});

test('customer VA fee records retain audit metadata but redact internal identities and accounts', () => {
  const result = redactCustomerCorePayload(
    {
      makerId: 'internal-maker',
      openingFeeUpdatedBy: 'internal-updater',
      metadata: {
        vaOpeningFee: {
          requestId: 'request_001',
          channelCode: 'VA-HK-01',
          bankName: 'Example Bank',
          version: '2',
          reservedAt: '2026-09-03T00:00:00.000Z',
          secret: 'hidden',
        },
        internalNote: 'hidden',
      },
      sourceAccount: { customerId, id: 'wallet_usd', kind: 'SYSTEM_WALLET', currency: 'USD' },
      targetAccount: {
        customerId: null,
        id: 'fee_revenue_usd',
        kind: 'FEE_REVENUE',
        currency: 'USD',
      },
    },
    customerId
  );

  assert.deepEqual(result, {
    metadata: {
      vaOpeningFee: {
        requestId: 'request_001',
        channelCode: 'VA-HK-01',
        bankName: 'Example Bank',
        version: '2',
        reservedAt: '2026-09-03T00:00:00.000Z',
      },
    },
    sourceAccount: { customerId, id: 'wallet_usd', kind: 'SYSTEM_WALLET', currency: 'USD' },
    targetAccount: { kind: 'FEE_REVENUE', currency: 'USD' },
  });
});
