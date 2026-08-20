import type { Customer, JournalEntry, Operation } from './core-api';
import { buildCoreReconciliationSnapshot } from './core-reconciliation';

const operation = {
  id: 'op_1',
  reference: 'OP-1',
  customerId: 'customer_1',
  type: 'DEPOSIT',
  status: 'COMPLETED',
  currency: 'USD',
  amount: '125.50',
  feeAmount: '0',
  customer: { id: 'customer_1', displayName: 'Test Customer' },
  maker: { id: 'maker_1', displayName: 'Maker', email: 'maker@example.test' },
  createdAt: '2026-08-20T01:00:00.000Z',
  executedAt: '2026-08-20T02:00:00.000Z',
} as Operation;

const account = {
  id: 'account_1',
  customerId: 'customer_1',
  kind: 'SYSTEM_WALLET',
  status: 'ACTIVE',
  currency: 'USD',
  name: 'USD account',
  availableBalance: '100.50',
  frozenBalance: '25',
} as const;

const customer = {
  id: 'customer_1',
  organizationId: 'org_neobank',
  type: 'INDIVIDUAL',
  status: 'ACTIVE',
  displayName: 'Test Customer',
  legalName: 'Test Customer',
  email: 'test@example.test',
  countryCode: 'HK',
  kycStatus: 'APPROVED',
  accounts: [account],
} as Customer;

function journal(creditAmount = '125.50') {
  return {
    id: 'journal_1',
    reference: 'JR-1',
    description: 'Deposit',
    postedAt: '2026-08-20T02:00:00.000Z',
    operation,
    lines: [
      { id: 'line_1', side: 'DEBIT', currency: 'USD', amount: '125.50', account },
      { id: 'line_2', side: 'CREDIT', currency: 'USD', amount: creditAmount, account },
    ],
  } as JournalEntry;
}

describe('buildCoreReconciliationSnapshot', () => {
  it('summarizes balances, movements, inflows and a balanced journal', () => {
    const snapshot = buildCoreReconciliationSnapshot({
      date: '2026-08-20',
      customers: [customer],
      operations: [operation],
      journals: [journal()],
    });

    expect(snapshot.balances).toEqual([
      { currency: 'USD', available: 100.5, frozen: 25, total: 125.5, accountCount: 1 },
    ]);
    expect(snapshot.movements).toHaveLength(1);
    expect(snapshot.inflows.USD).toBe(125.5);
    expect(snapshot.ledgerChecks[0]).toMatchObject({
      currency: 'USD',
      debits: 125.5,
      credits: 125.5,
      delta: 0,
      balanced: true,
    });
    expect(snapshot.unbalancedJournalCount).toBe(0);
    expect(snapshot.completedWithoutJournal).toHaveLength(0);
  });

  it('reports unbalanced journals and completed operations without a journal', () => {
    const missingJournalOperation = { ...operation, id: 'op_2', reference: 'OP-2' };
    const snapshot = buildCoreReconciliationSnapshot({
      date: '2026-08-20',
      customers: [customer],
      operations: [operation, missingJournalOperation],
      journals: [journal('120')],
    });

    expect(snapshot.unbalancedJournalCount).toBe(1);
    expect(snapshot.ledgerChecks[0]).toMatchObject({ delta: 5.5, balanced: false });
    expect(snapshot.completedWithoutJournal.map((row) => row.id)).toEqual(['op_2']);
  });
});
