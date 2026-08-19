import type { Customer, JournalEntry, Operation, VirtualAccountRequest } from './core-api';
import { buildOverviewAnalytics } from './overview-analytics';

const account = (input: Partial<Customer['accounts'][number]>) =>
  ({
    id: 'account',
    customerId: 'customer',
    kind: 'SYSTEM_WALLET',
    status: 'ACTIVE',
    currency: 'USD',
    name: 'Account',
    availableBalance: '0',
    frozenBalance: '0',
    ...input,
  }) as Customer['accounts'][number];

const customer = {
  id: 'customer',
  organizationId: 'organization',
  type: 'INDIVIDUAL',
  status: 'ACTIVE',
  displayName: 'Customer',
  legalName: 'Customer',
  email: 'customer@example.com',
  countryCode: 'HK',
  kycStatus: 'APPROVED',
  accounts: [
    account({ currency: 'USD', availableBalance: '100', frozenBalance: '5' }),
    account({
      id: 'va',
      kind: 'VIRTUAL_ACCOUNT',
      currency: 'USD',
      availableBalance: '50',
    }),
    account({
      id: 'crypto',
      kind: 'CRYPTO_WALLET',
      currency: 'USDT',
      network: 'TRON',
      availableBalance: '25',
    }),
  ],
} as Customer;

const operation = {
  id: 'operation',
  reference: 'OP-1',
  customerId: customer.id,
  type: 'DEPOSIT',
  status: 'COMPLETED',
  currency: 'USD',
  amount: '10',
  feeAmount: '0',
  customer,
  maker: { id: 'maker', displayName: 'Maker', email: 'maker@example.com' },
  createdAt: '2026-08-19T01:00:00.000Z',
  executedAt: '2026-08-19T01:00:00.000Z',
} as Operation;

function journal(input: {
  id: string;
  operationType?: Operation['type'];
  side: 'DEBIT' | 'CREDIT';
  value: string;
}) {
  return {
    id: input.id,
    reference: input.id,
    description: input.id,
    postedAt: '2026-08-19T01:00:00.000Z',
    operation: { ...operation, id: input.id, type: input.operationType || 'DEPOSIT' },
    lines: [
      {
        id: `line-${input.id}`,
        side: input.side,
        currency: 'USD',
        amount: input.value,
        account: customer.accounts[0],
      },
    ],
  } as JournalEntry;
}

describe('overview analytics', () => {
  it('keeps assets separate and groups balances by account product', () => {
    const result = buildOverviewAnalytics({
      customers: [customer],
      operations: [operation],
      vaRequests: [],
      journals: [],
      now: new Date('2026-08-19T02:00:00.000Z'),
    });

    expect(result.funds.find((fund) => fund.asset === 'USD')).toMatchObject({
      available: 150,
      frozen: 5,
      total: 155,
      accountCount: 2,
    });
    expect(result.funds.find((fund) => fund.asset === 'USDT')).toMatchObject({
      available: 25,
      frozen: 0,
      total: 25,
      accountCount: 1,
    });
  });

  it('uses customer-side ledger lines for seven-day inflow and outflow', () => {
    const result = buildOverviewAnalytics({
      customers: [customer],
      operations: [operation],
      vaRequests: [],
      journals: [
        journal({ id: 'credit', side: 'CREDIT', value: '12' }),
        journal({ id: 'debit', side: 'DEBIT', value: '3' }),
      ],
      now: new Date('2026-08-19T02:00:00.000Z'),
    });
    expect(result.trendByAsset.USD.at(-1)).toMatchObject({ inflow: 12, outflow: 3, net: 9 });
    expect(result.completedToday).toBe(2);
  });

  it('excludes internal transfers from turnover and counts actionable queues', () => {
    const pendingCustomer = {
      ...customer,
      id: 'pending',
      status: 'PENDING_REVIEW',
      kycStatus: 'PENDING',
    } as Customer;
    const submitted = { ...operation, id: 'submitted', status: 'SUBMITTED' } as Operation;
    const vaRequest = { status: 'SUBMITTED' } as VirtualAccountRequest;
    const result = buildOverviewAnalytics({
      customers: [customer, pendingCustomer],
      operations: [submitted],
      vaRequests: [vaRequest],
      journals: [
        journal({
          id: 'internal',
          operationType: 'INTERNAL_TRANSFER',
          side: 'CREDIT',
          value: '50',
        }),
      ],
      now: new Date('2026-08-19T02:00:00.000Z'),
    });

    expect(result.trendByAsset.USD.at(-1)).toMatchObject({ inflow: 0, outflow: 0, net: 0 });
    expect(result.queue).toMatchObject({ kyc: 1, va: 1, approvals: 1, total: 3 });
  });
});
