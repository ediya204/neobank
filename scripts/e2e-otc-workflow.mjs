const baseUrl = process.env.CORE_API_URL || 'http://localhost:4000/api/v1';
const customerId = 'cus_demo_business';
const marker = process.env.LINK_CHECK_MARKER || `LINK-CHECK-${Date.now()}`;
const customerHeaders = {
  'x-authenticated-role': 'customer',
  'x-authenticated-customer-id': customerId,
  'x-authenticated-email': 'customer@example.com',
};

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL ${message}`);
  console.log(`PASS ${message}`);
}

function amountsEqual(actual, expected) {
  return Math.abs(Number(actual) - Number(expected)) < 1e-8;
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
  (row) => row.kind === 'SYSTEM_WALLET' && row.currency === 'USD'
);
const target = detail.accounts.find(
  (row) => row.kind === 'CRYPTO_WALLET' && row.currency === 'USDT' && row.network === 'TRON'
);
assert(source && target, 'OTC USD source and USDT/TRON target exist');

const walletBefore = (await request(`/crypto-wallets?customerId=${customerId}`, 'usr_admin'))[0];
assert(
  Number(walletBefore.availableBalance) === Number(target.availableBalance),
  'OTC target mirror starts synchronized'
);

const operationQuery = `/operations?organizationId=${detail.organizationId}&customerId=${customerId}`;
const amount = '10';
const quote = await request('/operations/quote', 'usr_admin', {
  method: 'POST',
  headers: customerHeaders,
  body: JSON.stringify({
    customerId,
    type: 'OTC',
    currency: 'USD',
    quoteCurrency: 'USDT',
    amount,
    feeAmount: '0',
    sourceAccountId: source.id,
    targetAccountId: target.id,
    idempotencyKey: crypto.randomUUID(),
    narrative: `${marker} confirmed OTC`,
    ...liveMarketQuote('1.001'),
  }),
});
assert(quote.status === 'DRAFT', 'OTC quote is draft before customer confirmation');
assert(quote.quoteConfirmWindowMs === 15_000, 'OTC quote has a fifteen-second confirmation window');
assert(Date.parse(quote.quoteExpiresAt) > Date.now(), 'OTC quote has a live deadline');

const detailQuoted = await request(`/customers/${customerId}`, 'usr_admin');
const quotedSource = detailQuoted.accounts.find((row) => row.id === source.id);
const quotedTarget = detailQuoted.accounts.find((row) => row.id === target.id);
assert(
  Number(quotedSource.availableBalance) === Number(source.availableBalance) &&
    Number(quotedSource.frozenBalance) === Number(source.frozenBalance),
  'unconfirmed quote does not reserve the source balance'
);
assert(
  Number(quotedTarget.availableBalance) === Number(target.availableBalance),
  'unconfirmed quote does not credit the target balance'
);

const completed = await request(`/operations/${quote.id}/confirm`, 'usr_admin', {
  method: 'POST',
  headers: customerHeaders,
  body: JSON.stringify({}),
});
assert(completed.status === 'COMPLETED', 'customer confirmation completes OTC immediately');
assert(!completed.approvedAt && !completed.checkerId, 'completed OTC has no approval step');

const detailAfter = await request(`/customers/${customerId}`, 'usr_admin');
const sourceAfter = detailAfter.accounts.find((row) => row.id === source.id);
const targetAfter = detailAfter.accounts.find((row) => row.id === target.id);
const walletAfter = (await request(`/crypto-wallets?customerId=${customerId}`, 'usr_admin'))[0];
const operationsAfter = await request(operationQuery, 'usr_admin');
assert(
  Number(sourceAfter.availableBalance) === Number(source.availableBalance) - Number(amount) &&
    Number(sourceAfter.frozenBalance) === Number(source.frozenBalance),
  'confirmed OTC atomically consumes the USD source amount'
);
assert(
  amountsEqual(
    targetAfter.availableBalance,
    Number(target.availableBalance) + Number(completed.quoteAmount)
  ),
  'confirmed OTC credits the quoted USDT amount'
);
assert(
  Number(walletAfter.availableBalance) === Number(targetAfter.availableBalance),
  'confirmed OTC keeps the USDT accounting mirror synchronized'
);
assert(
  operationsAfter.filter((row) => row.id === completed.id && row.status === 'COMPLETED').length ===
    1,
  'confirmed OTC appears once in operation history'
);

const expiringQuote = await request('/operations/quote', 'usr_admin', {
  method: 'POST',
  headers: customerHeaders,
  body: JSON.stringify({
    customerId,
    type: 'OTC',
    currency: 'USD',
    quoteCurrency: 'USDT',
    amount: '1',
    feeAmount: '0',
    sourceAccountId: source.id,
    targetAccountId: target.id,
    idempotencyKey: crypto.randomUUID(),
    narrative: `${marker} expired OTC`,
    ...liveMarketQuote('1.001'),
  }),
});
const balanceBeforeExpiry = await request(`/customers/${customerId}`, 'usr_admin');
await new Promise((resolve) =>
  setTimeout(resolve, Math.max(0, Date.parse(expiringQuote.quoteExpiresAt) - Date.now()) + 100)
);
const expiredResponse = await fetch(`${baseUrl}/operations/${expiringQuote.id}/confirm`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-user-id': 'usr_admin', ...customerHeaders },
  body: JSON.stringify({}),
});
const expiredBody = await expiredResponse.json().catch(() => null);
assert(
  expiredResponse.status === 409 && expiredBody?.message === 'quote_expired',
  'OTC confirmation is rejected after the fifteen-second deadline'
);
const balanceAfterExpiry = await request(`/customers/${customerId}`, 'usr_admin');
for (const accountId of [source.id, target.id]) {
  const before = balanceBeforeExpiry.accounts.find((row) => row.id === accountId);
  const after = balanceAfterExpiry.accounts.find((row) => row.id === accountId);
  assert(
    before.availableBalance === after.availableBalance &&
      before.frozenBalance === after.frozenBalance,
    `expired OTC leaves ${accountId === source.id ? 'source' : 'target'} balance unchanged`
  );
}

console.log('PASS all local OTC quote-confirmation checks');

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
