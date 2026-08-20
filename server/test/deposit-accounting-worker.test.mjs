import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { DepositAccountingWorker } from '../dist/src/deposit-accounting/deposit-accounting.worker.js';

const source = { customer_id: 'customer_test', tenant_id: 'neobank' };
const customer = {
  id: source.customer_id,
  organizationId: 'org_neobank',
  status: 'ACTIVE',
  kycStatus: 'APPROVED',
};
const admin = {
  id: 'usr_neobank_admin',
  active: true,
  role: 'ADMIN',
  organizationId: 'org_neobank',
};
const targetAccount = {
  id: 'account_usdt',
  customerId: source.customer_id,
  kind: 'CRYPTO_WALLET',
  currency: 'USDT',
  network: 'TRON',
  status: 'ACTIVE',
};
const clearingAccount = {
  id: 'clearing_usdt',
  kind: 'PLATFORM_CLEARING',
  currency: 'USDT',
  status: 'ACTIVE',
};
const wallet = {
  id: 'wallet_usdt',
  customerId: source.customer_id,
  asset: 'USDT',
  network: 'TRON',
  status: 'ACTIVE',
  walletAddress: 'TDeposit1111111111111111111111111',
};
const deposit = {
  deposit_id: 'deposit_test',
  tenant_id: 'neobank',
  customer_id: source.customer_id,
  accounting_status: 'processing',
  attempt_count: 0,
  cregis_cid: '1463535767997001',
  chain_id: '195',
  token_id: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  currency: 'USDT',
  address: wallet.walletAddress,
  from_address: 'TXsmKpEuW7qWnXzJLGP9eDLvWPR2GRn1FS',
  amount_text: '1.25',
  amount_minor: 1_250_000n,
  custody_status: 'completed',
  txid: 'tx-deposit-1',
  received_at: '2026-08-20T04:29:56.000Z',
  raw_sha256: 'a'.repeat(64),
  wallet_customer_id: source.customer_id,
  wallet_status: 'active',
  custody_provider: 'cregis',
  ownership_verified_at: '2026-08-20T04:00:00.000Z',
  customer_status: 'active',
  kyc_status: 'approved',
  operations_status: 'active',
};

function database({ duplicate = null, sourceRow = source, account = targetAccount } = {}) {
  const observed = {
    accountUpdates: [],
    walletUpdates: [],
    transfers: [],
    operations: [],
    journals: [],
    posted: 0,
    failures: [],
  };
  let rawQueryCount = 0;
  const transaction = {
    $queryRaw: async () => [deposit],
    $executeRaw: async () => {
      observed.posted += 1;
      return 1;
    },
    customer: { findUnique: async () => customer },
    user: { findUnique: async () => admin },
    account: {
      findMany: async ({ where }) =>
        where.kind === 'PLATFORM_CLEARING' ? [clearingAccount] : [account],
      create: async () => {
        throw new Error('existing account must be reused');
      },
      update: async (input) => {
        observed.accountUpdates.push(input);
        return targetAccount;
      },
    },
    cryptoWallet: {
      findUnique: async () => wallet,
      create: async () => {
        throw new Error('existing wallet must be reused');
      },
      update: async (input) => {
        observed.walletUpdates.push(input);
        return wallet;
      },
    },
    operation: {
      findFirst: async () => duplicate,
      create: async ({ data }) => {
        const created = { id: 'operation_deposit', ...data };
        observed.operations.push(created);
        return created;
      },
    },
    cryptoTransfer: {
      create: async ({ data }) => {
        const created = { id: 'transfer_deposit', ...data };
        observed.transfers.push(created);
        return created;
      },
    },
    journalEntry: {
      create: async ({ data }) => {
        observed.journals.push(data);
        return data;
      },
    },
  };
  const db = {
    customer: { findUnique: async () => customer },
    $queryRaw: async () => {
      rawQueryCount += 1;
      return rawQueryCount === 1 ? [sourceRow] : [{ attempt_count: 0 }];
    },
    $executeRaw: async () => {
      observed.failures.push(true);
      return 1;
    },
    $transaction: async (operation) => operation(transaction),
  };
  return { db, observed };
}

test('verified Cregis deposit posts one balanced Core journal and both materialized balances', async () => {
  const { db, observed } = database();
  const worker = new DepositAccountingWorker(db);
  await worker.processDeposit(deposit.deposit_id);

  assert.equal(observed.operations.length, 1);
  assert.equal(observed.transfers.length, 1);
  assert.equal(observed.accountUpdates.length, 1);
  assert.equal(observed.walletUpdates.length, 1);
  assert.equal(observed.journals.length, 1);
  assert.equal(observed.posted, 1);
  assert.equal(observed.failures.length, 0);
  assert.equal(observed.operations[0].status, 'COMPLETED');
  assert.equal(observed.operations[0].externalReference, deposit.txid);
  assert.equal(observed.operations[0].amount.toString(), '1.25');

  const lines = observed.journals[0].lines.create;
  assert.deepEqual(
    lines.map((line) => [line.accountId, line.side, line.amount.toString()]),
    [
      [clearingAccount.id, 'DEBIT', '1.25'],
      [targetAccount.id, 'CREDIT', '1.25'],
    ]
  );
  const debit = lines
    .filter((line) => line.side === 'DEBIT')
    .reduce((total, line) => total.add(line.amount), new Prisma.Decimal(0));
  const credit = lines
    .filter((line) => line.side === 'CREDIT')
    .reduce((total, line) => total.add(line.amount), new Prisma.Decimal(0));
  assert.equal(debit.equals(credit), true);
});

test('an existing Core deposit reference is quarantined instead of credited twice', async () => {
  const { db, observed } = database({ duplicate: { id: 'existing_operation' } });
  const worker = new DepositAccountingWorker(db);
  await worker.processDeposit(deposit.deposit_id);

  assert.equal(observed.operations.length, 0);
  assert.equal(observed.transfers.length, 0);
  assert.equal(observed.accountUpdates.length, 0);
  assert.equal(observed.walletUpdates.length, 0);
  assert.equal(observed.journals.length, 0);
  assert.equal(observed.failures.length, 1);
});

test('a different existing Core wallet binding is never overwritten', async () => {
  const { db, observed } = database({
    account: { ...targetAccount, walletAddress: 'TExistingDifferentWallet11111111111111' },
  });
  const worker = new DepositAccountingWorker(db);
  await worker.processDeposit(deposit.deposit_id);

  assert.equal(observed.operations.length, 0);
  assert.equal(observed.accountUpdates.length, 0);
  assert.equal(observed.walletUpdates.length, 0);
  assert.equal(observed.failures.length, 1);
});

test('cross-tenant accounting intent never enters the Core transaction', async () => {
  const { db, observed } = database({
    sourceRow: { customer_id: source.customer_id, tenant_id: 'tenant_other' },
  });
  let transactionCalls = 0;
  db.$transaction = async () => {
    transactionCalls += 1;
    throw new Error('must not enter transaction');
  };
  const worker = new DepositAccountingWorker(db);
  await worker.processDeposit(deposit.deposit_id);

  assert.equal(transactionCalls, 0);
  assert.equal(observed.failures.length, 1);
});
