import assert from 'node:assert/strict';
import test from 'node:test';
import { marketSourceTimestampsAreFresh } from '../dist/src/rates/market-rate-freshness.js';

test('market source freshness rejects an old provider timestamp even after a fresh fetch', () => {
  const now = Date.parse('2026-08-21T08:00:00Z');
  assert.equal(
    marketSourceTimestampsAreFresh('2026-08-21T07:59:30Z', '2026-08-21T06:00:00Z', now),
    false
  );
});

test('market source freshness accepts recent provider and fetch timestamps', () => {
  const now = Date.parse('2026-08-21T08:00:00Z');
  assert.equal(
    marketSourceTimestampsAreFresh('2026-08-21T07:59:30Z', '2026-08-21T07:58:00Z', now),
    true
  );
});
