import { browserApiFetch } from 'src/utils/browser-api';
import {
  CreatePortalTeamRoleInput,
  InvitePortalTeamMemberInput,
  PortalTeamInvitation,
  PortalTeamInvitationCreateResult,
  PortalTeamMember,
  PortalTeamOverview,
  PortalTeamRoleDefinition,
  UpdatePortalTeamRoleInput,
  UpdatePortalTeamMemberInput,
} from './types';

const PORTAL_TEAM_API = '/api/v1/portal/team';

type ApiEnvelope<T> = {
  data?: T;
  meta?: {
    count?: number;
    current_user?: {
      user_id: string;
      role_code: string;
      permissions: string[];
    };
  };
  error?: {
    code?: string;
    message?: string;
    details?: { request_id?: string };
  };
};

export class PortalTeamApiError extends Error {
  status: number;

  code: string;

  requestId: string;

  constructor(status: number, code: string, message: string, requestId = '') {
    super(message);
    this.name = 'PortalTeamApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

async function request<T>(path: string, init: RequestInit = {}, unwrapData = true): Promise<T> {
  let response: Response;
  try {
    response = await browserApiFetch(`${PORTAL_TEAM_API}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new PortalTeamApiError(0, 'session_unavailable', 'session_unavailable');
  }

  const contentType = response.headers.get('content-type') || '';
  let payload: ApiEnvelope<T> | T | null = null;
  if (response.status !== 204 && contentType.includes('application/json')) {
    try {
      payload = (await response.json()) as ApiEnvelope<T> | T;
    } catch {
      payload = null;
    }
  }

  const envelope = payload && typeof payload === 'object' ? (payload as ApiEnvelope<T>) : null;
  if (!response.ok) {
    const requestId =
      response.headers.get('x-request-id') || envelope?.error?.details?.request_id || '';
    const code = envelope?.error?.code || 'request_failed';
    const message = envelope?.error?.message || code;
    throw new PortalTeamApiError(response.status, code, message, requestId);
  }

  if (response.status === 204) return undefined as T;
  if (unwrapData && envelope && Object.prototype.hasOwnProperty.call(envelope, 'data')) {
    return envelope.data as T;
  }
  if (payload !== null) return payload as T;

  throw new PortalTeamApiError(
    response.status,
    'invalid_response',
    'invalid_response',
    response.headers.get('x-request-id') || ''
  );
}

export async function getPortalTeamOverview(signal?: AbortSignal): Promise<PortalTeamOverview> {
  const [members, invitations, roles] = await Promise.all([
    request<ApiEnvelope<PortalTeamMember[]>>('/members', { method: 'GET', signal }, false),
    request<ApiEnvelope<PortalTeamInvitation[]>>('/invitations', { method: 'GET', signal }, false),
    request<ApiEnvelope<PortalTeamRoleDefinition[]>>('/roles', { method: 'GET', signal }, false),
  ]);
  const principal = members.meta?.current_user;
  return {
    current_user: principal
      ? {
          member_id: principal.user_id,
          user_id: principal.user_id,
          role: principal.role_code,
          permissions: principal.permissions || [],
        }
      : null,
    members: (members.data || []).map((member) => ({
      ...member,
      id: member.id || member.user_id || '',
      is_current_user: Boolean(principal && member.user_id === principal.user_id),
    })),
    invitations: invitations.data || [],
    roles: roles.data || [],
  };
}

export function invitePortalTeamMember(input: InvitePortalTeamMemberInput) {
  return request<PortalTeamInvitationCreateResult>('/invitations', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((result) => {
    const fragment = result.invite_url_fragment || '';
    let setupUrl = result.setup_url || '';
    if (typeof window !== 'undefined') {
      if (setupUrl) {
        try {
          const candidate = new URL(setupUrl, window.location.origin);
          setupUrl =
            candidate.origin === window.location.origin &&
            candidate.pathname === '/portal/setup'
              ? candidate.toString()
              : '';
        } catch {
          setupUrl = '';
        }
      }
      if (!setupUrl && fragment.startsWith('#')) {
        const email = encodeURIComponent(result.invitation.email);
        setupUrl = `${window.location.origin}/portal/setup?email=${email}${fragment}`;
      }
    }
    return { ...result, setup_url: setupUrl || null };
  });
}

export function revokePortalTeamInvitation(invitationId: string) {
  return request<void>(`/invitations/${encodeURIComponent(invitationId)}/revoke`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function updatePortalTeamMember(memberId: string, input: UpdatePortalTeamMemberInput) {
  return request<void>(`/members/${encodeURIComponent(memberId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function createPortalTeamRole(input: CreatePortalTeamRoleInput) {
  return request<PortalTeamRoleDefinition>('/roles', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updatePortalTeamRole(roleId: string, input: UpdatePortalTeamRoleInput) {
  return request<PortalTeamRoleDefinition>(`/roles/${encodeURIComponent(roleId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deletePortalTeamRole(roleId: string, version: number) {
  return request<void>(`/roles/${encodeURIComponent(roleId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ version }),
  });
}
