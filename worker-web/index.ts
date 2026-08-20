const MAX_BODY_BYTES = 128 * 1024;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function rateLimitKey(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function enforceAuthRateLimit(
  request: Request,
  env: Env,
  pathname: string,
  body: ArrayBuffer
): Promise<Response | null> {
  if (request.method !== 'POST' || !pathname.startsWith('/api/auth/')) return null;
  const limiter =
    pathname.startsWith('/api/auth/admin/') || pathname === '/api/auth/setup-token'
      ? env.ADMIN_AUTH_RATE_LIMITER
      : env.CUSTOMER_AUTH_RATE_LIMITER;
  const source = request.headers.get('cf-connecting-ip')?.trim() || 'unknown-source';
  const sourceResult = await limiter.limit({
    key: await rateLimitKey(`source\0${source}\0${pathname}`),
  });
  if (!sourceResult.success) return json({ error: { code: 'auth_rate_limited' } }, 429);

  if (pathname.endsWith('/login') || pathname === '/api/auth/customer/register') {
    let email = '';
    try {
      const payload = JSON.parse(new TextDecoder().decode(body)) as { email?: unknown };
      email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    } catch {
      // The Go API returns the canonical invalid-JSON response. The source
      // bucket above still limits malformed credential-stuffing traffic.
    }
    if (email) {
      const identityResult = await limiter.limit({
        key: await rateLimitKey(`identity\0${email}`),
      });
      if (!identityResult.success) return json({ error: { code: 'auth_rate_limited' } }, 429);
    }
  }
  return null;
}

async function proxyAPI(request: Request, env: Env, edgeUser: string): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > MAX_BODY_BYTES) return json({ error: { code: 'payload_too_large' } }, 413);
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return json({ error: { code: 'payload_too_large' } }, 413);

  const incoming = new URL(request.url);
  const rateLimited = await enforceAuthRateLimit(request, env, incoming.pathname, body);
  if (rateLimited) return rateLimited;
  const upstreamOrigin = new URL(env.GO_API_BASE_URL);
  if (upstreamOrigin.protocol !== 'https:' || upstreamOrigin.pathname !== '/') {
    throw new Error('GO_API_BASE_URL must be an HTTPS origin');
  }
  const upstream = new URL(incoming.pathname + incoming.search, upstreamOrigin);
  const bodyHash = await crypto.subtle.digest('SHA-256', body);
  const bodyHashHex = Array.from(new Uint8Array(bodyHash), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const canonical = [
    timestamp,
    request.method,
    incoming.pathname + incoming.search,
    edgeUser,
    bodyHashHex,
  ].join('\n');
  const signature = await hmacHex(env.GO_EDGE_SHARED_SECRET, canonical);
  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const origin = request.headers.get('origin');
  if (origin) headers.set('origin', origin);
  const csrfToken = request.headers.get('x-csrf-token');
  if (csrfToken) headers.set('x-csrf-token', csrfToken);
  const idempotencyKey = request.headers.get('idempotency-key');
  if (idempotencyKey) headers.set('idempotency-key', idempotencyKey);
  if (incoming.pathname === '/api/webhooks/sumsub') {
    const payloadDigest = request.headers.get('x-payload-digest');
    const payloadDigestAlgorithm = request.headers.get('x-payload-digest-alg');
    if (payloadDigest) headers.set('x-payload-digest', payloadDigest);
    if (payloadDigestAlgorithm) headers.set('x-payload-digest-alg', payloadDigestAlgorithm);
  }
  if (incoming.pathname === '/api/auth/setup-token') {
    const authorization = request.headers.get('authorization');
    if (authorization) headers.set('authorization', authorization);
  }
  headers.set('accept', 'application/json');
  headers.set('x-neobank-user', edgeUser);
  headers.set('x-neobank-edge-timestamp', timestamp);
  headers.set('x-neobank-edge-signature', signature);

  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
    redirect: 'manual',
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Go API redirect rejected (${response.status})`);
  }
  const responseHeaders = new Headers();
  responseHeaders.set('cache-control', 'no-store');
  responseHeaders.set('content-type', response.headers.get('content-type') || 'application/json');
  for (const cookieValue of response.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', cookieValue);
  }
  return new Response(response.body, { status: response.status, headers: responseHeaders });
}

type ApplicationSessionPayload = {
  csrf_token?: unknown;
  user?: {
    id?: unknown;
    core_user_id?: unknown;
    email?: unknown;
    role?: unknown;
    access_role?: unknown;
    permissions?: unknown;
  };
};

const ADMIN_PERMISSIONS = {
  users: 'admin_users.manage',
  customerRead: 'customers.read',
  customerReview: 'customers.review',
  fundsRead: 'funds.read',
  fundsManage: 'funds.manage',
  settings: 'settings.manage',
  reports: 'reports.read',
} as const;

function requiredAdminCorePermission(pathname: string, method: string): string | null {
  const readOnly = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  if (pathname === '/api/core/customers' || pathname.startsWith('/api/core/customers/')) {
    return readOnly ? ADMIN_PERMISSIONS.customerRead : ADMIN_PERMISSIONS.customerReview;
  }
  if (
    pathname === '/api/core/virtual-account-requests' ||
    pathname.startsWith('/api/core/virtual-account-requests/')
  ) {
    return readOnly ? ADMIN_PERMISSIONS.customerRead : ADMIN_PERMISSIONS.customerReview;
  }
  if (
    pathname === '/api/core/funding-channels' ||
    pathname.startsWith('/api/core/funding-channels/') ||
    pathname === '/api/core/rates' ||
    pathname.startsWith('/api/core/rates/') ||
    pathname === '/api/core/withdrawal-fees' ||
    pathname.startsWith('/api/core/withdrawal-fees/')
  ) {
    return readOnly ? ADMIN_PERMISSIONS.fundsRead : ADMIN_PERMISSIONS.settings;
  }
  if (
    pathname === '/api/core/accounts' ||
    pathname.startsWith('/api/core/accounts/') ||
    pathname === '/api/core/operations' ||
    pathname.startsWith('/api/core/operations/') ||
    pathname === '/api/core/crypto-wallets' ||
    pathname.startsWith('/api/core/crypto-wallets/') ||
    pathname === '/api/core/beneficiaries' ||
    pathname.startsWith('/api/core/beneficiaries/')
  ) {
    return readOnly ? ADMIN_PERMISSIONS.fundsRead : ADMIN_PERMISSIONS.fundsManage;
  }
  if (pathname === '/api/core/ledger' || pathname.startsWith('/api/core/ledger/')) {
    return ADMIN_PERMISSIONS.reports;
  }
  return null;
}

type LiveMarketQuote = {
  provider: 'fastforex';
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  updatedAt: string;
  fetchedAt: string;
  priceType: 'midpoint_spot';
  referenceOnly: true;
};

type CustomerWalletSummaryRow = {
  id?: unknown;
  status?: unknown;
  available_balance?: unknown;
  frozen_balance?: unknown;
};

async function fetchCustomerWalletSummary(request: Request, env: Env) {
  const walletURL = new URL('/api/v1/customer/wallets', request.url);
  const walletHeaders = new Headers({ accept: 'application/json' });
  const cookie = request.headers.get('cookie');
  if (cookie) walletHeaders.set('cookie', cookie);
  const response = await proxyAPI(
    new Request(walletURL, { method: 'GET', headers: walletHeaders }),
    env,
    'application-session-edge'
  );
  if (!response.ok) throw new Error(`customer_wallets_unavailable:${response.status}`);
  const payload = (await response.json()) as { data?: unknown };
  if (!Array.isArray(payload.data)) throw new Error('invalid_customer_wallet_response');
  return payload.data as CustomerWalletSummaryRow[];
}

async function constantTimeTextEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  return crypto.subtle.timingSafeEqual(leftHash, rightHash);
}

async function loadApplicationSession(
  request: Request,
  env: Env
): Promise<ApplicationSessionPayload | null> {
  const upstreamOrigin = new URL(env.GO_API_BASE_URL);
  if (upstreamOrigin.protocol !== 'https:' || upstreamOrigin.pathname !== '/') {
    throw new Error('GO_API_BASE_URL must be an HTTPS origin');
  }
  const upstream = new URL('/api/auth/me', upstreamOrigin);
  const bodyHashHex = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array()))
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const edgeUser = 'application-session-edge';
  const canonical = [timestamp, 'GET', '/api/auth/me', edgeUser, bodyHashHex].join('\n');
  const signature = await hmacHex(env.GO_EDGE_SHARED_SECRET, canonical);
  const headers = new Headers({
    accept: 'application/json',
    'x-neobank-user': edgeUser,
    'x-neobank-edge-timestamp': timestamp,
    'x-neobank-edge-signature': signature,
  });
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(upstream, { headers, redirect: 'manual' });
    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/json')) return null;
      return (await response.json()) as ApplicationSessionPayload;
    }
    const retryable = response.status === 401 || [502, 503, 504].includes(response.status);
    if (!retryable || attempt === 2) return null;
    await new Promise((resolve) => setTimeout(resolve, 75 * (attempt + 1)));
  }
  return null;
}

async function fetchLiveMarketQuote(
  request: Request,
  env: Env,
  role: string,
  baseCurrency: string,
  quoteCurrency: string
): Promise<LiveMarketQuote> {
  const route = role === 'customer' ? '/api/v1/customer/market-rate' : '/api/v1/admin/market-rate';
  const marketURL = new URL(route, request.url);
  marketURL.searchParams.set('base', baseCurrency);
  marketURL.searchParams.set('quote', quoteCurrency);
  const marketHeaders = new Headers({ accept: 'application/json' });
  const cookie = request.headers.get('cookie');
  if (cookie) marketHeaders.set('cookie', cookie);
  const response = await proxyAPI(
    new Request(marketURL, { method: 'GET', headers: marketHeaders }),
    env,
    'application-session-edge'
  );
  if (!response.ok) throw new Error(`market_data_unavailable:${response.status}`);
  const quote = (await response.json()) as Partial<LiveMarketQuote>;
  if (
    quote.provider !== 'fastforex' ||
    quote.baseCurrency !== baseCurrency ||
    quote.quoteCurrency !== quoteCurrency ||
    typeof quote.rate !== 'string' ||
    typeof quote.updatedAt !== 'string' ||
    typeof quote.fetchedAt !== 'string' ||
    quote.priceType !== 'midpoint_spot' ||
    quote.referenceOnly !== true
  ) {
    throw new Error('invalid_market_rate_response');
  }
  return quote as LiveMarketQuote;
}

function hasOnlySearchParams(url: URL, allowed: ReadonlySet<string>) {
  let allowedOnly = true;
  url.searchParams.forEach((_value, key) => {
    if (!allowed.has(key)) allowedOnly = false;
  });
  return allowedOnly;
}

function customerCoreRouteAllowed(
  url: URL,
  method: string,
  customerId: string,
  organizationId: string
) {
  if (url.pathname === '/api/core/funding-channels' && method === 'GET') {
    const type = url.searchParams.get('type');
    return (
      url.searchParams.get('organizationId') === organizationId &&
      (type === 'VIRTUAL_ACCOUNT' || type === 'FIAT_INBOUND') &&
      url.searchParams.get('active') === 'true' &&
      hasOnlySearchParams(url, new Set(['organizationId', 'type', 'active']))
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
    return (
      url.searchParams.get('organizationId') === organizationId &&
      url.searchParams.get('customerId') === customerId &&
      hasOnlySearchParams(url, new Set(['organizationId', 'customerId']))
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
  'metadata',
  'maker',
  'checker',
  'operator',
]);

function redactCustomerCorePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCustomerCorePayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !CUSTOMER_CORE_INTERNAL_FIELDS.has(key))
      .map(([key, item]) => [key, redactCustomerCorePayload(item)])
  );
}

async function proxyCoreAPI(request: Request, env: Env): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > MAX_BODY_BYTES) return json({ error: { code: 'payload_too_large' } }, 413);
  const incomingBody = await request.arrayBuffer();
  if (incomingBody.byteLength > MAX_BODY_BYTES) {
    return json({ error: { code: 'payload_too_large' } }, 413);
  }
  const contentType = request.headers.get('content-type') || '';
  let body = incomingBody;
  if (body.byteLength > 0 && contentType.toLowerCase().includes('application/json')) {
    try {
      body = new TextEncoder().encode(JSON.stringify(JSON.parse(new TextDecoder().decode(body))));
    } catch {
      // Preserve malformed JSON so the upstream rejects the exact submitted
      // payload after edge authentication instead of silently rewriting it.
    }
  }

  const incoming = new URL(request.url);
  const session = await loadApplicationSession(request, env);
  const role = typeof session?.user?.role === 'string' ? session.user.role : '';
  const userId = typeof session?.user?.id === 'string' ? session.user.id : '';
  const coreUserId =
    typeof session?.user?.core_user_id === 'string' ? session.user.core_user_id : '';
  const email = typeof session?.user?.email === 'string' ? session.user.email : '';
  const sessionPermissions = session?.user?.permissions;
  const permissions = Array.isArray(sessionPermissions)
    ? sessionPermissions.filter(
        (permission): permission is string => typeof permission === 'string'
      )
    : [];
  if (!email || (role !== 'admin' && role !== 'customer')) {
    return json({ error: { code: 'authentication_required' } }, 401);
  }
  if (
    role === 'customer' &&
    (!userId ||
      !customerCoreRouteAllowed(incoming, request.method, userId, env.CORE_ORGANIZATION_ID))
  ) {
    return json({ error: { code: 'customer_core_route_forbidden' } }, 403);
  }
  if (role === 'admin') {
    if (!coreUserId) {
      return json({ error: { code: 'admin_identity_incomplete' } }, 401);
    }
    const requiredPermission = requiredAdminCorePermission(incoming.pathname, request.method);
    const isSuperAdmin = permissions.includes(ADMIN_PERMISSIONS.users);
    if (
      (!requiredPermission && !isSuperAdmin) ||
      (requiredPermission && !permissions.includes(requiredPermission))
    ) {
      return json({ error: { code: 'admin_permission_required' } }, 403);
    }
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const expected = typeof session?.csrf_token === 'string' ? session.csrf_token : '';
    const provided = request.headers.get('x-csrf-token') || '';
    if (!expected || !provided || !(await constantTimeTextEqual(expected, provided))) {
      return json({ error: { code: 'invalid_csrf_token' } }, 403);
    }
  }

  if (
    role === 'admin' &&
    request.method === 'POST' &&
    incoming.pathname === '/api/core/rates/from-market'
  ) {
    let requested: {
      type?: unknown;
      baseCurrency?: unknown;
      quoteCurrency?: unknown;
      feeBps?: unknown;
    };
    try {
      requested = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return json({ error: { code: 'invalid_json' } }, 400);
    }
    if (
      (requested.type !== 'FX' && requested.type !== 'OTC') ||
      typeof requested.baseCurrency !== 'string' ||
      typeof requested.quoteCurrency !== 'string' ||
      !Number.isInteger(requested.feeBps) ||
      Number(requested.feeBps) < 0 ||
      Number(requested.feeBps) > 9999
    ) {
      return json({ error: { code: 'invalid_market_rate_request' } }, 400);
    }
    let quote: LiveMarketQuote;
    try {
      quote = await fetchLiveMarketQuote(
        request,
        env,
        role,
        requested.baseCurrency,
        requested.quoteCurrency
      );
    } catch {
      return json({ error: { code: 'market_data_unavailable' } }, 503);
    }
    body = new TextEncoder().encode(
      JSON.stringify({
        type: requested.type,
        baseCurrency: requested.baseCurrency,
        quoteCurrency: requested.quoteCurrency,
        feeBps: requested.feeBps,
        provider: quote.provider,
        priceType: quote.priceType,
        referenceOnly: quote.referenceOnly,
        referenceRate: quote.rate,
        sourceUpdatedAt: quote.updatedAt,
        sourceFetchedAt: quote.fetchedAt,
      })
    );
  }

  if (
    role === 'admin' &&
    request.method === 'POST' &&
    incoming.pathname === '/api/core/operations'
  ) {
    let operation: Record<string, unknown>;
    try {
      operation = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
    } catch {
      return json({ error: { code: 'invalid_json' } }, 400);
    }
    if (operation.type === 'FX' || operation.type === 'OTC') {
      if (typeof operation.currency !== 'string' || typeof operation.quoteCurrency !== 'string') {
        return json({ error: { code: 'invalid_conversion_pair' } }, 400);
      }
      let quote: LiveMarketQuote;
      try {
        quote = await fetchLiveMarketQuote(
          request,
          env,
          role,
          operation.currency,
          operation.quoteCurrency
        );
      } catch {
        return json({ error: { code: 'market_data_unavailable' } }, 503);
      }
      body = new TextEncoder().encode(
        JSON.stringify({
          ...operation,
          marketProvider: quote.provider,
          marketPriceType: quote.priceType,
          marketReferenceOnly: quote.referenceOnly,
          marketRate: quote.rate,
          marketUpdatedAt: quote.updatedAt,
          marketFetchedAt: quote.fetchedAt,
        })
      );
    }
  }

  const upstreamOrigin = new URL(env.CORE_API_BASE_URL);
  if (upstreamOrigin.protocol !== 'https:' || upstreamOrigin.pathname !== '/') {
    throw new Error('CORE_API_BASE_URL must be an HTTPS origin');
  }
  const corePath = incoming.pathname.replace(/^\/api\/core(?=\/|$)/, '/api/v1');
  const upstream = new URL(corePath + incoming.search, upstreamOrigin);
  const bodyHashHex = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', body)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const identity =
    role === 'customer' ? `customer:${userId}:${email}` : `admin:${coreUserId}:${email}`;
  const canonical = [
    timestamp,
    request.method,
    corePath + incoming.search,
    identity,
    bodyHashHex,
  ].join('\n');
  const signature = await hmacHex(env.CORE_EDGE_SHARED_SECRET, canonical);
  const headers = new Headers({
    accept: 'application/json',
    'x-neobank-user': identity,
    'x-core-edge-timestamp': timestamp,
    'x-core-edge-signature': signature,
  });
  if (contentType) headers.set('content-type', contentType);
  const idempotencyKey = request.headers.get('idempotency-key');
  if (idempotencyKey) headers.set('idempotency-key', idempotencyKey);
  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
    redirect: 'manual',
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Core API redirect rejected (${response.status})`);
  }
  if (
    request.method === 'GET' &&
    incoming.pathname === '/api/core/accounts/summary' &&
    response.ok
  ) {
    const summary = (await response.json()) as {
      distribution?: Array<{
        currency?: unknown;
        availableBalance?: unknown;
        frozenBalance?: unknown;
        [key: string]: unknown;
      }>;
      [key: string]: unknown;
    };
    if (!Array.isArray(summary.distribution)) {
      return json({ error: { code: 'invalid_core_summary_response' } }, 502);
    }
    type ValuedSummaryItem = {
      currency?: unknown;
      reportingRate: string | null;
      reportingValue: string | null;
      shareBps: number;
      liveAvailableValue?: number;
      liveFrozenValue?: number;
      marketUpdatedAt?: string;
      [key: string]: unknown;
    };
    let sourceDistribution = summary.distribution;
    if (role === 'customer') {
      let walletRows: CustomerWalletSummaryRow[];
      try {
        walletRows = await fetchCustomerWalletSummary(request, env);
      } catch {
        return json({ error: { code: 'customer_wallet_summary_unavailable' } }, 502);
      }
      const activeWallets = walletRows.filter((wallet) => wallet.status === 'active');
      const walletBalances = activeWallets.map((wallet) => ({
        available: Number(wallet.available_balance),
        frozen: Number(wallet.frozen_balance),
      }));
      if (
        walletBalances.some(
          (wallet) =>
            !Number.isFinite(wallet.available) ||
            wallet.available < 0 ||
            !Number.isFinite(wallet.frozen) ||
            wallet.frozen < 0
        )
      ) {
        return json({ error: { code: 'invalid_customer_wallet_balance' } }, 502);
      }
      sourceDistribution = sourceDistribution.filter((item) => item.currency !== 'USDT');
      if (activeWallets.length) {
        const available = walletBalances.reduce((sum, wallet) => sum + wallet.available, 0);
        const frozen = walletBalances.reduce((sum, wallet) => sum + wallet.frozen, 0);
        sourceDistribution.push({
          currency: 'USDT',
          availableBalance: available.toFixed(8),
          frozenBalance: frozen.toFixed(8),
          totalBalance: (available + frozen).toFixed(8),
          reportingRate: null,
          reportingValue: null,
          shareBps: 0,
          accountCount: activeWallets.length,
          sources: ['digital_wallet'],
        });
      }
    }
    const quoteCache = new Map<string, Promise<LiveMarketQuote>>();
    const valued: ValuedSummaryItem[] = await Promise.all(
      sourceDistribution.map(async (item) => {
        if (
          typeof item.currency !== 'string' ||
          typeof item.availableBalance !== 'string' ||
          typeof item.frozenBalance !== 'string'
        ) {
          return { ...item, reportingRate: null, reportingValue: null, shareBps: 0 };
        }
        let reportingRate = 1;
        let marketUpdatedAt = new Date().toISOString();
        if (item.currency !== 'USD') {
          let pending = quoteCache.get(item.currency);
          if (!pending) {
            pending = fetchLiveMarketQuote(request, env, role, item.currency, 'USD');
            quoteCache.set(item.currency, pending);
          }
          try {
            const quote = await pending;
            reportingRate = Number(quote.rate);
            marketUpdatedAt = quote.updatedAt;
          } catch {
            return { ...item, reportingRate: null, reportingValue: null, shareBps: 0 };
          }
        }
        const available = Number(item.availableBalance);
        const frozen = Number(item.frozenBalance);
        if (
          !Number.isFinite(available) ||
          !Number.isFinite(frozen) ||
          !Number.isFinite(reportingRate) ||
          reportingRate <= 0
        ) {
          return { ...item, reportingRate: null, reportingValue: null, shareBps: 0 };
        }
        return {
          ...item,
          reportingRate: reportingRate.toFixed(12).replace(/\.?0+$/, ''),
          reportingValue: ((available + frozen) * reportingRate).toFixed(8),
          shareBps: 0,
          marketUpdatedAt,
          liveAvailableValue: available * reportingRate,
          liveFrozenValue: frozen * reportingRate,
        };
      })
    );
    const totalAvailable = valued.reduce(
      (sum, item) =>
        sum + (typeof item.liveAvailableValue === 'number' ? item.liveAvailableValue : 0),
      0
    );
    const totalFrozen = valued.reduce(
      (sum, item) => sum + (typeof item.liveFrozenValue === 'number' ? item.liveFrozenValue : 0),
      0
    );
    const totalBalance = totalAvailable + totalFrozen;
    const missingRates = valued
      .filter((item) => item.reportingRate === null && typeof item.currency === 'string')
      .map((item) => item.currency);
    const ratesAsOf = valued
      .flatMap((item) =>
        typeof item.marketUpdatedAt === 'string' ? [Date.parse(item.marketUpdatedAt)] : []
      )
      .filter(Number.isFinite);
    return json({
      ...summary,
      valuationStatus: missingRates.length ? 'partial' : 'complete',
      missingRates,
      asOf: new Date().toISOString(),
      ratesAsOf: ratesAsOf.length ? new Date(Math.min(...ratesAsOf)).toISOString() : null,
      totalAvailable: totalAvailable.toFixed(8),
      totalFrozen: totalFrozen.toFixed(8),
      totalBalance: totalBalance.toFixed(8),
      accountCount: valued.reduce(
        (total, item) =>
          total +
          (typeof item.accountCount === 'number' && Number.isFinite(item.accountCount)
            ? item.accountCount
            : 0),
        0
      ),
      distribution: valued.map(
        ({
          liveAvailableValue: _available,
          liveFrozenValue: _frozen,
          marketUpdatedAt: _at,
          ...item
        }) => ({
          ...item,
          shareBps:
            item.reportingValue !== null && totalBalance > 0
              ? Math.round((Number(item.reportingValue) / totalBalance) * 10000)
              : 0,
        })
      ),
    });
  }
  if (request.method === 'GET' && incoming.pathname === '/api/core/rates' && response.ok) {
    const rows = (await response.json()) as Array<{
      active?: unknown;
      baseCurrency?: unknown;
      quoteCurrency?: unknown;
      feeBps?: unknown;
      [key: string]: unknown;
    }>;
    const quoteCache = new Map<string, Promise<LiveMarketQuote>>();
    const decorated = await Promise.all(
      rows.map(async (row) => {
        if (
          row.active !== true ||
          typeof row.baseCurrency !== 'string' ||
          typeof row.quoteCurrency !== 'string' ||
          typeof row.feeBps !== 'number'
        ) {
          return row;
        }
        const key = `${row.baseCurrency}/${row.quoteCurrency}`;
        let pending = quoteCache.get(key);
        if (!pending) {
          pending = fetchLiveMarketQuote(request, env, role, row.baseCurrency, row.quoteCurrency);
          quoteCache.set(key, pending);
        }
        try {
          const quote = await pending;
          const marketRate = Number(quote.rate);
          const customerRate = marketRate * (1 - row.feeBps / 10000);
          if (!Number.isFinite(marketRate) || marketRate <= 0 || customerRate <= 0) {
            throw new Error('invalid_market_rate_response');
          }
          return {
            ...row,
            marketProvider: quote.provider,
            marketPriceType: quote.priceType,
            marketRate: quote.rate,
            customerRate: customerRate.toFixed(12).replace(/\.?0+$/, ''),
            marketUpdatedAt: quote.updatedAt,
            marketFetchedAt: quote.fetchedAt,
          };
        } catch {
          return { ...row, marketUnavailable: true };
        }
      })
    );
    return json(decorated);
  }
  if (role === 'customer' && response.ok) {
    const payload = await response.json().catch(() => null);
    if (payload === null) return json({ error: { code: 'invalid_core_response' } }, 502);
    return json(redactCustomerCorePayload(payload), response.status);
  }
  return new Response(response.body, {
    status: response.status,
    headers: {
      'cache-control': 'no-store',
      'content-type': response.headers.get('content-type') || 'application/json',
    },
  });
}

function isApplicationAPI(pathname: string) {
  return (
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/v1/') ||
    pathname.startsWith('/api/core/') ||
    pathname === '/api/webhooks/sumsub'
  );
}

function customerAPIInMaintenance(env: Env): boolean {
  return env.CUSTOMER_AUTH_MAINTENANCE.trim().toLowerCase() === 'true';
}

function hasValidMutationOrigin(request: Request): boolean {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    return true;
  }
  const origin = request.headers.get('origin');
  return origin === new URL(request.url).origin;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/healthz' && request.method === 'GET') {
      return json({
        status: 'ok',
        service: 'neobank-web',
        customer_portal: 'public_session_auth',
        admin_access: 'password_totp_session',
      });
    }
    try {
      if (isApplicationAPI(url.pathname)) {
        const sumsubWebhook = url.pathname === '/api/webhooks/sumsub';
        if (sumsubWebhook && request.method !== 'POST') {
          return json({ error: { code: 'method_not_allowed' } }, 405);
        }
        if (
          customerAPIInMaintenance(env) &&
          (url.pathname.startsWith('/api/auth/customer/') ||
            url.pathname.startsWith('/api/v1/customer/'))
        ) {
          return json({ error: { code: 'customer_auth_maintenance' } }, 503);
        }
        if (!sumsubWebhook && !hasValidMutationOrigin(request)) {
          return json({ error: { code: 'invalid_origin' } }, 403);
        }
        if (url.pathname.startsWith('/api/core/')) {
          return await proxyCoreAPI(request, env);
        }
        return await proxyAPI(request, env, 'application-session-edge');
      }
      return env.ASSETS.fetch(request);
    } catch (caught) {
      console.error(
        JSON.stringify({
          event: 'neobank_web_error',
          path: url.pathname,
          message: caught instanceof Error ? caught.message : 'unknown_error',
        })
      );
      return json({ error: { code: 'service_unavailable' } }, 503);
    }
  },
} satisfies ExportedHandler<Env>;
