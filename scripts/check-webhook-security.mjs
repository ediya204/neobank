import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wranglerConfig = JSON.parse(
  await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
);
const compatibilityFlags = wranglerConfig.compatibility_flags;
const workerSource = await readFile(new URL('../worker/index.ts', import.meta.url), 'utf8');
const managedSecretMigration = await readFile(
  new URL('../migrations/0025_managed_webhook_signing_keys.sql', import.meta.url),
  'utf8'
);
const applicationReviewMigration = await readFile(
  new URL('../migrations/0026_va_application_changes_requested.sql', import.meta.url),
  'utf8'
);
const localWebhookDemo = await readFile(
  new URL('./local-webhook-demo.sql', import.meta.url),
  'utf8'
);
const partnerIntegrationSource = await readFile(
  new URL('../src/pages/partner-api-integration.tsx', import.meta.url),
  'utf8'
);
const adminIntegrationSource = await readFile(
  new URL('../src/pages/dashboard/api-integration.tsx', import.meta.url),
  'utf8'
);

assert.ok(Array.isArray(compatibilityFlags), 'wrangler.jsonc must declare compatibility_flags');
assert.ok(
  compatibilityFlags.includes('global_fetch_strictly_public'),
  'Webhook delivery must route global fetch() through the public Internet boundary'
);
assert.ok(
  !compatibilityFlags.includes('global_fetch_private_origin'),
  'global_fetch_private_origin would allow same-zone origin bypasses'
);

const customOutboxStart = workerSource.indexOf('function customWebhookOutboxStatement(');
const customOutboxEnd = workerSource.indexOf(
  '\nasync function createWebhookTest',
  customOutboxStart
);
assert.ok(customOutboxStart >= 0 && customOutboxEnd > customOutboxStart);
const customOutboxSource = workerSource.slice(customOutboxStart, customOutboxEnd);
assert.match(
  customOutboxSource,
  /env: Env,\s*partnerKey: string,/,
  'Custom webhook delivery must require the owning Partner key'
);
assert.doesNotMatch(
  customOutboxSource,
  /\.bind\([\s\S]*?PARTNER_KEY/,
  'Custom webhook delivery must not replace resource ownership with the default tenant'
);
assert.match(
  workerSource,
  /customWebhookOutboxStatement\(\s*env,\s*ownership\.partner_key,\s*'usdt_sweep\.locked'/,
  'Locked sweep events must use the batch owner'
);
assert.match(
  workerSource,
  /customWebhookOutboxStatement\(\s*env,\s*batch\.partner_key,\s*'usdt_sweep\.completed'/,
  'Completed sweep events must use the batch owner'
);

assert.match(
  managedSecretMigration,
  /CREATE TABLE IF NOT EXISTS partner_webhook_signing_keys/,
  'Managed Webhook signing keys must have a dedicated lifecycle table'
);
assert.match(
  managedSecretMigration,
  /CHECK \(status IN \('available', 'active', 'retiring', 'revoked'\)\)/,
  'Managed Webhook signing keys must preserve explicit lifecycle states'
);
assert.match(
  workerSource,
  /async function revealWebhookSigningSecret/,
  'Webhook signing secrets must support TOTP-gated one-time reveal'
);
assert.match(
  workerSource,
  /async function activateWebhookSigningKey/,
  'Webhook signing keys must require an explicit activation step'
);
assert.match(
  workerSource,
  /'X-VA-Webhook-Key-Id': row\.signing_secret_version/,
  'Webhook delivery must identify the signing key without exposing it'
);
assert.match(
  workerSource,
  /getWebhookSigningSecret\(env, row\.signing_secret_version\)/,
  'Webhook delivery must resolve the key captured by the outbox record'
);
assert.match(
  workerSource,
  /webhook_signing_key_activation_blocked/,
  'Key activation must block while the previous key has unfinished deliveries'
);
assert.match(
  workerSource,
  /'application\.status_changed',[\s\S]*?nextStatus,[\s\S]*?\{[\s\S]*?status: nextStatus,[\s\S]*?\},\s*\{[\s\S]*?kyc_url: kycUrl,[\s\S]*?action_required: null/,
  'KYC-link-ready Webhooks must carry the validated Sumsub URL'
);
assert.match(
  workerSource,
  /'fiat_deposit\.cleared_and_converted',[\s\S]*?eventData,[\s\S]*?table: 'fund_transactions'/,
  'Fiat clearing must atomically queue the detailed conversion Webhook'
);
assert.match(
  workerSource,
  /const eventData = \{[\s\S]*?status: 'completed',[\s\S]*?transaction_type: 'fiat_deposit',[\s\S]*?fiat_amount:[\s\S]*?exchange_rate:[\s\S]*?usdt_net_amount:[\s\S]*?otc_order_id:[\s\S]*?otc_status: 'completed'/,
  'Fiat clearing Webhooks must include the complete customer-visible settlement result'
);
const fiatClearingEventData = workerSource.match(
  /const eventData = \{([\s\S]*?)\n  \};\n  try \{/
)?.[1];
assert(fiatClearingEventData, 'Fiat clearing Webhook event data must be defined');
assert.doesNotMatch(
  fiatClearingEventData,
  /\b(?:pricing_model|fee_rate|fee_amount):/,
  'Fiat clearing Webhooks must not expose internal net-rate or zero-fee pricing fields'
);
assert.match(
  partnerIntegrationSource,
  /value: 'fiat_deposit\.cleared_and_converted',[\s\S]*?label: '法币入账已清算并兑换'/,
  'Partner Portal must expose the fiat clearing event subscription'
);
for (const [eventType, label] of [
  ['usdt_sweep.locked', 'USDT 归集已锁定'],
  ['usdt_sweep.completed', 'USDT 归集已完成'],
  ['usdt_sweep.cancelled', 'USDT 归集已取消'],
]) {
  assert.match(
    partnerIntegrationSource,
    new RegExp(`value: '${eventType.replaceAll('.', '\\.')}',[\\s\\S]*?label: '${label}'`),
    `Partner Portal must expose the ${eventType} subscription`
  );
  assert.match(
    localWebhookDemo,
    new RegExp(`events_json = '[^']*${eventType.replaceAll('.', '\\.')}`),
    `Local Webhook configuration must subscribe to ${eventType}`
  );
}
assert.match(
  workerSource,
  /function fundTransactionWebhookData\([\s\S]*?transaction_type: snapshot\.type,[\s\S]*?amount: minorToAmount\([\s\S]*?settlement_status: snapshot\.settlement_status/,
  'Fund transaction Webhooks must use decimal customer-visible transaction snapshots'
);
assert.match(
  workerSource,
  /'fund_transaction\.status_changed',[\s\S]*?'submitted',[\s\S]*?fundTransactionWebhookData\(\{[\s\S]*?amount_minor: amountMinor,[\s\S]*?settlement_status: 'pending'/,
  'Newly recorded deposits must queue amount details without claiming settlement'
);
assert.match(
  workerSource,
  /'va_account\.activated',[\s\S]*?\{[\s\S]*?table: 'va_applications',[\s\S]*?\},\s*\{[\s\S]*?va_account: normalizedAccount,[\s\S]*?action_required: null/,
  'VA activation Webhooks must carry the normalized account snapshot'
);
assert.match(
  applicationReviewMigration,
  /CREATE UNIQUE INDEX IF NOT EXISTS idx_va_application_reviews_open[\s\S]*?WHERE resolved_at IS NULL/,
  'An application must have at most one unresolved changes-requested review'
);
assert.match(
  workerSource,
  /'application\.status_changed',[\s\S]*?'changes_requested',[\s\S]*?action_required: publicActionRequired/,
  'Changes-requested Webhooks must include the customer-visible correction action'
);
const actionRequiredStart = workerSource.indexOf('function applicationActionRequiredData(');
const actionRequiredEnd = workerSource.indexOf('\nfunction isRecord(', actionRequiredStart);
assert.ok(actionRequiredStart >= 0 && actionRequiredEnd > actionRequiredStart);
assert.doesNotMatch(
  workerSource.slice(actionRequiredStart, actionRequiredEnd),
  /internal_note|reviewed_by/,
  'Partner Webhook snapshots must not expose internal review notes or reviewer identity'
);
assert.match(
  workerSource,
  /async function resubmitApplication\([\s\S]*?resolveIdempotencyKey\(request, true\)[\s\S]*?requestFingerprint\(normalizedRequest\)/,
  'Application resubmission must require a stable idempotency key and request fingerprint'
);

const replayStart = workerSource.indexOf('async function createWebhookReplay(');
const replayEnd = workerSource.indexOf('\nasync function retryWebhookDelivery', replayStart);
assert.ok(
  replayStart >= 0 && replayEnd > replayStart,
  'Admin must support creating a fresh Webhook replay delivery'
);
const replaySource = workerSource.slice(replayStart, replayEnd);
assert.match(
  workerSource,
  /scopedPath === '\/api-integration\/webhook-replays'[\s\S]*?request\.method === 'POST' && scope === 'admin'/,
  'Webhook replay creation must remain Admin-only'
);
assert.match(
  replaySource,
  /source_delivery_id[\s\S]*?event_type[\s\S]*?resource_id[\s\S]*?reason/,
  'Webhook replay must support both historical-delivery and event/resource modes with a reason'
);
assert.match(
  replaySource,
  /evt_\$\{crypto\.randomUUID\(\)\.replaceAll\('-', ''\)\}/,
  'A replay must receive a fresh event ID so Partner deduplication accepts it'
);
assert.match(
  replaySource,
  /api_integration\.webhook_delivery_replayed/,
  'Webhook replay creation must leave a dedicated audit record'
);
assert.match(
  replaySource,
  /json_each\(s\.events_json\)[\s\S]*?value=\?/,
  'Webhook replay must require the event to be subscribed in the active configuration'
);
assert.doesNotMatch(
  replaySource,
  /\b(?:operator_note|reviewed_by|last_error|signing_secret)\b\s*:/,
  'Webhook replay payloads must not expose operator or delivery internals'
);
assert.match(
  adminIntegrationSource,
  /webhook-replays/,
  'Admin Portal must expose the general Webhook replay API'
);
assert.match(
  adminIntegrationSource,
  /source_delivery_id[\s\S]*?event_type[\s\S]*?resource_id/,
  'Admin Portal must expose both historical-delivery and event/resource replay modes'
);
assert.match(
  workerSource,
  /const normalizedAccount = \{[\s\S]*?iban: account\.iban\?\.trim\(\) \|\| null,[\s\S]*?swift_bic: account\.swift_bic\.trim\(\)\.toUpperCase\(\)/,
  'VA activation Webhooks and persisted accounts must share normalized values'
);
assert.match(
  localWebhookDemo,
  /"type":"application\.status_changed"[\s\S]*?"status":"kyc_link_ready"[\s\S]*?"kyc_url":"https:\/\/in\.sumsub\.com\//,
  'Local KYC-link-ready demo must show the Sumsub URL contract'
);
assert.match(
  localWebhookDemo,
  /"type":"fiat_deposit\.cleared_and_converted"[\s\S]*?"fiat_amount":"1000"[\s\S]*?"exchange_rate":"0\.995"[\s\S]*?"usdt_net_amount":"995"[\s\S]*?"otc_status":"completed"/,
  'Local fiat clearing demo must show the complete conversion result'
);
assert.match(
  localWebhookDemo,
  /"type":"fund_transaction\.status_changed"[\s\S]*?"transaction_type":"fiat_deposit"[\s\S]*?"amount":"1000"[\s\S]*?"settlement_status":"cleared"/,
  'Local fund transaction demo must show the amount snapshot contract'
);
assert.match(
  localWebhookDemo,
  /"type":"va_account\.activated"[\s\S]*?"va_account":\{"account_name":[\s\S]*?"account_number":/,
  'Local VA activation demo must show the account snapshot contract'
);

console.log('Webhook egress and tenant-routing policy checks passed.');
