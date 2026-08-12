export type Currency = 'USD' | 'SGD' | 'HKD' | 'EUR' | 'GBP' | 'USDT';
export type CryptoNetwork = 'TRON' | 'BSC' | 'ETHEREUM';
export type OperationType =
  | 'DEPOSIT'
  | 'PAYOUT'
  | 'ADJUSTMENT'
  | 'INTERNAL_TRANSFER'
  | 'FX'
  | 'OTC';

export type MoneyAccount = {
  id: string;
  customerId: string | null;
  kind: 'SYSTEM_WALLET' | 'VIRTUAL_ACCOUNT' | 'CRYPTO_WALLET' | 'PLATFORM_CLEARING' | 'FEE_REVENUE';
  status: 'PENDING' | 'ACTIVE' | 'FROZEN' | 'CLOSED' | 'DISABLED';
  currency: Currency;
  name: string;
  accountNumber?: string;
  bankName?: string;
  swiftBic?: string;
  walletAddress?: string;
  network?: string;
  availableBalance: string;
  frozenBalance: string;
};

export type Customer = {
  id: string;
  organizationId: string;
  type: 'INDIVIDUAL' | 'BUSINESS';
  status: string;
  displayName: string;
  legalName: string;
  email: string;
  countryCode: string;
  accounts: MoneyAccount[];
  beneficiaries?: Beneficiary[];
  creatorId?: string;
  reviewerId?: string;
  reviewedAt?: string;
  reviewNote?: string;
};

export type VirtualAccountRequest = {
  id: string;
  customerId: string;
  currency: Currency;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  preferredCountry: string;
  purpose: string;
  makerId: string;
  checkerId?: string;
  rejectionReason?: string;
  assignedAccount?: MoneyAccount;
  customer: Customer;
  maker?: { id: string; displayName: string };
  checker?: { id: string; displayName: string };
  createdAt: string;
};

export type Beneficiary = {
  id: string;
  customerId: string;
  name: string;
  currency: Currency;
  bankName: string;
  accountNumber: string;
  swiftBic?: string;
};

export type FundingChannel = {
  id: string;
  code: string;
  name: string;
  type: 'FIAT_INBOUND' | 'VA_PAYOUT' | 'POBO_PAYOUT' | 'PLATFORM_PAYOUT';
  supportedCurrencies: Currency[];
  active: boolean;
  settlementBankName?: string;
  settlementAccount?: string;
  swiftBic?: string;
};

export type Operation = {
  id: string;
  reference: string;
  customerId: string;
  type: OperationType;
  status:
    | 'DRAFT'
    | 'SUBMITTED'
    | 'APPROVED'
    | 'REJECTED'
    | 'PROCESSING'
    | 'COMPLETED'
    | 'FAILED'
    | 'CANCELLED';
  currency: Currency;
  amount: string;
  feeAmount: string;
  payoutMethod?: 'VA' | 'POBO' | 'PLATFORM';
  quoteCurrency?: Currency;
  quoteAmount?: string;
  rate?: string;
  remitterName?: string;
  remittanceReference?: string;
  rejectionReason?: string;
  externalReference?: string;
  narrative?: string;
  customer: Customer;
  sourceAccount?: MoneyAccount;
  targetAccount?: MoneyAccount;
  beneficiary?: Beneficiary;
  channel?: FundingChannel;
  maker: { id: string; displayName: string; email: string };
  checker?: { id: string; displayName: string; email: string };
  operator?: { id: string; displayName: string; email: string };
  createdAt: string;
  submittedAt?: string;
  approvedAt?: string;
  executedAt?: string;
};

export type RateVersion = {
  id: string;
  type: 'FX' | 'OTC';
  baseCurrency: Currency;
  quoteCurrency: Currency;
  buyRate: string;
  sellRate: string;
  feeBps: number;
  effectiveFrom: string;
  effectiveUntil?: string;
  active: boolean;
};

export type JournalEntry = {
  id: string;
  reference: string;
  description: string;
  postedAt: string;
  operation: Operation;
  lines: Array<{
    id: string;
    side: 'DEBIT' | 'CREDIT';
    currency: Currency;
    amount: string;
    account: MoneyAccount;
  }>;
};

export type CryptoWallet = {
  id: string;
  customerId: string;
  asset: 'USDT';
  network: CryptoNetwork;
  networkLabel: string;
  tokenStandard: string;
  walletAddress: string;
  status: 'PENDING' | 'ACTIVE' | 'FROZEN' | 'CLOSED' | 'DISABLED';
  availableBalance: string;
  frozenBalance: string;
  minimumDeposit: string;
  withdrawalFee: string;
  confirmationsRequired: number;
};

export type CryptoTransfer = {
  id: string;
  reference: string;
  customerId: string;
  walletId: string;
  asset: 'USDT';
  network: CryptoNetwork;
  direction: 'DEPOSIT' | 'WITHDRAWAL';
  status: 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED' | 'FAILED';
  amount: string;
  feeAmount: string;
  netAmount: string;
  fromAddress: string;
  toAddress: string;
  txHash?: string;
  confirmations: number;
  rejectionReason?: string;
  submittedAt: string;
  approvedAt?: string;
  completedAt?: string;
  createdAt: string;
  wallet: CryptoWallet;
  maker?: { id: string; displayName: string };
  checker?: { id: string; displayName: string };
  operator?: { id: string; displayName: string };
};

const baseUrl = process.env.REACT_APP_CORE_API_URL || 'http://localhost:4000/api/v1';

export async function coreApi<T>(
  path: string,
  init?: RequestInit & { userId?: string }
): Promise<T> {
  const { userId = 'usr_maker', headers, ...requestInit } = init || {};
  const response = await fetch(`${baseUrl}${path}`, {
    ...requestInit,
    headers: {
      'content-type': 'application/json',
      'x-user-id': userId,
      ...headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(payload?.message) ? payload.message.join('，') : payload?.message;
    throw new Error(message || `请求失败 (${response.status})`);
  }
  return payload as T;
}

export const demoOrganizationId = 'org_demo';

export const demoUsers = [
  { id: 'usr_maker', label: '提交人 Maker' },
  { id: 'usr_checker', label: '复核人 Checker' },
  { id: 'usr_operator', label: '出款操作员' },
  { id: 'usr_admin', label: '平台管理员' },
] as const;
