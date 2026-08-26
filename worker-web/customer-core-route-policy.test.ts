import assert from 'node:assert/strict';
import test from 'node:test';
import { customerCoreRouteAllowed } from './customer-core-route-policy';

const customerId = 'customer_test';
const organizationId = 'org_test';

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
