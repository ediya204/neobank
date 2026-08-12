import { getCsrfToken, notifySessionExpired } from 'src/auth/csrf-token';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function toBrowserApiPath(value: string) {
  return value.replace(
    /^\/api\/v1\/(admin|portal)(?=\/|$)/,
    '/api/browser/v1/$1'
  );
}

export async function browserApiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const csrfToken = getCsrfToken();
  const headers = new Headers(input instanceof Request ? input.headers : undefined);

  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  headers.set('accept', headers.get('accept') || 'application/json');

  if (UNSAFE_METHODS.has(method) && !csrfToken) {
    notifySessionExpired();
    throw new Error('csrf_token_unavailable');
  }

  if (UNSAFE_METHODS.has(method) && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }

  let requestInput: RequestInfo | URL = input;
  if (typeof input === 'string') requestInput = toBrowserApiPath(input);
  if (input instanceof URL) {
    const url = new URL(input.toString());
    url.pathname = toBrowserApiPath(url.pathname);
    requestInput = url;
  }

  const response = await fetch(requestInput, {
    ...init,
    method,
    credentials: 'same-origin',
    cache: init.cache || 'no-store',
    headers,
  });

  if (response.status === 401) {
    let code = '';
    try {
      const body = await response.clone().json();
      code = typeof body?.error?.code === 'string' ? body.error.code : '';
    } catch {
      // Non-JSON 401 responses are treated as an expired browser session.
    }
    if (!['invalid_totp_code', 'step_up_required'].includes(code)) {
      notifySessionExpired();
    }
  }

  return response;
}
