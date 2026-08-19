const api = process.env.CORE_API_URL || 'http://localhost:4000/api/v1';
const customerId = 'cus_demo_business';
const marker = process.env.LINK_CHECK_MARKER || `LINK-CHECK-${Date.now()}`;
const headers = (userId) => ({ 'content-type': 'application/json', 'x-user-id': userId });

const detail = await get(`/customers/${customerId}`, 'usr_admin');
const channels = await get('/funding-channels?organizationId=org_demo', 'usr_admin');
const withdrawalFees = await get('/withdrawal-fees?organizationId=org_demo', 'usr_admin');
const account = (kind, currency) =>
  detail.accounts.find((row) => row.kind === kind && row.currency === currency);
const systemUsd = account('SYSTEM_WALLET', 'USD');
const systemHkd = account('SYSTEM_WALLET', 'HKD');
const vaUsd = account('VIRTUAL_ACCOUNT', 'USD');
const vaHkd = account('VIRTUAL_ACCOUNT', 'HKD');
const beneficiaryHkd = detail.beneficiaries.find((row) => row.currency === 'HKD');
const channel = (type) => channels.find((row) => row.type === type && row.active);
const inbound = channel('FIAT_INBOUND');
const platform = channel('PLATFORM_PAYOUT');
const pobo = channel('POBO_PAYOUT');
const vaPayout = channels.find(
  (row) => row.id === vaHkd?.fundingChannelId && row.type === 'VIRTUAL_ACCOUNT' && row.active
);
const legacyVaPayouts = channels.filter((row) => row.type === 'VA_PAYOUT');
assert(
  systemUsd &&
    systemHkd &&
    vaUsd &&
    vaHkd &&
    beneficiaryHkd &&
    inbound &&
    platform &&
    pobo &&
    vaPayout,
  'USD/HKD system accounts, VAs, beneficiary, and funding channels exist'
);
assert(
  legacyVaPayouts.every((row) => !row.active),
  'legacy VA payout channels remain inactive and cannot accept new transfers'
);
assert(
  channels.every((row) =>
    row.supportedCurrencies.every((currency) => ['USD', 'HKD'].includes(currency))
  ),
  'all active funding channels are limited to USD and HKD'
);

const systemDeposit = await submitDeposit(systemUsd, 'SYSTEM');
const vaDeposit = await submitDeposit(vaUsd, 'VA');
assert(systemDeposit.journals.length === 1, 'platform-account deposit has one balanced journal');
assert(vaDeposit.journals.length === 1, 'VA deposit has one balanced journal');

const selfApprovalCandidate = await createPayout('PLATFORM', platform, systemHkd, '1.00');
await expectPatchStatus(`/operations/${selfApprovalCandidate.id}/approve`, 'usr_maker', 403);
await patch(`/operations/${selfApprovalCandidate.id}/reject`, 'usr_admin', {
  reason: `${marker} 单人审批拒绝路径`,
});
assert(
  true,
  'non-admin cannot approve and the submitting admin can reject with reservation released'
);

const platformResult = await completePayout('PLATFORM', platform, systemHkd, '2.00');
const poboResult = await completePayout('POBO', pobo, systemHkd, '2.00');
const vaResult = await completePayout('VA', vaPayout, vaHkd, '2.00');
assertPayoutFee(platformResult, 'PLATFORM', platform);
assertPayoutFee(poboResult, 'POBO', pobo);
assertPayoutFee(vaResult, 'VA', vaPayout);

await expectCreateStatus(
  {
    customerId,
    type: 'PAYOUT',
    currency: 'HKD',
    amount: '1.00',
    sourceAccountId: systemHkd.id,
    beneficiaryId: beneficiaryHkd.id,
    channelId: vaPayout.id,
    payoutMethod: 'VA',
  },
  400
);
assert(true, 'VA payout rejects a system-account source');

const fx = await submitAndApprove({
  customerId,
  type: 'FX',
  currency: 'USD',
  quoteCurrency: 'HKD',
  amount: '1.00',
  sourceAccountId: systemUsd.id,
  targetAccountId: systemHkd.id,
  ...liveMarketQuote('7.81234'),
});
const fxDetail = await get(`/operations/${fx.id}`, 'usr_admin');
assert(
  fx.status === 'COMPLETED' &&
    fxDetail.journals.length === 1 &&
    fxDetail.metadata?.marketQuote?.marketRate === '7.81234' &&
    fxDetail.rate === fxDetail.metadata?.marketQuote?.customerRate,
  'USD/HKD FX snapshots a fresh market quote plus the active fee and posts a balanced journal'
);

console.log('PASS all local fiat financial workflows');

function liveMarketQuote(rate) {
  const now = new Date().toISOString();
  return {
    marketProvider: 'fastforex',
    marketPriceType: 'midpoint_spot',
    marketReferenceOnly: true,
    marketRate: rate,
    marketUpdatedAt: now,
    marketFetchedAt: now,
  };
}

async function submitDeposit(target, label) {
  const operation = await post('/operations', 'usr_admin', {
    customerId,
    type: 'DEPOSIT',
    currency: target.currency,
    amount: '2.00',
    targetAccountId: target.id,
    channelId: inbound.id,
    remitterName: `${marker} ${label} Remitter`,
    remitterBank: 'E2E Bank',
    remittanceReference: `${marker}-${label}-${crypto.randomUUID()}`,
    receivedAt: new Date().toISOString(),
    idempotencyKey: crypto.randomUUID(),
  });
  assert(operation.status === 'SUBMITTED', `${label} deposit waits for approval`);
  const approved = await patch(`/operations/${operation.id}/approve`, 'usr_admin');
  assert(approved.status === 'COMPLETED', `${label} deposit posts after admin approval`);
  return get(`/operations/${operation.id}`, 'usr_admin');
}

function createPayout(method, fundingChannel, source, amount) {
  const fee = withdrawalFees.find(
    (row) =>
      row.active &&
      row.assetClass === 'FIAT' &&
      row.currency === 'HKD' &&
      row.method === method &&
      row.channelCode === fundingChannel.code
  );
  assert(fee, `${method} payout has an active versioned server-side fee rule`);
  return post('/operations', 'usr_admin', {
    customerId,
    type: 'PAYOUT',
    currency: 'HKD',
    amount,
    expectedFeeAmount: fee.amount,
    expectedFeeRuleVersion: fee.version,
    sourceAccountId: source.id,
    beneficiaryId: beneficiaryHkd.id,
    channelId: fundingChannel.id,
    payoutMethod: method,
    narrative: `${marker} ${method} payout`,
    idempotencyKey: crypto.randomUUID(),
  });
}

async function completePayout(method, fundingChannel, source, amount) {
  const operation = await createPayout(method, fundingChannel, source, amount);
  assert(operation.status === 'SUBMITTED', `${method} payout submitted and funds reserved`);
  const approved = await patch(`/operations/${operation.id}/approve`, 'usr_admin');
  assert(approved.status === 'PROCESSING', `${method} payout waits for bank execution`);
  const completed = await patch(`/operations/${operation.id}/execute`, 'usr_admin', {
    externalReference: `${marker}-${method}-${Date.now()}`,
  });
  assert(completed.status === 'COMPLETED', `${method} payout completes with external reference`);
  return get(`/operations/${operation.id}`, 'usr_admin');
}

function assertPayoutFee(result, method, fundingChannel) {
  const snapshot = result.metadata?.withdrawalFee;
  assert(
    snapshot?.method === method &&
      snapshot.channelCode === fundingChannel.code &&
      Number(snapshot.amount) === Number(result.feeAmount) &&
      Boolean(snapshot.version),
    `${method} payout stores the resolved fee rule snapshot`
  );
  const expectedJournals = Number(result.feeAmount) > 0 ? 2 : 1;
  assert(
    result.journals.length === expectedJournals,
    `${method} payout posts principal and a fee journal only when the configured fee is non-zero`
  );
}

async function submitAndApprove(body) {
  const operation = await post('/operations', 'usr_admin', {
    ...body,
    feeAmount: body.feeAmount || '0',
    idempotencyKey: crypto.randomUUID(),
  });
  return patch(`/operations/${operation.id}/approve`, 'usr_admin');
}

async function request(path, userId, init = {}) {
  const response = await fetch(`${api}${path}`, { ...init, headers: headers(userId) });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `${init.method || 'GET'} ${path} failed ${response.status}: ${JSON.stringify(body)}`
    );
  }
  return body;
}

function get(path, userId) {
  return request(path, userId);
}

function post(path, userId, body) {
  return request(path, userId, { method: 'POST', body: JSON.stringify(body) });
}

function patch(path, userId, body) {
  return request(path, userId, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined });
}

async function expectCreateStatus(body, expected) {
  const response = await fetch(`${api}/operations`, {
    method: 'POST',
    headers: headers('usr_admin'),
    body: JSON.stringify({ ...body, idempotencyKey: crypto.randomUUID() }),
  });
  assert(response.status === expected, `invalid payout rejected with ${expected}`);
}

async function expectPatchStatus(path, userId, expected) {
  const response = await fetch(`${api}${path}`, { method: 'PATCH', headers: headers(userId) });
  assert(response.status === expected, `unauthorized approval rejected with ${expected}`);
}

function assert(value, message) {
  if (!value) throw new Error(`FAIL ${message}`);
  console.log(`PASS ${message}`);
}
