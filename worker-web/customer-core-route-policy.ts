function hasOnlySearchParams(url: URL, allowed: ReadonlySet<string>) {
  let allowedOnly = true;
  url.searchParams.forEach((_value, key) => {
    if (!allowed.has(key)) allowedOnly = false;
  });
  return allowedOnly;
}

const customerReadableChannelTypes = new Set([
  'VIRTUAL_ACCOUNT',
  'FIAT_INBOUND',
  'POBO_PAYOUT',
  'PLATFORM_PAYOUT',
]);

const CUSTOMER_CORE_INTERNAL_FIELDS = new Set([
  'creatorId',
  'reviewerId',
  'checkerId',
  'operatorId',
  'makerId',
  'kycReviewerId',
  'kycReviewNote',
  'reviewNote',
  'operatorNote',
  'openingFeeUpdatedBy',
  'idempotencyKey',
  'maker',
  'checker',
  'operator',
]);

function safeVaOpeningFeeMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const fee = (value as Record<string, unknown>).vaOpeningFee;
  if (!fee || typeof fee !== 'object' || Array.isArray(fee)) return undefined;
  const source = fee as Record<string, unknown>;
  const safe = Object.fromEntries(
    ['requestId', 'channelCode', 'bankName', 'version', 'reservedAt']
      .filter((key) => typeof source[key] === 'string')
      .map((key) => [key, source[key]])
  );
  return Object.keys(safe).length ? { vaOpeningFee: safe } : undefined;
}

export function redactCustomerCorePayload(value: unknown, customerId: string): unknown {
  if (Array.isArray(value)) return value.map((item) => redactCustomerCorePayload(item, customerId));
  if (!value || typeof value !== 'object') return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (CUSTOMER_CORE_INTERNAL_FIELDS.has(key)) continue;
    if (key === 'metadata') {
      const metadata = safeVaOpeningFeeMetadata(item);
      if (metadata) redacted[key] = metadata;
      continue;
    }
    if (key === 'targetAccount' && item && typeof item === 'object') {
      const account = item as Record<string, unknown>;
      if (account.customerId !== customerId) {
        redacted[key] = { kind: account.kind, currency: account.currency };
        continue;
      }
    }
    redacted[key] = redactCustomerCorePayload(item, customerId);
  }
  return redacted;
}

export function customerCoreRouteAllowed(
  url: URL,
  method: string,
  customerId: string,
  organizationId: string
) {
  if (method === 'POST' && url.pathname === '/api/core/operations/quote') {
    return hasOnlySearchParams(url, new Set());
  }
  if (method === 'POST' && url.pathname === '/api/core/operations') {
    return hasOnlySearchParams(url, new Set());
  }
  if (method === 'POST' && /^\/api\/core\/operations\/[^/]+\/confirm$/.test(url.pathname)) {
    return hasOnlySearchParams(url, new Set());
  }
  if (url.pathname === '/api/core/funding-channels' && method === 'GET') {
    const type = url.searchParams.get('type');
    return (
      url.searchParams.get('organizationId') === organizationId &&
      type !== null &&
      customerReadableChannelTypes.has(type) &&
      url.searchParams.get('active') === 'true' &&
      hasOnlySearchParams(url, new Set(['organizationId', 'type', 'active']))
    );
  }
  if (url.pathname === '/api/core/withdrawal-fees' && method === 'GET') {
    return (
      url.searchParams.get('organizationId') === organizationId &&
      url.searchParams.get('active') === 'true' &&
      hasOnlySearchParams(url, new Set(['organizationId', 'active']))
    );
  }
  const ownRequests = `/api/core/customers/${customerId}/virtual-account-requests`;
  if (url.pathname === ownRequests) return method === 'GET' || method === 'POST';
  const cancellation = url.pathname.match(
    /^\/api\/core\/customers\/([^/]+)\/virtual-account-requests\/[^/]+\/cancel$/
  );
  if (cancellation) {
    return (
      method === 'PATCH' && cancellation[1] === customerId && hasOnlySearchParams(url, new Set())
    );
  }
  if (method !== 'GET') return false;
  if (url.pathname === `/api/core/customers/${customerId}`) {
    return hasOnlySearchParams(url, new Set());
  }
  if (url.pathname === '/api/core/accounts/summary') {
    return (
      url.searchParams.get('customerId') === customerId &&
      hasOnlySearchParams(url, new Set(['customerId']))
    );
  }
  if (url.pathname === '/api/core/operations') {
    const limit = url.searchParams.get('limit');
    return (
      url.searchParams.get('organizationId') === organizationId &&
      url.searchParams.get('customerId') === customerId &&
      (limit === null || limit === '5') &&
      hasOnlySearchParams(url, new Set(['organizationId', 'customerId', 'limit']))
    );
  }
  if (url.pathname === '/api/core/crypto-wallets/transfers') {
    return (
      url.searchParams.get('customerId') === customerId &&
      hasOnlySearchParams(url, new Set(['customerId', 'direction', 'status']))
    );
  }
  if (url.pathname === '/api/core/rates') {
    const type = url.searchParams.get('type');
    return (
      (type === null || type === 'FX' || type === 'OTC') &&
      hasOnlySearchParams(url, new Set(['type']))
    );
  }
  return false;
}
