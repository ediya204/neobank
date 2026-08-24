import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { WithdrawalAccountingWorker } from '../dist/src/deposit-accounting/withdrawal-accounting.worker.js';

const customerId = 'customer_withdrawal';
const walletAddress = 'TXsmKpEuW7qWnXzJLGP9eDLvWPR2GRn1FS';
const destination = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const row = {
  withdrawal_id: 'withdrawal_test',
  tenant_id: 'neobank',
  customer_id: customerId,
  accounting_status: 'reserving',
  attempt_count: 0,
  core_operation_id: null,
  core_transfer_id: null,
  withdrawal_status: 'submitted',
  currency: '195@TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  amount_text: '1.25',
  amount_minor: 1_250_000n,
  fee_amount_text: '0.05',
  fee_amount_minor: 50_000n,
  net_amount_text: '1.20',
  net_amount_minor: 1_200_000n,
  from_address: walletAddress,
  to_address: destination,
  txid: null,
  maker_id: customerId,
  checker_id: null,
  operator_id: null,
  rejection_reason: null,
  reconciliation_note: null,
  approved_at: null,
  completed_at: null,
  wallet_customer_id: customerId,
  wallet_address: walletAddress,
  wallet_status: 'active',
  custody_provider: 'cregis',
  ownership_verified_at: '2026-08-20T04:00:00.000Z',
  customer_status: 'active',
  kyc_status: 'approved',
  operations_status: 'active',
};

const customer = {
  id: customerId,
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
const account = {
  id: 'account_usdt',
  customerId,
  kind: 'CRYPTO_WALLET',
  currency: 'USDT',
  network: 'TRON',
  status: 'ACTIVE',
  walletAddress,
};
const wallet = {
  id: 'wallet_usdt',
  customerId,
  asset: 'USDT',
  network: 'TRON',
  status: 'ACTIVE',
  walletAddress,
};

test('a custody withdrawal freezes Core balances and creates one linked reservation', async () => {
  const observed = { accountFreezes: [], walletFreezes: [], operations: [], transfers: [] };
  const tx = {
    $queryRaw: async () => [row],
    $executeRaw: async () => 1,
    customer: { findUnique: async () => customer },
    user: { findUnique: async () => admin },
    account: {
      findMany: async () => [account],
      updateMany: async (input) => {
        observed.accountFreezes.push(input);
        return { count: 1 };
      },
    },
    cryptoWallet: {
      findUnique: async () => wallet,
      updateMany: async (input) => {
        observed.walletFreezes.push(input);
        return { count: 1 };
      },
    },
    operation: {
      findFirst: async () => null,
      create: async ({ data }) => {
        const created = { ...data };
        observed.operations.push(created);
        return created;
      },
    },
    cryptoTransfer: {
      create: async ({ data }) => {
        const created = { ...data };
        observed.transfers.push(created);
        return created;
      },
    },
  };
  const db = {
    customer: { findUnique: async () => customer },
    $queryRaw: async () => [{ customer_id: customerId, tenant_id: 'neobank' }],
    $executeRaw: async () => 1,
    $transaction: async (operation) => operation(tx),
  };

  await new WithdrawalAccountingWorker(db).processWithdrawal(row.withdrawal_id, 'reserving');

  assert.equal(observed.walletFreezes.length, 1);
  assert.equal(observed.accountFreezes.length, 1);
  assert.equal(observed.transfers.length, 1);
  assert.equal(observed.operations.length, 1);
  assert.equal(observed.transfers[0].amount.toString(), '1.25');
  assert.equal(observed.transfers[0].netAmount.toString(), '1.2');
  assert.equal(observed.operations[0].amount.toString(), '1.2');
  assert.equal(observed.operations[0].feeAmount.toString(), '0.05');
  assert.equal(observed.operations[0].id, observed.transfers[0].id);
  for (const frozen of [observed.walletFreezes[0], observed.accountFreezes[0]]) {
    assert.equal(frozen.data.availableBalance.decrement.toString(), '1.25');
    assert.equal(frozen.data.frozenBalance.increment.toString(), '1.25');
  }
});

test('a completed signed custody withdrawal consumes the freeze and posts balanced principal and fee journals', async () => {
  const completed = {
    ...row,
    accounting_status: 'settling',
    withdrawal_status: 'completed',
    core_operation_id: 'core_withdrawal',
    core_transfer_id: 'core_withdrawal',
    operator_id: 'operator@example.test',
    txid: 'a'.repeat(64),
    completed_at: '2026-08-20T05:00:00.000Z',
  };
  const operation = {
    id: 'core_withdrawal',
    status: 'PROCESSING',
    sourceAccountId: account.id,
    reference: 'CREGIS-WD-neobank-withdrawal_test',
    narrative: 'USDT withdrawal',
  };
  const transfer = { id: operation.id, status: 'PROCESSING', walletId: wallet.id };
  const clearing = { id: 'clearing_usdt' };
  const fee = { id: 'fee_usdt' };
  const journals = [];
  let rawQueryCount = 0;
  const tx = {
    $queryRaw: async () => {
      rawQueryCount += 1;
      return rawQueryCount === 1 ? [completed] : [{ id: admin.id }];
    },
    $executeRaw: async () => 1,
    operation: {
      findUnique: async () => operation,
      update: async ({ data }) => ({ ...operation, ...data }),
    },
    cryptoTransfer: {
      findUnique: async () => transfer,
      update: async ({ data }) => ({ ...transfer, ...data }),
    },
    cryptoWallet: { updateMany: async () => ({ count: 1 }) },
    account: {
      findMany: async ({ where }) => [where.kind === 'PLATFORM_CLEARING' ? clearing : fee],
      updateMany: async () => ({ count: 1 }),
    },
    journalEntry: {
      create: async ({ data }) => {
        journals.push(data);
        return data;
      },
    },
  };
  const db = {
    $queryRaw: async () => [],
    $executeRaw: async () => 1,
    $transaction: async (operationFn) => operationFn(tx),
  };

  await new WithdrawalAccountingWorker(db).processWithdrawal(completed.withdrawal_id, 'settling');

  assert.equal(journals.length, 2);
  assert.deepEqual(
    journals.map((journal) =>
      journal.lines.create.map((line) => [line.accountId, line.side, line.amount.toString()])
    ),
    [
      [
        [account.id, 'DEBIT', '1.2'],
        [clearing.id, 'CREDIT', '1.2'],
      ],
      [
        [account.id, 'DEBIT', '0.05'],
        [fee.id, 'CREDIT', '0.05'],
      ],
    ]
  );
  for (const journal of journals) {
    const debit = journal.lines.create
      .filter((line) => line.side === 'DEBIT')
      .reduce((total, line) => total.add(line.amount), new Prisma.Decimal(0));
    const credit = journal.lines.create
      .filter((line) => line.side === 'CREDIT')
      .reduce((total, line) => total.add(line.amount), new Prisma.Decimal(0));
    assert.equal(debit.equals(credit), true);
  }
});

test('a rejected linked withdrawal releases both materialized balances atomically', async () => {
  const releasing = {
    ...row,
    accounting_status: 'releasing',
    withdrawal_status: 'rejected',
    core_operation_id: 'core_withdrawal',
    core_transfer_id: 'core_withdrawal',
    checker_id: 'checker@example.test',
    rejection_reason: 'Cregis rejected the payout',
  };
  const operation = {
    id: 'core_withdrawal',
    status: 'PROCESSING',
    sourceAccountId: account.id,
  };
  const transfer = { id: operation.id, status: 'PROCESSING', walletId: wallet.id };
  const observed = { accountReleases: [], walletReleases: [], operation: null, transfer: null };
  let rawQueryCount = 0;
  const tx = {
    $queryRaw: async () => {
      rawQueryCount += 1;
      return rawQueryCount === 1 ? [releasing] : [{ id: admin.id }];
    },
    $executeRaw: async () => 1,
    operation: {
      findUnique: async () => operation,
      update: async ({ data }) => {
        observed.operation = data;
        return { ...operation, ...data };
      },
    },
    cryptoTransfer: {
      findUnique: async () => transfer,
      update: async ({ data }) => {
        observed.transfer = data;
        return { ...transfer, ...data };
      },
    },
    cryptoWallet: {
      updateMany: async (input) => {
        observed.walletReleases.push(input);
        return { count: 1 };
      },
    },
    account: {
      updateMany: async (input) => {
        observed.accountReleases.push(input);
        return { count: 1 };
      },
    },
  };
  const db = {
    $queryRaw: async () => [],
    $executeRaw: async () => 1,
    $transaction: async (operationFn) => operationFn(tx),
  };

  await new WithdrawalAccountingWorker(db).processWithdrawal(releasing.withdrawal_id, 'releasing');

  assert.equal(observed.walletReleases.length, 1);
  assert.equal(observed.accountReleases.length, 1);
  for (const released of [observed.walletReleases[0], observed.accountReleases[0]]) {
    assert.equal(released.data.availableBalance.increment.toString(), '1.25');
    assert.equal(released.data.frozenBalance.decrement.toString(), '1.25');
  }
  assert.equal(observed.operation.status, 'FAILED');
  assert.equal(observed.transfer.status, 'FAILED');
});

test('a proven historical rejection with no Core reservation closes without changing balances', async () => {
  const releasing = {
    ...row,
    accounting_status: 'releasing',
    withdrawal_status: 'rejected',
    core_operation_id: null,
    core_transfer_id: null,
  };
  const tx = {
    $queryRaw: async () => [releasing],
    $executeRaw: async () => 1,
    operation: { findUnique: async () => assert.fail('operation lookup must not run') },
    cryptoTransfer: { findUnique: async () => assert.fail('transfer lookup must not run') },
    cryptoWallet: { updateMany: async () => assert.fail('wallet balance must not change') },
    account: { updateMany: async () => assert.fail('account balance must not change') },
  };
  const db = {
    $queryRaw: async () => [],
    $executeRaw: async () => 1,
    $transaction: async (operationFn) => operationFn(tx),
  };

  await new WithdrawalAccountingWorker(db).processWithdrawal(releasing.withdrawal_id, 'releasing');
});
