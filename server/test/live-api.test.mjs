import assert from 'node:assert/strict';
import test from 'node:test';

const baseUrl = process.env.CORE_API_URL || 'http://localhost:4000/api/v1';
const organizationId = 'org_demo';
const customerId = 'cus_demo_business';
const marker = process.env.LINK_CHECK_MARKER || `LINK-CHECK-API-${Date.now()}`;

async function request(path, userId = 'usr_admin', init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-user-id': userId,
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

test('health endpoint reports a live core API', async () => {
  const { response, body } = await request('/health');
  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
});

test('customer-facing assets are limited to USD, HKD and USDT-TRON', async () => {
  const { response, body } = await request(`/customers/${customerId}`);
  assert.equal(response.status, 200);
  assert.ok(body.accounts.length > 0);
  for (const account of body.accounts) {
    const supportedFiat =
      ['SYSTEM_WALLET', 'VIRTUAL_ACCOUNT'].includes(account.kind) &&
      ['USD', 'HKD'].includes(account.currency);
    const supportedCrypto =
      account.kind === 'CRYPTO_WALLET' && account.currency === 'USDT' && account.network === 'TRON';
    assert.ok(supportedFiat || supportedCrypto, `unsupported account exposed: ${account.id}`);
  }

  const channels = await request(`/funding-channels?organizationId=${organizationId}`);
  assert.equal(channels.response.status, 200);
  for (const channel of channels.body) {
    assert.ok(channel.supportedCurrencies.every((currency) => ['USD', 'HKD'].includes(currency)));
  }
});

test('active customer standard fiat account provisioning is explicit and idempotent', async () => {
  const before = await request(`/accounts?customerId=${customerId}`);
  assert.equal(before.response.status, 200);
  const beforeIds = new Set(before.body.map((account) => account.id));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const provisioned = await request(
      `/customers/${customerId}/standard-fiat-accounts`,
      'usr_admin',
      {
        method: 'POST',
        body: JSON.stringify({}),
      }
    );
    assert.equal(provisioned.response.status, 201);
    assert.deepEqual(provisioned.body.map((account) => account.currency).sort(), ['HKD', 'USD']);
    assert.ok(provisioned.body.every((account) => account.kind === 'SYSTEM_WALLET'));
  }

  const after = await request(`/accounts?customerId=${customerId}`);
  assert.equal(after.response.status, 200);
  assert.equal(after.body.length, before.body.length);
  assert.ok(after.body.every((account) => beforeIds.has(account.id)));
});

test('beneficiaries expose only supported bank or USDT-TRON destinations', async () => {
  const { response, body } = await request(`/customers/${customerId}`);
  assert.equal(response.status, 200);
  assert.ok(body.beneficiaries.length > 0);
  for (const beneficiary of body.beneficiaries) {
    const supportedBank =
      beneficiary.type === 'BANK' && ['USD', 'HKD'].includes(beneficiary.currency);
    const supportedCrypto =
      beneficiary.type === 'CRYPTO' &&
      beneficiary.currency === 'USDT' &&
      beneficiary.network === 'TRON';
    assert.ok(
      supportedBank || supportedCrypto,
      `unsupported beneficiary exposed: ${beneficiary.id}`
    );
  }
});

test('crypto beneficiary creation rejects an invalid TRON address without writing a record', async () => {
  const before = await request(`/beneficiaries?customerId=${customerId}`);
  assert.equal(before.response.status, 200);
  const created = await request('/beneficiaries', 'usr_admin', {
    method: 'POST',
    body: JSON.stringify({
      customerId,
      type: 'CRYPTO',
      name: `${marker} invalid address`,
      currency: 'USDT',
      network: 'TRON',
      walletAddress: 'T111111111111111111111111111111111',
    }),
  });
  assert.equal(created.response.status, 400);
  assert.equal(created.body.message, 'invalid_tron_address');

  const after = await request(`/beneficiaries?customerId=${customerId}`);
  assert.equal(after.response.status, 200);
  assert.equal(after.body.length, before.body.length);
});

test('legacy wallets cannot expose a deposit address before Cregis ownership verification', async () => {
  const wallets = await request(`/crypto-wallets?customerId=${customerId}`);
  assert.equal(wallets.response.status, 200);
  assert.equal(wallets.body.length, 1);
  assert.equal(wallets.body[0].walletAddress, '');
  assert.equal(wallets.body[0].depositEnabled, false);
  assert.equal(wallets.body[0].custodyProvider, null);
  assert.equal(wallets.body[0].ownershipVerifiedAt, null);

  const qr = await request(`/crypto-wallets/${wallets.body[0].id}/qr?customerId=${customerId}`);
  assert.equal(qr.response.status, 409);
  assert.equal(qr.body.message, 'crypto_deposit_unavailable_until_cregis_ownership_verified');
});

test('tenant-scoped endpoints reject missing users and cross-organization queries', async () => {
  const missingUser = await request(`/accounts/summary?customerId=${customerId}`, 'unknown-user');
  assert.equal(missingUser.response.status, 403);

  for (const path of [
    '/customers?organizationId=org_other',
    '/operations?organizationId=org_other',
    '/funding-channels?organizationId=org_other',
    '/ledger?organizationId=org_other',
  ]) {
    const result = await request(path);
    assert.equal(result.response.status, 403, path);
  }
});

test('withdrawal fee rules are tenant-scoped and expose versioned channel dimensions', async () => {
  const fees = await request(`/withdrawal-fees?organizationId=${organizationId}`);
  assert.equal(fees.response.status, 200);
  assert.ok(fees.body.length >= 1);
  for (const fee of fees.body) {
    assert.equal(fee.organizationId, organizationId);
    assert.ok(['FIAT', 'CRYPTO'].includes(fee.assetClass));
    assert.ok(['VA', 'POBO', 'PLATFORM', 'ON_CHAIN'].includes(fee.method));
    assert.match(fee.channelCode, /^[A-Z0-9-]+$/);
    assert.match(fee.amount, /^\d+(?:\.\d+)?$/);
    assert.match(fee.version, /^\d+$/);
  }
  const cryptoFee = fees.body.find(
    (fee) =>
      fee.assetClass === 'CRYPTO' &&
      fee.currency === 'USDT' &&
      fee.method === 'ON_CHAIN' &&
      fee.channelCode === 'CREGIS' &&
      fee.network === 'TRON'
  );
  assert.ok(cryptoFee);

  const crossTenant = await request('/withdrawal-fees?organizationId=org_other');
  assert.equal(crossTenant.response.status, 403);
});

test('unsupported legacy products cannot create new operations or rates', async () => {
  const detail = (await request(`/customers/${customerId}`)).body;
  const usd = detail.accounts.find(
    (account) => account.kind === 'SYSTEM_WALLET' && account.currency === 'USD'
  );
  const usdVa = detail.accounts.find(
    (account) => account.kind === 'VIRTUAL_ACCOUNT' && account.currency === 'USD'
  );
  assert.ok(usd && usdVa);
  const operation = await request('/operations', 'usr_admin', {
    method: 'POST',
    body: JSON.stringify({
      customerId,
      type: 'DEPOSIT',
      currency: 'EUR',
      amount: '1',
      targetAccountId: usdVa.id,
      idempotencyKey: crypto.randomUUID(),
    }),
  });
  assert.equal(operation.response.status, 400);

  const internalTransfer = await request('/operations', 'usr_admin', {
    method: 'POST',
    body: JSON.stringify({
      customerId,
      type: 'INTERNAL_TRANSFER',
      currency: 'USD',
      amount: '1',
      sourceAccountId: usd.id,
      targetAccountId: usdVa.id,
      idempotencyKey: crypto.randomUUID(),
    }),
  });
  assert.equal(internalTransfer.response.status, 400);

  const rate = await request('/rates', 'usr_admin', {
    method: 'POST',
    body: JSON.stringify({
      type: 'FX',
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      buyRate: '1',
      sellRate: '1',
      feeBps: 0,
      effectiveFrom: new Date().toISOString(),
    }),
  });
  assert.equal(rate.response.status, 400);
});

test('rate creation rejects same-currency and non-positive values without writing a version', async () => {
  const invalidRates = [
    { baseCurrency: 'USD', quoteCurrency: 'USD', buyRate: '1', sellRate: '1' },
    { baseCurrency: 'USD', quoteCurrency: 'HKD', buyRate: '0', sellRate: '1' },
    { baseCurrency: 'USD', quoteCurrency: 'HKD', buyRate: '1', sellRate: '-1' },
  ];
  for (const invalid of invalidRates) {
    const result = await request('/rates', 'usr_admin', {
      method: 'POST',
      body: JSON.stringify({
        type: 'FX',
        ...invalid,
        feeBps: 0,
        effectiveFrom: new Date().toISOString(),
      }),
    });
    assert.equal(result.response.status, 400, JSON.stringify(invalid));
  }
});

test('an administrator can explicitly deactivate an active rate without deleting history', async () => {
  const created = await request('/rates', 'usr_admin', {
    method: 'POST',
    body: JSON.stringify({
      type: 'FX',
      baseCurrency: 'USD',
      quoteCurrency: 'HKD',
      buyRate: '7.8',
      sellRate: '7.9',
      feeBps: 0,
      effectiveFrom: new Date().toISOString(),
    }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.active, true);

  const deactivated = await request(`/rates/${created.body.id}/deactivate`, 'usr_admin', {
    method: 'PATCH',
    body: JSON.stringify({}),
  });
  assert.equal(deactivated.response.status, 200);
  assert.equal(deactivated.body.active, false);
  assert.ok(deactivated.body.effectiveUntil);

  const repeated = await request(`/rates/${created.body.id}/deactivate`, 'usr_admin', {
    method: 'PATCH',
    body: JSON.stringify({}),
  });
  assert.equal(repeated.response.status, 404);

  const listed = await request('/rates', 'usr_admin');
  const historical = listed.body.find((row) => row.id === created.body.id);
  assert.equal(historical.active, false);
});

test('single-admin payout approval preserves idempotency, role isolation and frozen balance', async () => {
  const customer = (await request(`/customers/${customerId}`)).body;
  const channels = (await request(`/funding-channels?organizationId=${organizationId}`)).body;
  const source = customer.accounts.find(
    (account) => account.kind === 'SYSTEM_WALLET' && account.currency === 'HKD'
  );
  const beneficiary = customer.beneficiaries.find((row) => row.currency === 'HKD');
  const channel = channels.find((row) => row.type === 'PLATFORM_PAYOUT' && row.active);
  assert.ok(source && beneficiary && channel);

  const before = await request(`/accounts/${source.id}`);
  const idempotencyKey = crypto.randomUUID();
  const payload = {
    customerId,
    type: 'PAYOUT',
    currency: 'HKD',
    amount: '1',
    feeAmount: '0',
    sourceAccountId: source.id,
    beneficiaryId: beneficiary.id,
    channelId: channel.id,
    payoutMethod: 'PLATFORM',
    narrative: `${marker} API contract test`,
    idempotencyKey,
  };

  const created = await request('/operations', 'usr_admin', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.status, 'SUBMITTED');
  assert.equal(created.body.feeAmount, '0');
  assert.equal(created.body.metadata.withdrawalFee.channelCode, channel.code);
  assert.match(created.body.metadata.withdrawalFee.version, /^\d+$/);

  try {
    const repeated = await request('/operations', 'usr_admin', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    assert.equal(repeated.response.status, 201);
    assert.equal(repeated.body.id, created.body.id);

    const reserved = await request(`/accounts/${source.id}`);
    assert.equal(Number(reserved.body.availableBalance), Number(before.body.availableBalance) - 1);
    assert.equal(Number(reserved.body.frozenBalance), Number(before.body.frozenBalance) + 1);

    const nonAdminApproval = await request(`/operations/${created.body.id}/approve`, 'usr_maker', {
      method: 'PATCH',
    });
    assert.equal(nonAdminApproval.response.status, 403);

    const rejected = await request(`/operations/${created.body.id}/reject`, 'usr_admin', {
      method: 'PATCH',
      body: JSON.stringify({ reason: `${marker} expected rejection` }),
    });
    assert.equal(rejected.response.status, 200);
    assert.equal(rejected.body.status, 'REJECTED');

    const after = await request(`/accounts/${source.id}`);
    assert.equal(Number(after.body.availableBalance), Number(before.body.availableBalance));
    assert.equal(Number(after.body.frozenBalance), Number(before.body.frozenBalance));

    const detail = await request(`/operations/${created.body.id}`);
    assert.equal(detail.body.journals.length, 0);
  } finally {
    const current = await request(`/operations/${created.body.id}`);
    if (current.body?.status === 'SUBMITTED') {
      await request(`/operations/${created.body.id}/reject`, 'usr_admin', {
        method: 'PATCH',
        body: JSON.stringify({ reason: `${marker} cleanup` }),
      });
    }
  }
});

test('completed journals are balanced per currency', async () => {
  const ledger = await request(`/ledger?organizationId=${organizationId}`);
  assert.equal(ledger.response.status, 200);
  assert.ok(ledger.body.length > 0);
  for (const journal of ledger.body) {
    const totals = new Map();
    for (const line of journal.lines) {
      const total = totals.get(line.currency) || { debit: 0, credit: 0 };
      const amount = Number(line.amount);
      assert.ok(Number.isFinite(amount) && amount > 0, `${journal.id} invalid journal amount`);
      assert.ok(
        line.side === 'DEBIT' || line.side === 'CREDIT',
        `${journal.id} invalid journal side`
      );
      if (line.side === 'DEBIT') total.debit += amount;
      if (line.side === 'CREDIT') total.credit += amount;
      totals.set(line.currency, total);
    }
    for (const [currency, total] of totals) {
      assert.equal(total.debit, total.credit, `${journal.id} ${currency}`);
    }
  }
});
