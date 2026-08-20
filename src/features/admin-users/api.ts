import { getCsrfToken, notifySessionExpired } from 'src/auth/csrf-token';
import {
  AdminSetupLinkResult,
  AdminUsersOverview,
  CreateAdminUserInput,
  CreateAdminUserResult,
  ManagedAdminUser,
  UpdateAdminUserInput,
} from './types';

const ADMIN_USERS_API = '/api/v1/admin/users';

export class AdminUsersApiError extends Error {
  status: number;

  code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = 'AdminUsersApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path = '', init: RequestInit = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase();
  const csrfToken = getCsrfToken();
  if (method !== 'GET' && method !== 'HEAD' && !csrfToken) {
    notifySessionExpired();
    throw new AdminUsersApiError(401, 'session_expired');
  }
  const response = await fetch(`${ADMIN_USERS_API}${path}`, {
    ...init,
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' && method !== 'HEAD' && csrfToken
        ? { 'X-CSRF-Token': csrfToken }
        : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (response.status === 401) notifySessionExpired();
  if (!response.ok) {
    throw new AdminUsersApiError(
      response.status,
      typeof payload?.error?.code === 'string' ? payload.error.code : 'request_failed'
    );
  }
  if (!payload || typeof payload !== 'object') {
    throw new AdminUsersApiError(response.status, 'invalid_response');
  }
  return payload as T;
}

export function getAdminUsers(signal?: AbortSignal) {
  return request<AdminUsersOverview>('', { method: 'GET', signal });
}

export function createAdminUser(input: CreateAdminUserInput) {
  return request<CreateAdminUserResult>('', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateAdminUser(userId: string, input: UpdateAdminUserInput) {
  return request<{ user: ManagedAdminUser }>(`/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function reissueAdminSetupToken(userId: string) {
  return request<AdminSetupLinkResult>(`/${encodeURIComponent(userId)}/setup-token`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
