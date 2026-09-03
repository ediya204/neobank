import type { Customer, JournalEntry, Operation, VirtualAccountRequest } from './core-api';
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
    expect(snapshot.unbalancedJournals).toEqual([
      {
        id: 'journal_1',
        reference: 'JR-1',
        postedAt: '2026-08-20T02:00:00.000Z',
        deltas: [{ currency: 'USD', debits: 125.5, credits: 120, delta: 5.5 }],
      },
    ]);
    expect(snapshot.ledgerChecks[0]).toMatchObject({ delta: 5.5, balanced: false });
    expect(snapshot.completedWithoutJournal.map((row) => row.id)).toEqual(['op_2']);
  });

  it('reconciles one completed VA opening fee against its fee-revenue journal', () => {
    const feeRevenue = {
      ...account,
      id: 'fee_revenue_usd',
      customerId: null,
      kind: 'FEE_REVENUE' as const,
      name: 'USD fee revenue',
      availableBalance: '0',
      frozenBalance: '0',
    };
    const feeOperation = {
      ...operation,
      id: 'va_fee_completed',
      reference: 'VA-FEE-COMPLETED',
      type: 'VA_OPENING_FEE',
      amount: '25.00',
      sourceAccount: account,
      targetAccount: feeRevenue,
    } as Operation;
    const feeJournal = {
      id: 'va_fee_journal',
      reference: 'VA-FEE-COMPLETED-principal',
      description: 'VA opening fee',
      postedAt: feeOperation.executedAt!,
      operation: feeOperation,
      lines: [
        { id: 'fee_debit', side: 'DEBIT', currency: 'USD', amount: '25.00', account },
        { id: 'fee_credit', side: 'CREDIT', currency: 'USD', amount: '25.00', account: feeRevenue },
      ],
    } as JournalEntry;
    const request = {
      id: 'va_request_completed',
      customerId: customer.id,
      currency: 'USD',
      status: 'APPROVED',
      preferredCountry: 'HK',
      purpose: 'Receive payments',
      openingFeeUsd: '25.00',
      openingFeeVersion: '2',
      feeOperationId: feeOperation.id,
      feeOperation,
      createdAt: feeOperation.createdAt,
    } as VirtualAccountRequest;

    const snapshot = buildCoreReconciliationSnapshot({
      date: '2026-08-20',
      customers: [customer],
      operations: [feeOperation],
      journals: [feeJournal],
      virtualAccountRequests: [request],
    });

    expect(snapshot.vaOpeningFeeIssues).toEqual([]);
    expect(snapshot.completedVaOpeningFeeUsd).toBe(25);
    expect(snapshot.feeRevenueCreditUsd).toBe(25);
    expect(snapshot.outflows.USD).toBe(25);
  });

  it('reports invalid VA fee journals and undercovered submitted reservations', () => {
    const feeRevenue = {
      ...account,
      id: 'fee_revenue_usd',
      customerId: null,
      kind: 'FEE_REVENUE' as const,
      name: 'USD fee revenue',
      availableBalance: '0',
      frozenBalance: '0',
    };
    const source = { ...account, frozenBalance: '30.00' };
    const submittedOperation = {
      ...operation,
      id: 'va_fee_submitted',
      reference: 'VA-FEE-SUBMITTED',
      type: 'VA_OPENING_FEE',
      status: 'SUBMITTED',
      amount: '40.00',
      sourceAccount: source,
      targetAccount: feeRevenue,
    } as Operation;
    const completedOperation = {
      ...operation,
      id: 'va_fee_missing_journal',
      reference: 'VA-FEE-MISSING',
      type: 'VA_OPENING_FEE',
      amount: '25.00',
      sourceAccount: source,
      targetAccount: feeRevenue,
    } as Operation;
    const rejectedOperation = {
      ...operation,
      id: 'va_fee_rejected',
      reference: 'VA-FEE-REJECTED',
      type: 'VA_OPENING_FEE',
      status: 'REJECTED',
      amount: '10.00',
      sourceAccount: source,
      targetAccount: feeRevenue,
    } as Operation;
    const rejectedJournal = {
      id: 'rejected_fee_journal',
      reference: 'VA-FEE-REJECTED-principal',
      description: 'Unexpected VA fee journal',
      postedAt: operation.executedAt!,
      operation: rejectedOperation,
      lines: [
        { id: 'rejected_debit', side: 'DEBIT', currency: 'USD', amount: '10', account: source },
        {
          id: 'rejected_credit',
          side: 'CREDIT',
          currency: 'USD',
          amount: '10',
          account: feeRevenue,
        },
      ],
    } as JournalEntry;
    const request = (
      id: string,
      status: VirtualAccountRequest['status'],
      feeOperation: Operation
    ) =>
      ({
        id,
        customerId: customer.id,
        currency: 'USD',
        status,
        preferredCountry: 'HK',
        purpose: 'Receive payments',
        openingFeeUsd: feeOperation.amount,
        openingFeeVersion: '1',
        feeOperationId: feeOperation.id,
        feeOperation,
        createdAt: feeOperation.createdAt,
      }) as VirtualAccountRequest;

    const snapshot = buildCoreReconciliationSnapshot({
      date: '2026-08-20',
      customers: [{ ...customer, accounts: [source] }],
      operations: [submittedOperation, completedOperation, rejectedOperation],
      journals: [
        rejectedJournal,
        {
          ...rejectedJournal,
          id: 'rejected_fee_journal_duplicate',
          reference: 'VA-FEE-REJECTED-duplicate',
        },
      ],
      virtualAccountRequests: [
        request('va_request_submitted', 'SUBMITTED', submittedOperation),
        request('va_request_completed', 'APPROVED', completedOperation),
        request('va_request_rejected', 'REJECTED', rejectedOperation),
      ],
    });

    expect(snapshot.vaOpeningFeeIssues.map((issue) => issue.reason)).toEqual(
      expect.arrayContaining([
        'submitted_reservation_undercovered',
        'completed_journal_missing',
        'terminal_journal_unexpected',
        'duplicate_journals',
        'fee_revenue_total_mismatch',
      ])
    );
  });
});
