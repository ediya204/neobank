import { createHash } from 'node:crypto';

const baseUrl = process.env.CORE_API_URL || 'http://localhost:4000/api/v1';
const customerId = 'cus_demo_business';
const marker = process.env.LINK_CHECK_MARKER || `LINK-CHECK-${Date.now()}`;

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL ${message}`);
  console.log(`PASS ${message}`);
}

function base58(buffer) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt(`0x${buffer.toString('hex')}`);
  let encoded = '';
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of buffer) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}

function localTronFixture(label) {
  const payload = Buffer.concat([
    Buffer.from([0x41]),
    createHash('sha256').update(label).digest().subarray(0, 20),
  ]);
  const checksum = createHash('sha256')
    .update(createHash('sha256').update(payload).digest())
    .digest()
    .subarray(0, 4);
  return base58(Buffer.concat([payload, checksum]));
}

const apiHost = new URL(baseUrl).hostname;
assert(
  ['localhost', '127.0.0.1', '::1'].includes(apiHost),
  'crypto E2E is restricted to localhost'
);
const testDestination = localTronFixture('NEOBOOK_LOCAL_SIMULATED_WITHDRAWAL_ONLY');

async function request(path, userId, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-user-id': userId, ...init.headers },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function customerDetail() {
  return (await request(`/customers/${customerId}`, 'usr_admin')).body;
}

function cryptoMirror(detail) {
  return detail.accounts.find(
    (account) =>
      account.kind === 'CRYPTO_WALLET' && account.currency === 'USDT' && account.network === 'TRON'
  );
}

const deniedList = await request(`/crypto-wallets?customerId=${customerId}`, 'unknown-user');
assert(deniedList.response.status === 403, 'cross-tenant crypto wallet list rejected');

const walletsResult = await request(`/crypto-wallets?customerId=${customerId}`, 'usr_admin');
assert(walletsResult.response.ok, 'crypto wallets API available');
const wallets = walletsResult.body;
assert(wallets.length === 1, 'only one supported USDT wallet is returned');
const tron = wallets[0];
assert(tron.network === 'TRON', 'supported network is TRON only');

const detailBefore = await customerDetail();
const mirrorBefore = cryptoMirror(detailBefore);
assert(mirrorBefore, 'USDT TRON accounting mirror exists');
assert(
  Number(mirrorBefore.availableBalance) === Number(tron.availableBalance) &&
    Number(mirrorBefore.frozenBalance) === Number(tron.frozenBalance),
  'wallet and accounting mirror start synchronized'
);

const balanceBefore = Number(tron.availableBalance);
const withdrawalResult = await request('/crypto-wallets/withdrawals', 'usr_admin', {
  method: 'POST',
  body: JSON.stringify({
    customerId,
    walletId: tron.id,
    network: 'TRON',
    amount: '2',
    toAddress: testDestination,
    idempotencyKey: crypto.randomUUID(),
  }),
});
assert(withdrawalResult.response.status === 201, 'customer submitted USDT withdrawal');
const withdrawal = withdrawalResult.body;
assert(withdrawal.status === 'SUBMITTED', 'withdrawal waits for admin approval');
assert(Number(withdrawal.netAmount) === 1, 'TRON network fee preview is applied');

const reservedWallet = (await request(`/crypto-wallets?customerId=${customerId}`, 'usr_admin'))
  .body[0];
const reservedMirror = cryptoMirror(await customerDetail());
assert(
  Number(reservedWallet.availableBalance) === balanceBefore - 2 &&
    Number(reservedWallet.frozenBalance) === 2,
  'withdrawal reserves wallet balance'
);
assert(
  Number(reservedMirror.availableBalance) === balanceBefore - 2 &&
    Number(reservedMirror.frozenBalance) === 2,
  'withdrawal reserves accounting mirror balance'
);

const selfApproval = await request(
  `/crypto-wallets/transfers/${withdrawal.id}/approve`,
  'usr_maker',
  { method: 'PATCH', body: '{}' }
);
assert(selfApproval.response.status === 403, 'non-admin crypto approval rejected');

const approval = await request(`/crypto-wallets/transfers/${withdrawal.id}/approve`, 'usr_admin', {
  method: 'PATCH',
  body: '{}',
});
assert(approval.body.status === 'PROCESSING', 'submitting admin approved crypto withdrawal');

const execution = await request(`/crypto-wallets/transfers/${withdrawal.id}/execute`, 'usr_admin', {
  method: 'PATCH',
  body: JSON.stringify({
    txHash: `0x${Buffer.from(marker).toString('hex').padEnd(64, 'd').slice(0, 64)}`,
  }),
});
assert(execution.body.status === 'COMPLETED', 'admin completed local simulated chain execution');
assert(execution.body.txHash?.length === 66, 'completed withdrawal stores transaction hash');

const walletAfter = (await request(`/crypto-wallets?customerId=${customerId}`, 'usr_admin'))
  .body[0];
const mirrorAfter = cryptoMirror(await customerDetail());
assert(
  Number(walletAfter.availableBalance) === balanceBefore - 2 &&
    Number(walletAfter.frozenBalance) === 0,
  'completed withdrawal debits wallet and clears frozen balance'
);
assert(
  Number(mirrorAfter.availableBalance) === Number(walletAfter.availableBalance) &&
    Number(mirrorAfter.frozenBalance) === 0,
  'completed withdrawal keeps accounting mirror synchronized'
);

const operation = await request(`/operations/${withdrawal.id}`, 'usr_admin');
assert(operation.response.ok, 'withdrawal has linked accounting operation');
assert(operation.body.status === 'COMPLETED', 'linked accounting operation completed');
assert(operation.body.journals.length === 2, 'withdrawal has principal and fee journals');

const rejectCandidate = (
  await request('/crypto-wallets/withdrawals', 'usr_admin', {
    method: 'POST',
    body: JSON.stringify({
      customerId,
      walletId: tron.id,
      network: 'TRON',
      amount: '2',
      toAddress: testDestination,
      idempotencyKey: crypto.randomUUID(),
    }),
  })
).body;
const rejected = await request(
  `/crypto-wallets/transfers/${rejectCandidate.id}/reject`,
  'usr_admin',
  { method: 'PATCH', body: JSON.stringify({ reason: `${marker} 单人审批拒绝路径` }) }
);
assert(rejected.body.status === 'REJECTED', 'submitting admin rejected crypto withdrawal');
const walletAfterReject = (await request(`/crypto-wallets?customerId=${customerId}`, 'usr_admin'))
  .body[0];
const mirrorAfterReject = cryptoMirror(await customerDetail());
assert(
  Number(walletAfterReject.availableBalance) === Number(walletAfter.availableBalance) &&
    Number(walletAfterReject.frozenBalance) === 0,
  'rejected withdrawal releases wallet balance'
);
assert(
  Number(mirrorAfterReject.availableBalance) === Number(walletAfterReject.availableBalance) &&
    Number(mirrorAfterReject.frozenBalance) === 0,
  'rejected withdrawal releases accounting mirror balance'
);

console.log('PASS all local USDT TRON workflows');
