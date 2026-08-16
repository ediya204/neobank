import assert from 'node:assert/strict';
import { test } from 'node:test';
import { edgeSignature, verifyEdgeSignature } from '../dist/src/security/edge-auth.js';

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
