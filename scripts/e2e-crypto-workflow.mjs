const baseUrl = process.env.CORE_API_URL || 'http://localhost:4000/api/v1';
const customerId = 'cus_demo_individual';

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
  return { response, body };
}

const walletsResult = await request(`/crypto-wallets?customerId=${customerId}`, 'usr_maker');
assert(walletsResult.response.ok, 'crypto wallets API available');
const wallets = walletsResult.body;
assert(wallets.length === 3, 'USDT has TRON, BSC and Ethereum wallets');
assert(
  ['TRON', 'BSC', 'ETHEREUM'].every((network) =>
    wallets.some((wallet) => wallet.network === network)
  ),
  'all default networks are present'
);

const tron = wallets.find((wallet) => wallet.network === 'TRON');
const balanceBefore = Number(tron.availableBalance);
const withdrawalResult = await request('/crypto-wallets/withdrawals', 'usr_maker', {
  method: 'POST',
  body: JSON.stringify({
    customerId,
    walletId: tron.id,
    network: 'TRON',
    amount: '25',
    toAddress: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
    idempotencyKey: crypto.randomUUID(),
  }),
});
assert(withdrawalResult.response.status === 201, 'customer submitted USDT withdrawal');
const withdrawal = withdrawalResult.body;
assert(withdrawal.status === 'SUBMITTED', 'withdrawal waits for independent review');
assert(Number(withdrawal.netAmount) === 24, 'TRON network fee preview is applied');

const selfApproval = await request(
  `/crypto-wallets/transfers/${withdrawal.id}/approve`,
  'usr_maker',
  {
    method: 'PATCH',
    body: '{}',
  }
);
assert(selfApproval.response.status === 403, 'crypto withdrawal self-approval rejected');

const approval = await request(
  `/crypto-wallets/transfers/${withdrawal.id}/approve`,
  'usr_checker',
  {
    method: 'PATCH',
    body: '{}',
  }
);
assert(approval.body.status === 'PROCESSING', 'independent checker approved crypto withdrawal');

const execution = await request(
  `/crypto-wallets/transfers/${withdrawal.id}/execute`,
  'usr_operator',
  {
    method: 'PATCH',
    body: JSON.stringify({ txHash: `0x${'d'.repeat(64)}` }),
  }
);
assert(execution.body.status === 'COMPLETED', 'operator completed local chain execution');
assert(execution.body.txHash?.length === 66, 'completed withdrawal stores transaction hash');

const walletsAfter = (await request(`/crypto-wallets?customerId=${customerId}`, 'usr_maker')).body;
const tronAfter = walletsAfter.find((wallet) => wallet.network === 'TRON');
assert(
  Number(tronAfter.availableBalance) === balanceBefore - 25,
  'completed withdrawal debits network balance'
);
assert(Number(tronAfter.frozenBalance) === 0, 'completed withdrawal clears frozen balance');

const bsc = walletsAfter.find((wallet) => wallet.network === 'BSC');
const bscBefore = Number(bsc.availableBalance);
const rejectedCandidate = (
  await request('/crypto-wallets/withdrawals', 'usr_maker', {
    method: 'POST',
    body: JSON.stringify({
      customerId,
      walletId: bsc.id,
      network: 'BSC',
      amount: '10',
      toAddress: '0x1111111111111111111111111111111111111111',
      idempotencyKey: crypto.randomUUID(),
    }),
  })
).body;
const rejected = await request(
  `/crypto-wallets/transfers/${rejectedCandidate.id}/reject`,
  'usr_checker',
  {
    method: 'PATCH',
    body: JSON.stringify({ reason: '本地复核测试拒绝' }),
  }
);
assert(rejected.body.status === 'REJECTED', 'checker rejected crypto withdrawal');
const bscAfter = (await request(`/crypto-wallets?customerId=${customerId}`, 'usr_maker')).body.find(
  (wallet) => wallet.network === 'BSC'
);
assert(
  Number(bscAfter.availableBalance) === bscBefore,
  'rejected withdrawal releases frozen balance'
);

console.log('PASS all local crypto wallet workflows');
