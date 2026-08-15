type AccessHeader = { alg?: string; kid?: string; typ?: string };
type AccessClaims = {
  aud?: string | string[];
  email?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  nbf?: number;
  sub?: string;
};
type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string };

const MAX_BODY_BYTES = 128 * 1024;
const JWKS_CACHE_MS = 10 * 60 * 1000;
const ACCESS_ADMIN_SESSION_PATH = '/api/auth/access-admin/session';
let cachedKeys: { expiresAt: number; keys: Jwk[] } | undefined;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJSON<T>(value: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
  } catch {
    return null;
  }
}

function teamOrigin(env: Env): string | null {
  const value = env.CF_ACCESS_TEAM_DOMAIN.trim().toLowerCase();
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(value)) return null;
  return `https://${value}`;
}

async function accessKeys(origin: string, refresh = false): Promise<Jwk[]> {
  if (!refresh && cachedKeys && cachedKeys.expiresAt > Date.now()) return cachedKeys.keys;
  const response = await fetch(`${origin}/cdn-cgi/access/certs`, {
    headers: { accept: 'application/json' },
    redirect: 'manual',
  });
  if (!response.ok) throw new Error(`Access JWKS returned ${response.status}`);
  const payload = (await response.json()) as { keys?: Jwk[] };
  if (!Array.isArray(payload.keys) || payload.keys.length === 0) {
    throw new Error('Access JWKS contained no keys');
  }
  cachedKeys = { expiresAt: Date.now() + JWKS_CACHE_MS, keys: payload.keys };
  return payload.keys;
}

function includesAudience(claims: AccessClaims, required: string): boolean {
  return Array.isArray(claims.aud) ? claims.aud.includes(required) : claims.aud === required;
}

async function verifyAccess(request: Request, env: Env): Promise<AccessClaims | null> {
  const token = request.headers.get('cf-access-jwt-assertion') || '';
  const parts = token.split('.');
  const origin = teamOrigin(env);
  if (parts.length !== 3 || !origin) return null;
  const header = decodeJSON<AccessHeader>(parts[0]);
  const claims = decodeJSON<AccessClaims>(parts[1]);
  if (!header?.kid || header.alg !== 'RS256' || !claims?.email || !claims.exp) return null;
  const now = Math.floor(Date.now() / 1000);
  if (
    claims.exp <= now ||
    (claims.iat && claims.iat > now + 60) ||
    (claims.nbf && claims.nbf > now + 60)
  ) {
    return null;
  }
  if (claims.iss !== origin || !includesAudience(claims, env.CF_ACCESS_AUD)) return null;

  let key = (await accessKeys(origin)).find((candidate) => candidate.kid === header.kid);
  if (!key) {
    key = (await accessKeys(origin, true)).find((candidate) => candidate.kid === header.kid);
  }
  if (!key) return null;
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    key,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = decodeBase64Url(parts[2]);
  return (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signed))
    ? claims
    : null;
}

function adminAllowed(email: string, env: Env): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return env.NEOBANK_ADMIN_EMAILS.split(',').some(
    (candidate) => candidate.trim().toLowerCase() === normalized
  );
}

function accessAdminSession(claims: AccessClaims): Response {
  const email = (claims.email || '').trim().toLowerCase();
  return json({
    user: {
      id: claims.sub || `access:${email}`,
      email,
      display_name: email.split('@')[0] || 'Neobank administrator',
      role: 'admin',
      organization: null,
      membership: null,
      permissions: [],
    },
    session_source: 'cloudflare_access',
    expires_at: claims.exp,
  });
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

async function enforceCustomerAuthRateLimit(
  request: Request,
  env: Env,
  pathname: string,
  body: ArrayBuffer
): Promise<Response | null> {
  if (request.method !== 'POST' || !pathname.startsWith('/api/auth/customer/')) return null;
  const source = request.headers.get('cf-connecting-ip')?.trim() || 'unknown-source';
  const sourceResult = await env.CUSTOMER_AUTH_RATE_LIMITER.limit({
    key: await rateLimitKey(`source\0${source}\0${pathname}`),
  });
  if (!sourceResult.success) return json({ error: { code: 'auth_rate_limited' } }, 429);

  if (pathname === '/api/auth/customer/login') {
    let email = '';
    try {
      const payload = JSON.parse(new TextDecoder().decode(body)) as { email?: unknown };
      email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    } catch {
      // The Go API returns the canonical invalid-JSON response. The source
      // bucket above still limits malformed credential-stuffing traffic.
    }
    if (email) {
      const identityResult = await env.CUSTOMER_AUTH_RATE_LIMITER.limit({
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
  const rateLimited = await enforceCustomerAuthRateLimit(request, env, incoming.pathname, body);
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

function isPublicCustomerAPI(pathname: string) {
  return (
    pathname.startsWith('/api/auth/customer/') ||
    pathname === '/api/auth/me' ||
    pathname === '/api/auth/logout' ||
    pathname.startsWith('/api/v1/customer/')
  );
}

function customerAPIInMaintenance(env: Env): boolean {
  return env.CUSTOMER_AUTH_MAINTENANCE.trim().toLowerCase() === 'true';
}

function isAdminPage(pathname: string) {
  return (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/')
  );
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
        admin_access: 'cloudflare_access',
      });
    }
    try {
      if (isPublicCustomerAPI(url.pathname)) {
        if (customerAPIInMaintenance(env)) {
          return json({ error: { code: 'customer_auth_maintenance' } }, 503);
        }
        return await proxyAPI(request, env, 'public-customer-edge');
      }
      const claims = await verifyAccess(request, env);
      if (isAdminPage(url.pathname) || url.pathname.startsWith('/api/')) {
        if (!claims) return json({ error: { code: 'access_required' } }, 401);
      }
      if (isAdminPage(url.pathname) && !adminAllowed(claims?.email || '', env)) {
        return json({ error: { code: 'admin_required' } }, 403);
      }
      if (url.pathname === ACCESS_ADMIN_SESSION_PATH) {
        if (request.method !== 'GET') {
          return Response.json(
            { error: { code: 'method_not_allowed' } },
            { status: 405, headers: { allow: 'GET', 'cache-control': 'no-store' } }
          );
        }
        if (!claims || !adminAllowed(claims.email || '', env)) {
          return json({ error: { code: 'admin_required' } }, 403);
        }
        return accessAdminSession(claims);
      }
      if (url.pathname.startsWith('/api/')) {
        if (!claims) return json({ error: { code: 'access_required' } }, 401);
        if (!adminAllowed(claims.email || '', env)) {
          return json({ error: { code: 'admin_required' } }, 403);
        }
        if (!hasValidMutationOrigin(request)) {
          return json({ error: { code: 'invalid_origin' } }, 403);
        }
        return await proxyAPI(request, env, claims.email || '');
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
