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
