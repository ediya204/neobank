import type { Currency, Customer, JournalEntry, Operation } from './core-api';

const ACTIVE_OPERATION_STATUSES = new Set<Operation['status']>([
  'SUBMITTED',
  'APPROVED',
  'PROCESSING',
]);

const EPSILON = 0.000001;

export type ReconciliationBalance = {
  currency: Currency;
  available: number;
  frozen: number;
  total: number;
  accountCount: number;
};

export type ReconciliationLedgerCheck = {
  currency: Currency;
  debits: number;
  credits: number;
  delta: number;
  journalCount: number;
  balanced: boolean;
};

export type ReconciliationJournalIssue = {
  id: string;
  reference: string;
  postedAt: string;
  deltas: Array<{
    currency: Currency;
    debits: number;
    credits: number;
    delta: number;
  }>;
};

export type CoreReconciliationSnapshot = {
  balances: ReconciliationBalance[];
  ledgerChecks: ReconciliationLedgerCheck[];
  movements: Operation[];
  journalCount: number;
  unbalancedJournalCount: number;
  unbalancedJournals: ReconciliationJournalIssue[];
  completedWithoutJournal: Operation[];
  pendingOperations: Operation[];
  inflows: Partial<Record<Currency, number>>;
  outflows: Partial<Record<Currency, number>>;
};

function hongKongDate(value: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function operationTime(operation: Operation) {
  return operation.executedAt || operation.submittedAt || operation.createdAt;
}

function addAmount(target: Partial<Record<Currency, number>>, currency: Currency, amount: number) {
  target[currency] = (target[currency] || 0) + amount;
}

export function buildCoreReconciliationSnapshot({
  date,
  customers,
  operations,
  journals,
}: {
  date: string;
  customers: Customer[];
  operations: Operation[];
  journals: JournalEntry[];
}): CoreReconciliationSnapshot {
  const balanceMap = new Map<Currency, ReconciliationBalance>();
  customers.forEach((customer) => {
    customer.accounts.forEach((account) => {
      if (account.kind === 'PLATFORM_CLEARING' || account.kind === 'FEE_REVENUE') return;
      const available = Number(account.availableBalance || 0);
      const frozen = Number(account.frozenBalance || 0);
      const current = balanceMap.get(account.currency) || {
        currency: account.currency,
        available: 0,
        frozen: 0,
        total: 0,
        accountCount: 0,
      };
      current.available += available;
      current.frozen += frozen;
      current.total += available + frozen;
      current.accountCount += 1;
      balanceMap.set(account.currency, current);
    });
  });

  const selectedJournals = journals.filter((journal) => hongKongDate(journal.postedAt) === date);
  const ledgerMap = new Map<Currency, ReconciliationLedgerCheck>();
  const unbalancedJournals: ReconciliationJournalIssue[] = [];
  selectedJournals.forEach((journal) => {
    const journalCurrencyTotals = new Map<Currency, { debits: number; credits: number }>();
    journal.lines.forEach((line) => {
      const amount = Number(line.amount || 0);
      const current = ledgerMap.get(line.currency) || {
        currency: line.currency,
        debits: 0,
        credits: 0,
        delta: 0,
        journalCount: 0,
        balanced: true,
      };
      current[line.side === 'DEBIT' ? 'debits' : 'credits'] += amount;
      ledgerMap.set(line.currency, current);

      const journalTotals = journalCurrencyTotals.get(line.currency) || { debits: 0, credits: 0 };
      journalTotals[line.side === 'DEBIT' ? 'debits' : 'credits'] += amount;
      journalCurrencyTotals.set(line.currency, journalTotals);
    });
    const deltas = Array.from(journalCurrencyTotals.entries())
      .map(([currency, row]) => ({
        currency,
        debits: row.debits,
        credits: row.credits,
        delta: row.debits - row.credits,
      }))
      .filter((row) => Math.abs(row.delta) > EPSILON);
    if (deltas.length) {
      unbalancedJournals.push({
        id: journal.id,
        reference: journal.reference,
        postedAt: journal.postedAt,
        deltas,
      });
    }
  });
  ledgerMap.forEach((row) => {
    row.delta = row.debits - row.credits;
    row.balanced = Math.abs(row.delta) <= EPSILON;
    row.journalCount = selectedJournals.filter((journal) =>
      journal.lines.some((line) => line.currency === row.currency)
    ).length;
  });

  const movements = operations
    .filter((operation) => hongKongDate(operationTime(operation)) === date)
    .sort((left, right) => operationTime(right).localeCompare(operationTime(left)));
  const journalOperationIds = new Set(journals.map((journal) => journal.operation.id));
  const completedWithoutJournal = movements.filter(
    (operation) => operation.status === 'COMPLETED' && !journalOperationIds.has(operation.id)
  );
  const pendingOperations = operations.filter((operation) =>
    ACTIVE_OPERATION_STATUSES.has(operation.status)
  );
  const inflows: Partial<Record<Currency, number>> = {};
  const outflows: Partial<Record<Currency, number>> = {};
  movements
    .filter((operation) => operation.status === 'COMPLETED')
    .forEach((operation) => {
      if (operation.type === 'DEPOSIT') {
        addAmount(inflows, operation.currency, Number(operation.amount || 0));
      } else if (operation.type === 'PAYOUT') {
        addAmount(outflows, operation.currency, Number(operation.amount || 0));
      } else if (operation.type === 'FX' || operation.type === 'OTC') {
        addAmount(outflows, operation.currency, Number(operation.amount || 0));
        if (operation.quoteCurrency && operation.quoteAmount) {
          addAmount(inflows, operation.quoteCurrency, Number(operation.quoteAmount));
        }
      }
    });

  const currencyOrder: Currency[] = ['USD', 'HKD', 'USDT', 'SGD', 'EUR', 'GBP'];
  const byCurrency = <T extends { currency: Currency }>(left: T, right: T) =>
    currencyOrder.indexOf(left.currency) - currencyOrder.indexOf(right.currency);

  return {
    balances: Array.from(balanceMap.values()).sort(byCurrency),
    ledgerChecks: Array.from(ledgerMap.values()).sort(byCurrency),
    movements,
    journalCount: selectedJournals.length,
    unbalancedJournalCount: unbalancedJournals.length,
    unbalancedJournals,
    completedWithoutJournal,
    pendingOperations,
    inflows,
    outflows,
  };
}
