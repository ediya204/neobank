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

const detail = await request(`/customers/${customerId}`, 'usr_maker');
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

const walletBefore = (await request(`/crypto-wallets?customerId=${customerId}`, 'usr_maker'))[0];
assert(
  Number(walletBefore.availableBalance) === Number(source.availableBalance),
  'OTC source mirror starts synchronized'
);

const systemBefore = Number(systemUsd.availableBalance);
const systemOperation = await submitAndApprove(systemUsd);
const detailAfterSystem = await request(`/customers/${customerId}`, 'usr_maker');
const sourceAfterSystem = detailAfterSystem.accounts.find((row) => row.id === source.id);
const systemAfter = detailAfterSystem.accounts.find((row) => row.id === systemUsd.id);
const walletAfterSystem = (
  await request(`/crypto-wallets?customerId=${customerId}`, 'usr_maker')
)[0];
assert(
  Number(sourceAfterSystem.availableBalance) === Number(source.availableBalance) - 1 &&
    Number(sourceAfterSystem.frozenBalance) === 0,
  'OTC to system account consumes USDT accounting mirror'
);
assert(
  Number(walletAfterSystem.availableBalance) === Number(walletBefore.availableBalance) - 1 &&
    Number(walletAfterSystem.frozenBalance) === 0,
  'OTC to system account consumes USDT wallet balance'
);
assert(
  Number(systemAfter.availableBalance) > systemBefore,
  'OTC proceeds credit system cash account'
);
const systemOperationDetail = await request(`/operations/${systemOperation.id}`, 'usr_admin');
assert(
  systemOperationDetail.journals.length === 1 &&
    systemOperationDetail.journals[0].lines.length === 4,
  'OTC to system account has four-line cross-currency journal'
);

const vaBefore = Number(vaHkd.availableBalance);
const vaOperation = await submitAndApprove(vaHkd);
const detailAfterVa = await request(`/customers/${customerId}`, 'usr_maker');
const sourceAfterVa = detailAfterVa.accounts.find((row) => row.id === source.id);
const vaAfter = detailAfterVa.accounts.find((row) => row.id === vaHkd.id);
const walletAfterVa = (await request(`/crypto-wallets?customerId=${customerId}`, 'usr_maker'))[0];
assert(Number(vaAfter.availableBalance) > vaBefore, 'OTC proceeds credit selected VA account');
assert(
  Number(sourceAfterVa.availableBalance) === Number(sourceAfterSystem.availableBalance) - 1 &&
    Number(walletAfterVa.availableBalance) === Number(walletAfterSystem.availableBalance) - 1,
  'second OTC keeps wallet and accounting mirror synchronized'
);
const vaOperationDetail = await request(`/operations/${vaOperation.id}`, 'usr_admin');
assert(
  vaOperationDetail.targetAccountId === vaHkd.id && vaOperationDetail.journals.length === 1,
  'OTC VA settlement remains linked to selected VA and journal'
);

const rejected = await request('/operations', 'usr_admin', {
  method: 'POST',
  body: JSON.stringify({
    customerId,
    type: 'OTC',
    currency: 'USDT',
    quoteCurrency: 'USD',
    amount: '1',
    feeAmount: '0',
    sourceAccountId: source.id,
    targetAccountId: systemUsd.id,
    idempotencyKey: crypto.randomUUID(),
    narrative: `${marker} OTC reject`,
  }),
});
await request(`/operations/${rejected.id}/reject`, 'usr_admin', {
  method: 'PATCH',
  body: JSON.stringify({ reason: `${marker} OTC 拒绝测试` }),
});
const detailAfterReject = await request(`/customers/${customerId}`, 'usr_maker');
const sourceAfterReject = detailAfterReject.accounts.find((row) => row.id === source.id);
const walletAfterReject = (
  await request(`/crypto-wallets?customerId=${customerId}`, 'usr_maker')
)[0];
assert(
  Number(sourceAfterReject.availableBalance) === Number(sourceAfterVa.availableBalance) &&
    Number(sourceAfterReject.frozenBalance) === 0 &&
    Number(walletAfterReject.availableBalance) === Number(walletAfterVa.availableBalance) &&
    Number(walletAfterReject.frozenBalance) === 0,
  'rejected OTC releases both wallet and accounting mirror reservation'
);

console.log('PASS all local OTC settlement workflows');

async function submitAndApprove(target) {
  const operation = await request('/operations', 'usr_admin', {
    method: 'POST',
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
      narrative: `${marker} OTC to ${target.kind}`,
    }),
  });
  assert(operation.status === 'SUBMITTED', `OTC to ${target.kind} submitted for approval`);
  const approved = await request(`/operations/${operation.id}/approve`, 'usr_admin', {
    method: 'PATCH',
  });
  assert(approved.status === 'COMPLETED', `OTC to ${target.kind} completed after admin approval`);
  return approved;
}
