const baseUrl = process.env.CORE_API_URL || 'http://localhost:4000/api/v1';
const customerId = 'cus_demo_business';
const marker = process.env.LINK_CHECK_MARKER || `LINK-CHECK-${Date.now()}`;

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL ${message}`);
  console.log(`PASS ${message}`);
}

async function request(path, userId, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-user-id': userId, ...init.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `${init.method || 'GET'} ${path} failed ${response.status}: ${JSON.stringify(body)}`
    );
  }
  return body;
}

const detail = await request(`/customers/${customerId}`, 'usr_admin');
const source = detail.accounts.find(
  (row) => row.kind === 'CRYPTO_WALLET' && row.currency === 'USDT' && row.network === 'TRON'
);
const systemUsd = detail.accounts.find(
  (row) => row.kind === 'SYSTEM_WALLET' && row.currency === 'USD'
);
const vaHkd = detail.accounts.find(
  (row) => row.kind === 'VIRTUAL_ACCOUNT' && row.currency === 'HKD'
);
assert(source && systemUsd && vaHkd, 'OTC source, system cash account, and VA target exist');

const walletBefore = (await request(`/crypto-wallets?customerId=${customerId}`, 'usr_admin'))[0];
assert(
  Number(walletBefore.availableBalance) === Number(source.availableBalance),
  'OTC source mirror starts synchronized'
);

const operationQuery = `/operations?organizationId=${detail.organizationId}&customerId=${customerId}`;
const operationsBefore = await request(operationQuery, 'usr_admin');
await expectManualOtcDisabled(systemUsd);
await expectManualOtcDisabled(vaHkd);

const detailAfter = await request(`/customers/${customerId}`, 'usr_admin');
const sourceAfter = detailAfter.accounts.find((row) => row.id === source.id);
const systemAfter = detailAfter.accounts.find((row) => row.id === systemUsd.id);
const vaAfter = detailAfter.accounts.find((row) => row.id === vaHkd.id);
const walletAfter = (await request(`/crypto-wallets?customerId=${customerId}`, 'usr_admin'))[0];
const operationsAfter = await request(operationQuery, 'usr_admin');

for (const [before, after, label] of [
  [source, sourceAfter, 'USDT accounting mirror'],
  [systemUsd, systemAfter, 'system cash account'],
  [vaHkd, vaAfter, 'VA account'],
  [walletBefore, walletAfter, 'USDT wallet'],
]) {
  assert(
    after &&
      Number(after.availableBalance) === Number(before.availableBalance) &&
      Number(after.frozenBalance) === Number(before.frozenBalance),
    `disabled manual OTC leaves ${label} unchanged`
  );
}
assert(
  operationsAfter.length === operationsBefore.length,
  'disabled manual OTC creates no operation or accounting record'
);

console.log('PASS all local OTC disablement guards');

async function expectManualOtcDisabled(target) {
  const response = await fetch(`${baseUrl}/operations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': 'usr_admin' },
    body: JSON.stringify({
      customerId,
      type: 'OTC',
      currency: 'USDT',
      quoteCurrency: target.currency,
      amount: '1',
      feeAmount: '0',
      sourceAccountId: source.id,
      targetAccountId: target.id,
      idempotencyKey: crypto.randomUUID(),
      narrative: `${marker} blocked OTC to ${target.kind}`,
      ...liveMarketQuote(target.currency === 'USD' ? '0.9992' : '7.805'),
    }),
  });
  const body = await response.json().catch(() => null);
  assert(response.status === 409, `manual OTC to ${target.kind} is rejected with 409`);
  assert(
    body?.message === 'usdt_otc_disabled_until_single_ledger',
    `manual OTC to ${target.kind} returns the explicit ledger gate`
  );
}

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
