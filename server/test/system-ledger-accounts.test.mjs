import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ensureSystemLedgerAccounts,
  systemLedgerAccountDefinitions,
} from '../dist/src/accounts/system-ledger-accounts.js';

test('production ledger bootstrap creates every missing zero-balance system account', async () => {
  const created = [];
  const accounts = await ensureSystemLedgerAccounts({
    account: {
      findUnique: async () => null,
      create: async ({ data }) => {
        created.push(data);
        return { id: `id-${data.accountNumber}`, customerId: null, ...data };
      },
    },
  });

  assert.equal(accounts.length, 6);
  assert.deepEqual(
    created.map(({ accountNumber, kind, currency, status, availableBalance, frozenBalance }) => ({
      accountNumber,
      kind,
      currency,
      status,
      availableBalance,
      frozenBalance,
    })),
    systemLedgerAccountDefinitions.map(({ accountNumber, kind, currency }) => ({
      accountNumber,
      kind,
      currency,
      status: 'ACTIVE',
      availableBalance: 0,
      frozenBalance: 0,
    }))
  );
});

test('production ledger bootstrap accepts valid accounts without resetting balances', async () => {
  let creates = 0;
  const existingByNumber = new Map(
    systemLedgerAccountDefinitions.map((definition) => [
      definition.accountNumber,
      {
        id: `id-${definition.accountNumber}`,
        customerId: null,
        status: 'ACTIVE',
        availableBalance: '123.45',
        frozenBalance: '6.78',
        ...definition,
      },
    ])
  );
  const accounts = await ensureSystemLedgerAccounts({
    account: {
      findUnique: async ({ where }) => existingByNumber.get(where.accountNumber),
      create: async () => {
        creates += 1;
      },
    },
  });

  assert.equal(creates, 0);
  assert.equal(accounts.length, 6);
  assert.equal(accounts[0].availableBalance, '123.45');
  assert.equal(accounts[0].frozenBalance, '6.78');
});

test('production ledger bootstrap rejects conflicting account identities', async () => {
  await assert.rejects(
    ensureSystemLedgerAccounts({
      account: {
        findUnique: async ({ where }) => ({
          id: 'conflict',
          accountNumber: where.accountNumber,
          customerId: 'customer_should_not_own_system_account',
          kind: 'SYSTEM_WALLET',
          currency: 'USD',
          status: 'ACTIVE',
        }),
      },
    }),
    /system_ledger_account_conflict:CLEARING-USD/
  );
});
