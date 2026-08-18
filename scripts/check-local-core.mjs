const endpoints = [
  ['API health', 'http://localhost:4000/api/v1/health', (payload) => payload?.status === 'ok'],
  [
    'Customers',
    'http://localhost:4000/api/v1/customers?organizationId=org_demo',
    (payload) => Array.isArray(payload) && payload.some((row) => row.id === 'cus_demo_business'),
  ],
  [
    'Channels',
    'http://localhost:4000/api/v1/funding-channels?organizationId=org_demo',
    (payload) => Array.isArray(payload) && payload.length > 0,
  ],
  [
    'Asset summary',
    'http://localhost:4000/api/v1/accounts/summary?customerId=cus_demo_business',
    (payload) =>
      payload?.customerId === 'cus_demo_business' &&
      payload?.reportingCurrency === 'USD' &&
      payload?.valuationStatus === 'complete' &&
      Number(payload?.totalBalance) > 0 &&
      Array.isArray(payload?.distribution) &&
      payload.distribution.some((row) => row.currency === 'USDT') &&
      payload.distribution.every((row) => ['USD', 'HKD', 'USDT'].includes(row.currency)),
  ],
  [
    'Supported crypto network',
    'http://localhost:4000/api/v1/crypto-wallets?customerId=cus_demo_business',
    (payload) =>
      Array.isArray(payload) &&
      payload.length === 1 &&
      payload[0].asset === 'USDT' &&
      payload[0].network === 'TRON' &&
      payload[0].walletAddress === '' &&
      payload[0].depositEnabled === false &&
      payload[0].custodyProvider === null &&
      payload[0].ownershipVerifiedAt === null,
  ],
];

let failed = false;
for (const [name, url, validate] of endpoints) {
  try {
    const response = await fetch(url, { headers: { 'x-user-id': 'usr_admin' } });
    const payload = await response.json().catch(() => null);
    const passed = response.ok && validate(payload);
    console.log(`${passed ? 'PASS' : 'FAIL'} ${name} ${response.status}`);
    failed ||= !passed;
  } catch (error) {
    failed = true;
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : error}`);
  }
}

try {
  const denied = await fetch(
    'http://localhost:4000/api/v1/accounts/summary?customerId=cus_demo_business',
    { headers: { 'x-user-id': 'unknown-user' } }
  );
  const passed = denied.status === 403;
  console.log(`${passed ? 'PASS' : 'FAIL'} Asset summary tenant guard ${denied.status}`);
  failed ||= !passed;
} catch (error) {
  failed = true;
  console.log(`FAIL Asset summary tenant guard: ${error instanceof Error ? error.message : error}`);
}

try {
  const unsupported = await fetch('http://localhost:4000/api/v1/crypto-wallets/withdrawals', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': 'usr_admin' },
    body: JSON.stringify({
      customerId: 'cus_demo_business',
      walletId: 'cw_biz_tron',
      network: 'BSC',
      amount: '10',
      toAddress: '0x1111111111111111111111111111111111111111',
      idempotencyKey: 'unsupported-network-check',
    }),
  });
  const passed = unsupported.status === 400;
  console.log(`${passed ? 'PASS' : 'FAIL'} Unsupported crypto network guard ${unsupported.status}`);
  failed ||= !passed;
} catch (error) {
  failed = true;
  console.log(
    `FAIL Unsupported crypto network guard: ${error instanceof Error ? error.message : error}`
  );
}

process.exit(failed ? 1 : 0);
