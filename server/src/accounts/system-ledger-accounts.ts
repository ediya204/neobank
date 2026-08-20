import { AccountKind, AccountStatus, Currency, Prisma } from '@prisma/client';

type SystemLedgerAccountDefinition = {
  accountNumber: string;
  kind: AccountKind;
  currency: Currency;
  name: string;
};

export const systemLedgerAccountDefinitions: SystemLedgerAccountDefinition[] = [
  {
    accountNumber: 'CLEARING-USD',
    kind: AccountKind.PLATFORM_CLEARING,
    currency: Currency.USD,
    name: 'USD 平台清算账户',
  },
  {
    accountNumber: 'FEES-USD',
    kind: AccountKind.FEE_REVENUE,
    currency: Currency.USD,
    name: 'USD 手续费收入',
  },
  {
    accountNumber: 'CLEARING-HKD',
    kind: AccountKind.PLATFORM_CLEARING,
    currency: Currency.HKD,
    name: 'HKD 平台清算账户',
  },
  {
    accountNumber: 'FEES-HKD',
    kind: AccountKind.FEE_REVENUE,
    currency: Currency.HKD,
    name: 'HKD 手续费收入',
  },
  {
    accountNumber: 'CLEARING-USDT',
    kind: AccountKind.PLATFORM_CLEARING,
    currency: Currency.USDT,
    name: 'USDT 平台清算账户',
  },
  {
    accountNumber: 'FEES-USDT',
    kind: AccountKind.FEE_REVENUE,
    currency: Currency.USDT,
    name: 'USDT 手续费收入',
  },
];

export async function ensureSystemLedgerAccounts(tx: Prisma.TransactionClient) {
  const accounts = [];
  for (const definition of systemLedgerAccountDefinitions) {
    const existing = await tx.account.findUnique({
      where: { accountNumber: definition.accountNumber },
    });
    if (existing) {
      if (
        existing.customerId !== null ||
        existing.kind !== definition.kind ||
        existing.currency !== definition.currency ||
        existing.status !== AccountStatus.ACTIVE
      ) {
        throw new Error(`system_ledger_account_conflict:${definition.accountNumber}`);
      }
      accounts.push(existing);
      continue;
    }

    accounts.push(
      await tx.account.create({
        data: {
          accountNumber: definition.accountNumber,
          kind: definition.kind,
          status: AccountStatus.ACTIVE,
          currency: definition.currency,
          name: definition.name,
          availableBalance: 0,
          frozenBalance: 0,
        },
      })
    );
  }
  return accounts;
}
