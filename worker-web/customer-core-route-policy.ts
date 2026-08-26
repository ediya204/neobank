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
