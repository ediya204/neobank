import { getCsrfToken, notifySessionExpired } from 'src/auth/csrf-token';
import { requiredRoleForPath } from 'src/auth/role-access';

export type Currency = 'USD' | 'SGD' | 'HKD' | 'EUR' | 'GBP' | 'USDT';
export type CryptoNetwork = 'TRON' | 'BSC' | 'ETHEREUM';
export type CryptoWalletStatus =
  | 'PENDING'
  | 'CREATING'
  | 'ACTIVE'
  | 'ERROR'
  | 'FROZEN'
  | 'CLOSED'
  | 'DISABLED';
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
  bankAddress?: string;
  bankCountry?: string;
  branchName?: string;
  swiftBic?: string;
  iban?: string;
  fundingChannelId?: string;
  walletAddress?: string;
  network?: string;
  availableBalance: string;
  frozenBalance: string;
};

export const supportedFiatCurrencies: Currency[] = ['USD', 'HKD'];
export const supportedCryptoNetwork: CryptoNetwork = 'TRON';
export const SYSTEM_WALLET_PRODUCT_NAME = 'SSC钱包';

export function accountProductName(account: MoneyAccount) {
  if (account.kind === 'SYSTEM_WALLET') return SYSTEM_WALLET_PRODUCT_NAME;
  if (account.kind === 'VIRTUAL_ACCOUNT') return 'VA 账户';
  if (account.kind === 'CRYPTO_WALLET') return '数字钱包';
  return account.name;
}

export function accountBalanceLabel(account: MoneyAccount) {
  return `${accountProductName(account)} · ${account.currency}`;
}

export function isSupportedPortalAccount(account: MoneyAccount) {
  if (supportedFiatCurrencies.includes(account.currency)) return true;
  return account.currency === 'USDT' && account.network === supportedCryptoNetwork;
}

export type AssetSource = 'balance_account' | 'virtual_account' | 'digital_wallet';

export type AssetDistributionItem = {
  currency: Currency;
  availableBalance: string;
  frozenBalance: string;
  totalBalance: string;
  reportingRate: string | null;
  reportingValue: string | null;
  shareBps: number;
  accountCount: number;
  sources: AssetSource[];
};

export type AssetSummary = {
  customerId: string;
  reportingCurrency: 'USD';
  valuationStatus: 'complete' | 'partial';
  missingRates: Currency[];
  asOf: string;
  ratesAsOf: string | null;
  balanceBasis: 'materialized_account_balances';
  totalAvailable: string;
  totalFrozen: string;
  totalBalance: string;
  accountCount: number;
  distribution: AssetDistributionItem[];
};

export type Customer = {
  id: string;
  organizationId: string;
  externalId?: string;
  type: 'INDIVIDUAL' | 'BUSINESS';
  status: string;
  displayName: string;
  legalName: string;
  email: string;
  phone?: string;
  phoneCountryCode?: string;
  countryCode: string;
  registrationNo?: string;
  dateOfBirth?: string;
  nationality?: string;
  contactName?: string;
  contactRole?: string;
  beneficialOwnerName?: string;
  beneficialOwnerOwnership?: string;
  kycStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  kycReviewerId?: string;
  kycReviewedAt?: string;
  kycReviewNote?: string;
  accounts: MoneyAccount[];
  walletCount?: number;
  walletStatus?: string;
  beneficiaries?: Beneficiary[];
  creatorId?: string;
  reviewerId?: string;
  reviewedAt?: string;
  reviewNote?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type VirtualAccountRequest = {
  id: string;
  customerId: string;
  currency: Currency;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  preferredCountry: string;
  purpose: string;
  channelId?: string;
  channel?: FundingChannel;
  requestSource?: 'ADMIN' | 'CUSTOMER';
  requesterEmail?: string;
  makerId: string;
  checkerId?: string;
  rejectionReason?: string;
  assignedAccount?: MoneyAccount;
  customer: Customer;
  maker?: { id: string; displayName: string };
  checker?: { id: string; displayName: string };
  createdAt: string;
  reviewedAt?: string;
  updatedAt?: string;
};

export type Beneficiary = {
  id: string;
  customerId: string;
  type: 'BANK' | 'CRYPTO';
  name: string;
  currency: Currency;
  bankName?: string;
  accountNumber?: string;
  swiftBic?: string;
  iban?: string;
  bankAddress?: string;
  countryCode?: string;
  walletAddress?: string;
  network?: CryptoNetwork;
  active: boolean;
  status?: 'ACTIVE' | 'REVOKED' | 'SUSPENDED';
  verifiedAt?: string;
  revokedAt?: string;
};

export type FundingChannel = {
  id: string;
  code: string;
  name: string;
  type: 'FIAT_INBOUND' | 'VIRTUAL_ACCOUNT' | 'VA_PAYOUT' | 'POBO_PAYOUT' | 'PLATFORM_PAYOUT';
  supportedCurrencies: Currency[];
  active: boolean;
  settlementBankName?: string;
  settlementAccount?: string;
  swiftBic?: string;
  bankCountry?: string;
  bankAddress?: string;
  branchName?: string;
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
  quoteExpiresAt?: string;
  quoteConfirmWindowMs?: number;
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
  marketProvider?: 'fastforex';
  marketPriceType?: 'midpoint_spot';
  marketRate?: string;
  customerRate?: string;
  marketUpdatedAt?: string;
  marketFetchedAt?: string;
  marketUnavailable?: boolean;
};

export type MarketQuote = {
  provider: 'fastforex';
  baseCurrency: Currency;
  quoteCurrency: Currency;
  rate: string;
  updatedAt: string;
  fetchedAt: string;
  priceType: 'midpoint_spot';
  referenceOnly: true;
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
  status: CryptoWalletStatus;
  availableBalance: string;
  frozenBalance: string;
  minimumDeposit: string;
  withdrawalFee: string;
  withdrawalFeeRuleVersion?: string;
  confirmationsRequired: number;
  custodyProvider?: 'CREGIS' | null;
  ownershipVerifiedAt?: string | null;
  depositEnabled?: boolean;
};

export type WithdrawalFeeRule = {
  id: string;
  organizationId?: string;
  customerId?: string;
  scope: 'ORGANIZATION' | 'CUSTOMER';
  assetClass: 'FIAT' | 'CRYPTO';
  currency: Currency;
  method: 'VA' | 'POBO' | 'PLATFORM' | 'ON_CHAIN';
  channelCode: string;
  network?: CryptoNetwork;
  amount: string;
  active: boolean;
  version: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt: string;
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

export type UsdtInboundRecord = {
  id: string;
  source: 'ON_CHAIN' | 'LOCAL_OTC';
  customerId: string;
  customerName: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXCEPTION';
  amount: string;
  asset: 'USDT';
  network: 'TRON';
  occurredAt: string;
  completedAt?: string | null;
  reference: string;
  txHash?: string | null;
  fromAddress?: string | null;
  toAddress?: string | null;
  sourceCurrency?: string | null;
  sourceAmount?: string | null;
  rate?: string | null;
  custodyStatus?: string | null;
  accountingStatus?: string | null;
  exceptionReason?: string | null;
  coreOperationId?: string | null;
};

export type UsdtInboundResponse = {
  data: UsdtInboundRecord[];
  pagination: { total: number; limit: number; offset: number };
  summary: {
    chain: number;
    localOtc: number;
    completed: number;
    processing: number;
    attention: number;
  };
};

const coreBaseUrl = process.env.REACT_APP_CORE_API_URL || '/api/v1';
const transientReadStatuses = new Set([502, 503, 504]);
const defaultRequestTimeoutMs = 10_000;
const maxReadAttempts = 2;
const apiBoundaryErrorMessages: Record<string, string> = {
  customer_core_route_forbidden: '账户资料暂时无法读取，请刷新账户或重新登录后重试。',
  authentication_required: '登录状态已失效，请重新登录。',
  session_role_required: '登录状态不完整，请重新登录。',
  admin_identity_incomplete: '管理员身份信息不完整，请重新登录。',
  admin_permission_required: '当前管理员账号没有执行此操作的权限。',
  service_unavailable: '服务暂时不可用，请稍后重试。',
  market_data_unavailable: '实时报价暂时不可用，请稍后重试。',
};

type ApiRequestInit = RequestInit & {
  userId?: string;
  timeoutMs?: number;
  onTransientRetry?: () => void;
};

export function apiErrorMessage(
  message: unknown,
  code: unknown,
  status: number,
  fallback = '请求失败'
) {
  if (typeof code === 'string' && apiBoundaryErrorMessages[code]) {
    return apiBoundaryErrorMessages[code];
  }
  if (typeof message === 'string' && message.trim()) return message;
  if (typeof code === 'string' && code.trim()) return code;
  return `${fallback} (${status})`;
}

function retryDelay(attempt: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 750 * (attempt + 1));
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error('请求超时，请稍后重试。');
    throw error;
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abortFromCaller);
  }
}

async function fetchWithTransientReadRetry(
  url: string,
  init: RequestInit,
  retryable: boolean,
  timeoutMs: number,
  onTransientRetry?: () => void,
  attempt = 0
): Promise<Response> {
  try {
    const response = await fetchWithTimeout(url, init, timeoutMs);
    const canRetry =
      retryable && transientReadStatuses.has(response.status) && attempt < maxReadAttempts - 1;
    if (!canRetry) return response;
    onTransientRetry?.();
    await response.body?.cancel();
  } catch (error) {
    if (!retryable || attempt >= maxReadAttempts - 1 || init.signal?.aborted) throw error;
    onTransientRetry?.();
  }
  await retryDelay(attempt);
  return fetchWithTransientReadRetry(
    url,
    init,
    retryable,
    timeoutMs,
    onTransientRetry,
    attempt + 1
  );
}

async function requestApi<T>(baseUrl: string, path: string, init?: ApiRequestInit): Promise<T> {
  const {
    userId = 'usr_admin',
    headers,
    timeoutMs = defaultRequestTimeoutMs,
    onTransientRetry,
    ...requestInit
  } = init || {};
  const method = (requestInit.method || 'GET').toUpperCase();
  const csrfToken = getCsrfToken();
  let sessionRole: 'admin' | 'customer' | null = null;
  if (baseUrl.startsWith('/api/core') && typeof window !== 'undefined') {
    const requiredRole = requiredRoleForPath(window.location.pathname);
    if (requiredRole === 'admin' || requiredRole === 'customer') sessionRole = requiredRole;
  }
  const response = await fetchWithTransientReadRetry(
    `${baseUrl}${path}`,
    {
      ...requestInit,
      credentials: 'include',
      cache: 'no-store',
      headers: {
        ...(requestInit.body ? { 'content-type': 'application/json' } : {}),
        ...(process.env.NODE_ENV === 'development' ? { 'x-user-id': userId } : {}),
        ...(sessionRole ? { 'X-Neobank-Session-Role': sessionRole } : {}),
        ...(method !== 'GET' && method !== 'HEAD' && csrfToken
          ? { 'X-CSRF-Token': csrfToken }
          : {}),
        ...headers,
      },
    },
    method === 'GET' || method === 'HEAD',
    timeoutMs,
    onTransientRetry
  );
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.toLowerCase().includes('application/json')
    ? await response.json().catch(() => null)
    : null;
  if (!response.ok) {
    const message = Array.isArray(payload?.message) ? payload.message.join('，') : payload?.message;
    const code = payload?.error?.code;
    if (
      response.status === 401 &&
      (code === 'session_expired' || code === 'authentication_required')
    ) {
      notifySessionExpired();
    }
    throw new Error(apiErrorMessage(message, code, response.status));
  }
  if (payload === null) {
    throw new Error('API 响应格式无效');
  }
  return payload as T;
}

export function coreApi<T>(path: string, init?: ApiRequestInit) {
  return requestApi<T>(coreBaseUrl, path, init);
}

export function neobankApi<T>(path: string, init?: ApiRequestInit) {
  return requestApi<T>('/api/v1', path, init);
}

export function customerAuthApi<T>(path: string, init?: ApiRequestInit) {
  return requestApi<T>('/api/auth/customer', path, init);
}

export const demoOrganizationId = process.env.REACT_APP_CORE_ORGANIZATION_ID || 'org_demo';
