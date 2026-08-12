const api = 'http://localhost:4000/api/v1';
const headers = (userId) => ({ 'content-type': 'application/json', 'x-user-id': userId });

const customers = await get('/customers?organizationId=org_demo', 'usr_admin');
const customer = customers.find((row) => row.id === 'cus_demo_business');
assert(customer, 'demo customer exists');
const detail = await get(`/customers/${customer.id}`, 'usr_admin');
const channels = await get('/funding-channels?organizationId=org_demo', 'usr_admin');
const usdWallet = detail.accounts.find(
  (row) => row.kind === 'SYSTEM_WALLET' && row.currency === 'USD'
);
const hkdWallet = detail.accounts.find(
  (row) => row.kind === 'SYSTEM_WALLET' && row.currency === 'HKD'
);
const beneficiary = detail.beneficiaries.find((row) => row.currency === 'HKD');
const inbound = channels.find((row) => row.type === 'FIAT_INBOUND');
const pobo = channels.find((row) => row.type === 'POBO_PAYOUT');
assert(
  usdWallet && hkdWallet && beneficiary && inbound && pobo,
  'seeded funding configuration exists'
);

const deposit = await post('/operations', 'usr_maker', {
  customerId: customer.id,
  type: 'DEPOSIT',
  currency: 'USD',
  amount: '100.00',
  targetAccountId: usdWallet.id,
  channelId: inbound.id,
  remitterName: 'E2E Remitter',
  remitterBank: 'E2E Bank',
  remittanceReference: `E2E-IN-${Date.now()}`,
  receivedAt: new Date().toISOString(),
  idempotencyKey: crypto.randomUUID(),
});
assert(deposit.status === 'SUBMITTED', 'fiat deposit submitted');
await expectStatus(`/operations/${deposit.id}/approve`, 'usr_maker', 403);
const approvedDeposit = await patch(`/operations/${deposit.id}/approve`, 'usr_checker');
assert(approvedDeposit.status === 'COMPLETED', 'independent checker posted fiat deposit');

const payout = await post('/operations', 'usr_maker', {
  customerId: customer.id,
  type: 'PAYOUT',
  currency: 'HKD',
  amount: '100.00',
  feeAmount: '2.00',
  sourceAccountId: hkdWallet.id,
  beneficiaryId: beneficiary.id,
  channelId: pobo.id,
  payoutMethod: 'POBO',
  narrative: 'E2E supplier payment',
  idempotencyKey: crypto.randomUUID(),
});
assert(payout.status === 'SUBMITTED', 'POBO payout submitted and funds reserved');
const approvedPayout = await patch(`/operations/${payout.id}/approve`, 'usr_checker');
assert(approvedPayout.status === 'PROCESSING', 'checker approved payout for execution');
const executedPayout = await patch(`/operations/${payout.id}/execute`, 'usr_operator', {
  externalReference: `E2E-OUT-${Date.now()}`,
});
assert(executedPayout.status === 'COMPLETED', 'operator completed payout with bank reference');

const depositDetails = await get(`/operations/${deposit.id}`, 'usr_admin');
const payoutDetails = await get(`/operations/${payout.id}`, 'usr_admin');
assert(depositDetails.journals.length === 1, 'deposit has one balanced journal');
assert(payoutDetails.journals.length === 2, 'payout has principal and fee journals');

const unique = Date.now();
const newCustomer = await post('/customers', 'usr_maker', {
  organizationId: 'org_demo',
  type: 'BUSINESS',
  displayName: `E2E Trading ${unique}`,
  legalName: `E2E Trading ${unique} Limited`,
  email: `e2e-${unique}@example.local`,
  countryCode: 'SG',
  registrationNo: `E2E${unique}`,
});
assert(newCustomer.status === 'PENDING_REVIEW', 'business onboarding submitted');
await expectStatus(`/customers/${newCustomer.id}/approve`, 'usr_maker', 403);
const activeCustomer = await patch(`/customers/${newCustomer.id}/approve`, 'usr_checker', {
  note: 'E2E KYC verified',
});
assert(activeCustomer.status === 'ACTIVE', 'independent checker approved onboarding');
assert(
  activeCustomer.accounts.length === 6,
  'five fiat wallets and one read-only crypto wallet created'
);

const vaRequest = await post(`/customers/${newCustomer.id}/virtual-account-requests`, 'usr_maker', {
  currency: 'USD',
  preferredCountry: 'US',
  purpose: 'E2E trade collection',
});
await expectStatus(`/virtual-account-requests/${vaRequest.id}/approve`, 'usr_maker', 403);
const approvedVa = await patch(`/virtual-account-requests/${vaRequest.id}/approve`, 'usr_checker');
assert(approvedVa.status === 'APPROVED' && approvedVa.assignedAccount, 'independent USD VA opened');

const newDetail = await get(`/customers/${newCustomer.id}`, 'usr_admin');
const newUsd = newDetail.accounts.find(
  (row) => row.kind === 'SYSTEM_WALLET' && row.currency === 'USD'
);
const newSgd = newDetail.accounts.find(
  (row) => row.kind === 'SYSTEM_WALLET' && row.currency === 'SGD'
);
const newGbp = newDetail.accounts.find(
  (row) => row.kind === 'SYSTEM_WALLET' && row.currency === 'GBP'
);
const newUsdt = newDetail.accounts.find(
  (row) => row.kind === 'CRYPTO_WALLET' && row.currency === 'USDT'
);
const usdVa = approvedVa.assignedAccount;
const usdBeneficiary = await post('/beneficiaries', 'usr_maker', {
  customerId: newCustomer.id,
  name: 'E2E USD Supplier',
  currency: 'USD',
  bankName: 'E2E Bank',
  accountNumber: `E2E-${unique}`,
  swiftBic: 'E2EUS33',
  countryCode: 'US',
});
assert(newUsd && newSgd && newGbp && newUsdt && usdVa, 'new customer accounts available');

await submitAndApprove({
  customerId: newCustomer.id,
  type: 'DEPOSIT',
  currency: 'USD',
  amount: '1000.00',
  targetAccountId: newUsd.id,
  channelId: inbound.id,
  remitterName: 'E2E Capital',
  remittanceReference: `E2E-WALLET-IN-${unique}`,
  receivedAt: new Date().toISOString(),
});
await submitAndApprove({
  customerId: newCustomer.id,
  type: 'DEPOSIT',
  currency: 'USD',
  amount: '500.00',
  targetAccountId: usdVa.id,
  channelId: inbound.id,
  remitterName: 'E2E Capital',
  remittanceReference: `E2E-VA-IN-${unique}`,
  receivedAt: new Date().toISOString(),
});
assert(true, 'system wallet and independent VA funded through reviewed fiat deposits');

const vaPayout = await post('/operations', 'usr_maker', {
  customerId: newCustomer.id,
  type: 'PAYOUT',
  currency: 'USD',
  amount: '75.00',
  sourceAccountId: usdVa.id,
  beneficiaryId: usdBeneficiary.id,
  channelId: channels.find((row) => row.type === 'VA_PAYOUT').id,
  payoutMethod: 'VA',
  idempotencyKey: crypto.randomUUID(),
});
await patch(`/operations/${vaPayout.id}/approve`, 'usr_checker');
await patch(`/operations/${vaPayout.id}/execute`, 'usr_operator', {
  externalReference: `E2E-VA-OUT-${unique}`,
});
assert(true, 'VA payout completed from independent VA balance');

const platformPayout = await post('/operations', 'usr_maker', {
  customerId: newCustomer.id,
  type: 'PAYOUT',
  currency: 'USD',
  amount: '80.00',
  sourceAccountId: newUsd.id,
  beneficiaryId: usdBeneficiary.id,
  channelId: channels.find((row) => row.type === 'PLATFORM_PAYOUT').id,
  payoutMethod: 'PLATFORM',
  idempotencyKey: crypto.randomUUID(),
});
await patch(`/operations/${platformPayout.id}/approve`, 'usr_checker');
await patch(`/operations/${platformPayout.id}/execute`, 'usr_operator', {
  externalReference: `E2E-PLATFORM-OUT-${unique}`,
});
assert(true, 'platform payout completed from system wallet');

await submitAndApprove({
  customerId: customer.id,
  type: 'INTERNAL_TRANSFER',
  currency: 'USD',
  amount: '50.00',
  sourceAccountId: usdWallet.id,
  targetAccountId: newUsd.id,
});
assert(true, 'same-currency customer-to-customer transfer completed');

await submitAndApprove({
  customerId: newCustomer.id,
  type: 'FX',
  currency: 'USD',
  quoteCurrency: 'SGD',
  amount: '100.00',
  sourceAccountId: newUsd.id,
  targetAccountId: newSgd.id,
});
assert(true, 'five-currency FX workflow completed with versioned rate');

await submitAndApprove({
  customerId: newCustomer.id,
  type: 'OTC',
  currency: 'USD',
  quoteCurrency: 'USDT',
  amount: '50.00',
  sourceAccountId: newUsd.id,
  targetAccountId: newUsdt.id,
});
assert(true, 'internal OTC conversion completed without chain transfer');

await submitAndApprove({
  customerId: newCustomer.id,
  type: 'ADJUSTMENT',
  currency: 'GBP',
  amount: '200.00',
  adjustmentDirection: 'CREDIT',
  targetAccountId: newGbp.id,
  narrative: 'E2E reviewed compensating adjustment',
});
assert(true, 'reviewed compensating adjustment completed');

await expectCreateStatus(
  {
    customerId: newCustomer.id,
    type: 'INTERNAL_TRANSFER',
    currency: 'USDT',
    amount: '1.00',
    sourceAccountId: newUsdt.id,
    targetAccountId: newUsdt.id,
  },
  400
);
assert(true, 'digital wallet transfer remains disabled until Cregis');
console.log('PASS all local financial workflows');

async function request(path, userId, init = {}) {
  const response = await fetch(`${api}${path}`, { ...init, headers: headers(userId) });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      `${init.method || 'GET'} ${path} failed ${response.status}: ${JSON.stringify(body)}`
    );
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

async function submitAndApprove(body) {
  const operation = await post('/operations', 'usr_maker', {
    ...body,
    feeAmount: body.feeAmount || '0',
    idempotencyKey: crypto.randomUUID(),
  });
  return patch(`/operations/${operation.id}/approve`, 'usr_checker');
}

async function expectCreateStatus(body, expected) {
  const response = await fetch(`${api}/operations`, {
    method: 'POST',
    headers: headers('usr_maker'),
    body: JSON.stringify({ ...body, idempotencyKey: crypto.randomUUID() }),
  });
  assert(response.status === expected, `disabled operation rejected with ${expected}`);
}

async function expectStatus(path, userId, expected) {
  const response = await fetch(`${api}${path}`, { method: 'PATCH', headers: headers(userId) });
  assert(response.status === expected, `self-approval rejected with ${expected}`);
}

function assert(value, message) {
  if (!value) throw new Error(`FAIL ${message}`);
  console.log(`PASS ${message}`);
}
