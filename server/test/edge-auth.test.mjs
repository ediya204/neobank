import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  edgeAuthMiddleware,
  edgeSignature,
  verifyEdgeSignature,
} from '../dist/src/security/edge-auth.js';

const secret = 'core-edge-secret-0123456789-abcdef';
const now = 1_786_850_000;

function signed(overrides = {}) {
  const { nowSeconds = now, ...requestOverrides } = overrides;
  const input = {
    body: Buffer.from('{"amount":"10"}'),
    identity: 'edi@example.com',
    method: 'POST',
    requestTarget: '/api/v1/operations?organizationId=org_neobank',
    secret,
    timestamp: String(now),
    ...requestOverrides,
  };
  return { ...input, signature: edgeSignature(input), nowSeconds };
}

test('accepts an exact fresh Worker signature', () => {
  assert.equal(verifyEdgeSignature(signed()), true);
});

test('rejects replayed, modified, or malformed requests', () => {
  assert.equal(verifyEdgeSignature(signed({ nowSeconds: now + 61 })), false);
  assert.equal(verifyEdgeSignature({ ...signed(), requestTarget: '/api/v1/customers' }), false);
  assert.equal(verifyEdgeSignature({ ...signed(), identity: 'other@example.com' }), false);
  assert.equal(verifyEdgeSignature({ ...signed(), signature: 'invalid' }), false);
});

test('authenticates canonical JSON when the reverse proxy leaves rawBody empty', () => {
  const body = { amount: '10', currency: 'USD' };
  const signedRequest = signed({
    body: Buffer.from(JSON.stringify(body)),
    requestTarget: '/api/v1/operations',
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
  const headers = {
    'x-neobank-user': signedRequest.identity,
    'x-core-edge-timestamp': signedRequest.timestamp,
    'x-core-edge-signature': signedRequest.signature,
  };
  const request = {
    body,
    headers,
    method: 'POST',
    originalUrl: signedRequest.requestTarget,
    rawBody: Buffer.alloc(0),
    header(name) {
      return this.headers[name.toLowerCase()];
    },
  };
  let nextCalled = false;
  const response = {
    status() {
      assert.fail('canonical JSON signature should be accepted');
    },
  };

  edgeAuthMiddleware({ adminUserId: 'admin-1', secret })(request, response, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(request.headers['x-user-id'], 'admin-1');
  assert.equal(request.headers['x-authenticated-role'], 'admin');
});

test('authenticates canonical JSON when the reverse proxy preserves different formatting', () => {
  const body = { amount: '10', currency: 'USD' };
  const signedRequest = signed({
    body: Buffer.from(JSON.stringify(body)),
    requestTarget: '/api/v1/operations',
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
  const request = {
    body,
    headers: {
      'x-neobank-user': signedRequest.identity,
      'x-core-edge-timestamp': signedRequest.timestamp,
      'x-core-edge-signature': signedRequest.signature,
    },
    method: 'POST',
    originalUrl: signedRequest.requestTarget,
    rawBody: Buffer.from('{ "amount": "10", "currency": "USD" }'),
    header(name) {
      return this.headers[name.toLowerCase()];
    },
  };
  let nextCalled = false;
  const response = {
    status() {
      assert.fail('canonical JSON signature should be accepted');
    },
  };

  edgeAuthMiddleware({ adminUserId: 'admin-1', secret })(request, response, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test('propagates the signed administrator Core identity instead of the shared fallback', () => {
  const identity = 'admin:usr_backoffice:backoffice@sscdigitalbank.com';
  const signedRequest = signed({
    identity,
    requestTarget: '/api/v1/customers',
    method: 'GET',
    body: Buffer.alloc(0),
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
  const request = {
    body: undefined,
    headers: {
      'x-neobank-user': identity,
      'x-core-edge-timestamp': signedRequest.timestamp,
      'x-core-edge-signature': signedRequest.signature,
    },
    method: 'GET',
    originalUrl: '/api/v1/customers',
    rawBody: Buffer.alloc(0),
    header(name) {
      return this.headers[name.toLowerCase()];
    },
  };
  let nextCalled = false;
  const response = {
    status() {
      assert.fail('the signed administrator identity should be accepted');
    },
  };

  edgeAuthMiddleware({ adminUserId: 'shared-admin', secret })(request, response, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(request.headers['x-user-id'], 'usr_backoffice');
  assert.equal(request.headers['x-authenticated-email'], 'backoffice@sscdigitalbank.com');
  assert.equal(request.headers['x-authenticated-role'], 'admin');
});

test('accepts the previous admin email identity during the staged rollout', () => {
  const identity = 'admin:legacy-admin@sscdigitalbank.com';
  const signedRequest = signed({
    identity,
    requestTarget: '/api/v1/customers',
    method: 'GET',
    body: Buffer.alloc(0),
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
  const request = {
    body: undefined,
    headers: {
      'x-neobank-user': identity,
      'x-core-edge-timestamp': signedRequest.timestamp,
      'x-core-edge-signature': signedRequest.signature,
    },
    method: 'GET',
    originalUrl: '/api/v1/customers',
    rawBody: Buffer.alloc(0),
    header(name) {
      return this.headers[name.toLowerCase()];
    },
  };
  let nextCalled = false;
  const response = {
    status() {
      assert.fail('the legacy signed administrator identity should be accepted');
    },
  };

  edgeAuthMiddleware({ adminUserId: 'shared-admin', secret })(request, response, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(request.headers['x-user-id'], 'shared-admin');
  assert.equal(request.headers['x-authenticated-email'], 'legacy-admin@sscdigitalbank.com');
  assert.equal(request.headers['x-authenticated-role'], 'admin');
});

test('internal Cregis accounting requires the dedicated secret and service identity', () => {
  const accountingSecret = 'accounting-secret-0123456789-abcdef';
  const requestTarget = '/api/v1/internal/cregis/withdrawals/withdrawal_test/release';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const input = {
    body: Buffer.alloc(0),
    identity: 'service:neobank-go',
    method: 'POST',
    requestTarget,
    secret: accountingSecret,
    timestamp,
  };
  const request = {
    body: undefined,
    headers: {
      'x-neobank-user': input.identity,
      'x-core-edge-timestamp': timestamp,
      'x-core-edge-signature': edgeSignature(input),
    },
    method: 'POST',
    originalUrl: requestTarget,
    rawBody: Buffer.alloc(0),
    header(name) {
      return this.headers[name.toLowerCase()];
    },
  };
  let nextCalled = false;
  const response = {
    status() {
      assert.fail('dedicated accounting signature should be accepted');
    },
  };
  edgeAuthMiddleware({ adminUserId: 'shared-admin', secret, accountingSecret })(
    request,
    response,
    () => {
      nextCalled = true;
    }
  );
  assert.equal(nextCalled, true);
  assert.equal(request.headers['x-user-id'], 'shared-admin');
});

test('internal Cregis accounting rejects an empty dedicated secret even with a matching HMAC', () => {
  const requestTarget = '/api/v1/internal/cregis/deposits/deposit_test/post';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const input = {
    body: Buffer.alloc(0),
    identity: 'service:neobank-go',
    method: 'POST',
    requestTarget,
    secret: '',
    timestamp,
  };
  const request = {
    body: undefined,
    headers: {
      'x-neobank-user': input.identity,
      'x-core-edge-timestamp': timestamp,
      'x-core-edge-signature': edgeSignature(input),
    },
    method: 'POST',
    originalUrl: requestTarget,
    rawBody: Buffer.alloc(0),
    header(name) {
      return this.headers[name.toLowerCase()];
    },
  };
  let status;
  const response = {
    status(value) {
      status = value;
      return this;
    },
    json() {},
  };
  edgeAuthMiddleware({ adminUserId: 'shared-admin', secret })(request, response, () => {
    assert.fail('missing dedicated secret must never authenticate');
  });
  assert.equal(status, 401);
});
