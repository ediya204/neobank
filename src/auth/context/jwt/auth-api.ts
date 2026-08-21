import {
  AuthFlowResult,
  AuthFlowStep,
  AuthRole,
  AuthSessionData,
  AuthSessionUser,
  ChangePasswordInput,
  CompleteSetupInput,
  CustomerTotpEnrollmentResult,
  CustomerTotpVerificationResult,
  TotpSetupData,
  VerifyTotpInput,
} from 'src/auth/types';
import { isSessionPermission } from 'src/auth/permissions';
import { IS_NEOBANK_DEPLOYMENT } from 'src/config/deployment-mode';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

type JsonRecord = Record<string, unknown>;

export class AuthApiError extends Error {
  status: number;

  code: string;

  details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function readString(record: JsonRecord, keys: string[]) {
  const key = keys.find((candidate) => {
    const value = record[candidate];
    return typeof value === 'string' && Boolean(value.trim());
  });
  return key ? String(record[key]).trim() : null;
}

function readBoolean(record: JsonRecord, keys: string[]) {
  const key = keys.find((candidate) => typeof record[candidate] === 'boolean');
  return key ? (record[key] as boolean) : null;
}

function unwrapPayload(payload: unknown) {
  const root = readRecord(payload);
  return isRecord(root.data) ? root.data : root;
}

function normalizeRole(value: unknown): AuthRole | null {
  if (typeof value !== 'string') return null;
  const role = value.trim().toLowerCase();
  if (['admin', 'administrator', 'operator', 'operations'].includes(role)) return 'admin';
  if (['partner', 'portal', 'client'].includes(role)) return 'partner';
  if (['customer', 'account_holder'].includes(role)) return 'customer';
  return null;
}

export function normalizeAuthUser(payload: unknown): AuthSessionUser | null {
  const data = unwrapPayload(payload);
  const session = readRecord(data.session);
  const candidate = readRecord(data.user || session.user || data.account);
  if (!Object.keys(candidate).length) return null;

  const email = readString(candidate, ['email', 'email_address', 'username']);
  const role = normalizeRole(
    candidate.role || candidate.user_role || candidate.scope || data.role || session.role
  );

  if (!email || !role) return null;

  const organizationRecord = readRecord(candidate.organization || data.organization);
  const membershipRecord = readRecord(candidate.membership || data.membership);
  const organizationId = readString(organizationRecord, ['id', 'organization_id']);
  const membershipId = readString(membershipRecord, ['id', 'membership_id']);
  const roleId = readString(membershipRecord, ['role_id', 'roleId']);
  const memberRoleCode = readString(membershipRecord, ['role_code', 'roleCode']);
  const memberRoleName = readString(membershipRecord, ['role_name', 'roleName']);
  const membershipStatus = readString(membershipRecord, ['status']);
  const permissionsSource = candidate.permissions || data.permissions;
  const permissions = Array.isArray(permissionsSource)
    ? permissionsSource.filter(isSessionPermission)
    : [];

  const displayName =
    readString(candidate, ['display_name', 'displayName', 'name', 'full_name']) ||
    readString(membershipRecord, ['display_name', 'displayName']) ||
    email.split('@')[0];
  const id = readString(candidate, ['id', 'user_id', 'uid']) || email;
  const photoURL = readString(candidate, ['photo_url', 'photoURL', 'avatar_url', 'avatarUrl']);

  return {
    id,
    coreUserId: readString(candidate, ['core_user_id', 'coreUserId']),
    email,
    displayName,
    role,
    totpEnabled: readBoolean(candidate, ['totp_enabled', 'totpEnabled']) || false,
    accessRole: readString(candidate, [
      'access_role',
      'accessRole',
    ]) as AuthSessionUser['accessRole'],
    photoURL,
    organization: organizationId
      ? {
          id: organizationId,
          name: readString(organizationRecord, ['name']) || organizationId,
          partnerKey:
            readString(organizationRecord, ['partner_key', 'partnerKey']) || organizationId,
        }
      : null,
    membership:
      membershipId &&
      roleId &&
      memberRoleCode &&
      memberRoleName &&
      ['onboarding', 'active', 'suspended'].includes(membershipStatus || '')
        ? {
            id: membershipId,
            roleId,
            roleCode: memberRoleCode,
            roleName: memberRoleName,
            status: membershipStatus as 'onboarding' | 'active' | 'suspended',
          }
        : null,
    permissions,
  };
}

function normalizeStep(data: JsonRecord, user: AuthSessionUser | null): AuthFlowStep {
  const rawStep = (
    readString(data, ['next_step', 'nextStep', 'step', 'status', 'state']) || ''
  ).toLowerCase();

  if (
    [
      'setup_required',
      'password_setup_required',
      'initial_setup_required',
      'complete_setup',
    ].includes(rawStep) ||
    readBoolean(data, ['setup_required', 'password_setup_required']) === true
  ) {
    return 'setup_required';
  }

  if (
    ['totp_setup_required', 'mfa_setup_required', 'enroll_totp', 'totp_enrollment'].includes(
      rawStep
    ) ||
    readBoolean(data, ['totp_setup_required', 'requires_totp_setup', 'mfa_setup_required']) ===
      true ||
    Boolean(readString(data, ['enrollment_token', 'enrollmentToken']))
  ) {
    return 'totp_setup_required';
  }

  if (
    ['totp_required', 'mfa_required', 'verify_totp', 'verification_required'].includes(rawStep) ||
    readBoolean(data, ['totp_required', 'requires_totp', 'mfa_required']) === true
  ) {
    return 'totp_required';
  }

  if (
    user ||
    ['authenticated', 'session_ready', 'complete', 'success'].includes(rawStep) ||
    readBoolean(data, ['authenticated', 'session_ready']) === true
  ) {
    return 'authenticated';
  }

  return 'unknown';
}

function safeQrCodeDataUri(value: string | null) {
  if (!value) return null;
  if (value.startsWith('data:image/')) return value;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  return null;
}

function scopedAuthPath(role: AuthRole, action: string) {
  let scope = 'portal';
  if (role === 'admin') scope = 'admin';
  if (role === 'customer') scope = 'customer';
  return `/api/auth/${scope}/${action}`;
}

function sessionAuthPath(role: AuthRole | null | undefined, action: 'me' | 'logout') {
  if (IS_NEOBANK_DEPLOYMENT && (role === 'admin' || role === 'customer')) {
    return scopedAuthPath(role, action);
  }
  return `/api/auth/${action}`;
}

export function normalizeTotpSetup(payload: unknown): TotpSetupData | null {
  const data = unwrapPayload(payload);
  const source = readRecord(data.totp || data.enrollment || data.setup || data);
  const secret = readString(source, ['secret', 'manual_entry_key', 'manualKey', 'shared_secret']);
  if (!secret) return null;

  return {
    secret,
    otpauthUri: readString(source, ['otpauth_uri', 'otpauthUri', 'provisioning_uri']),
    qrCodeDataUri: safeQrCodeDataUri(
      readString(source, ['qr_code_data_uri', 'qrCodeDataUri', 'qr_code', 'qrCode'])
    ),
    issuer: readString(source, ['issuer']),
    accountName: readString(source, ['account_name', 'accountName', 'label']),
    enrollmentToken:
      readString(source, ['enrollment_token', 'enrollmentToken']) ||
      readString(data, ['enrollment_token', 'enrollmentToken']),
  };
}

function normalizeRecoveryCodes(data: JsonRecord) {
  const source = data.recovery_codes || data.recoveryCodes || readRecord(data.totp).recovery_codes;
  if (!Array.isArray(source)) return [];
  return source
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.trim());
}

export function normalizeAuthFlow(payload: unknown): AuthFlowResult {
  const data = unwrapPayload(payload);
  const user = normalizeAuthUser(data);
  const totpSetup = normalizeTotpSetup(data);
  const challenge = readRecord(data.challenge);

  return {
    nextStep: normalizeStep(data, user),
    user,
    challengeToken:
      readString(data, ['challenge_id', 'challenge_token', 'challengeToken', 'mfa_token']) ||
      readString(challenge, ['token', 'id']),
    enrollmentToken: readString(data, ['enrollment_token', 'enrollmentToken']),
    setupToken: readString(data, ['setup_token', 'setupToken', 'invitation_token']),
    totpSetup,
    recoveryCodes: normalizeRecoveryCodes(data),
    csrfToken: readString(data, ['csrf_token', 'csrfToken']),
  };
}

async function parseResponse(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return {};
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function authRequest(path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new AuthApiError(0, 'network_error', 'Authentication service is unavailable');
  }

  const payload = await parseResponse(response);
  if (!response.ok) {
    const root = readRecord(payload);
    const error = readRecord(root.error);
    const code =
      readString(error, ['code']) ||
      readString(root, ['code']) ||
      (response.status === 401 ? 'invalid_credentials' : 'request_failed');
    const message =
      readString(error, ['message']) ||
      readString(root, ['message']) ||
      `Authentication request failed (${response.status})`;
    throw new AuthApiError(response.status, code, message, error.details || root.details);
  }

  return payload;
}

export async function getSession(expectedRole?: AuthRole): Promise<AuthSessionData | null> {
  try {
    const payload = await authRequest(sessionAuthPath(expectedRole, 'me'), { method: 'GET' });
    const user = normalizeAuthUser(payload);
    const data = unwrapPayload(payload);
    const csrfToken = readString(data, ['csrf_token', 'csrfToken']);
    if (!user || !csrfToken) {
      throw new AuthApiError(502, 'invalid_auth_response', 'Invalid session response');
    }
    return { user, csrfToken };
  } catch (error) {
    if (error instanceof AuthApiError && error.status === 401) return null;
    throw error;
  }
}

export async function loginWithPassword(email: string, password: string, expectedRole: AuthRole) {
  const payload = await authRequest(scopedAuthPath(expectedRole, 'login'), {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return normalizeAuthFlow(payload);
}

export async function completeInitialSetup(input: CompleteSetupInput) {
  const payload = await authRequest(scopedAuthPath(input.expectedRole, 'setup/complete'), {
    method: 'POST',
    body: JSON.stringify({
      setup_token: input.setupToken,
      password: input.password,
    }),
  });
  return normalizeAuthFlow(payload);
}

export async function beginTotpSetup(expectedRole: AuthRole, enrollmentToken?: string | null) {
  const payload = await authRequest(scopedAuthPath(expectedRole, 'totp/setup'), {
    method: 'POST',
    body: JSON.stringify({
      ...(enrollmentToken ? { enrollment_token: enrollmentToken } : {}),
    }),
  });
  const setup = normalizeTotpSetup(payload);
  if (!setup) {
    throw new AuthApiError(502, 'invalid_auth_response', 'TOTP setup data is missing');
  }
  return setup;
}

export async function verifyTotpChallenge(input: VerifyTotpInput) {
  const payload = await authRequest(scopedAuthPath(input.expectedRole, 'totp/verify'), {
    method: 'POST',
    body: JSON.stringify({
      ...(input.code ? { code: input.code } : {}),
      ...(input.recoveryCode ? { recovery_code: input.recoveryCode } : {}),
      ...(input.challengeToken ? { challenge_id: input.challengeToken } : {}),
      ...(input.enrollmentToken ? { enrollment_token: input.enrollmentToken } : {}),
    }),
  });
  return normalizeAuthFlow(payload);
}

export async function changeCurrentPassword(
  input: ChangePasswordInput,
  expectedRole: AuthRole,
  csrfToken: string | null
) {
  await authRequest(scopedAuthPath(expectedRole, 'password/change'), {
    method: 'POST',
    body: JSON.stringify({
      current_password: input.currentPassword,
      new_password: input.newPassword,
      totp_code: input.totpCode,
    }),
    headers: {
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
  });
}

export async function requestCustomerPasswordReset(email: string) {
  await authRequest('/api/auth/customer/password-reset/request', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
}

export async function inspectCustomerPasswordReset(resetToken: string) {
  const payload = await authRequest('/api/auth/customer/password-reset/inspect', {
    method: 'POST',
    body: JSON.stringify({ reset_token: resetToken }),
  });
  const data = unwrapPayload(payload);
  return {
    valid: readBoolean(data, ['valid']) === true,
    expiresAt: readString(data, ['expires_at', 'expiresAt']),
  };
}

export async function completeCustomerPasswordReset(input: {
  resetToken: string;
  newPassword: string;
}) {
  await authRequest('/api/auth/customer/password-reset/complete', {
    method: 'POST',
    body: JSON.stringify({
      reset_token: input.resetToken,
      new_password: input.newPassword,
    }),
  });
}

export async function completeCustomerEmailVerification(verificationToken: string) {
  await authRequest('/api/auth/customer/email-verification/complete', {
    method: 'POST',
    body: JSON.stringify({ verification_token: verificationToken }),
  });
}

export type CustomerSecuritySession = {
  id: string;
  device_label: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  idle_expires_at: string;
  current: boolean;
};

export type CustomerSecurityPasskey = {
  id: string;
  display_name: string;
  created_at: string;
  last_used_at?: string | null;
};

export type CustomerSecurityEvent = {
  event_type: string;
  created_at: string;
};

export type CustomerSecuritySummary = {
  email_verified: boolean;
  email_verified_at?: string | null;
  password_changed_at?: string | null;
  totp_enabled: boolean;
  recovery_codes_remaining: number;
  passkeys: CustomerSecurityPasskey[];
  sessions: CustomerSecuritySession[];
  events: CustomerSecurityEvent[];
  withdrawal_lock: {
    enabled: boolean;
    locked_at?: string | null;
    unlock_requested_at?: string | null;
    unlock_available_at?: string | null;
  };
  pending_email_change?: {
    id: string;
    new_email: string;
    expires_at: string;
    verified_at?: string | null;
    apply_after?: string | null;
    created_at: string;
  } | null;
  pending_closure?: {
    id: string;
    status: string;
    customer_reason: string;
    requested_at: string;
  } | null;
};

function securityHeaders(csrfToken: string | null) {
  return { ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) };
}

export async function getCustomerSecuritySummary(): Promise<CustomerSecuritySummary> {
  const payload = await authRequest('/api/auth/customer/security/summary');
  return unwrapPayload(payload) as unknown as CustomerSecuritySummary;
}

export async function revokeCustomerSession(sessionId: string, csrfToken: string | null) {
  await authRequest(`/api/auth/customer/security/sessions/${encodeURIComponent(sessionId)}/revoke`, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: securityHeaders(csrfToken),
  });
}

export async function revokeOtherCustomerSessions(csrfToken: string | null) {
  await authRequest('/api/auth/customer/security/sessions/revoke-others', {
    method: 'POST',
    body: JSON.stringify({}),
    headers: securityHeaders(csrfToken),
  });
}

type SecurityStepUpInput = {
  currentPassword: string;
  totpCode: string;
};

function securityStepUpBody(input: SecurityStepUpInput) {
  return { current_password: input.currentPassword, totp_code: input.totpCode };
}

export async function regenerateCustomerRecoveryCodes(
  input: SecurityStepUpInput,
  csrfToken: string | null
) {
  const payload = await authRequest('/api/auth/customer/security/recovery-codes/regenerate', {
    method: 'POST',
    body: JSON.stringify(securityStepUpBody(input)),
    headers: securityHeaders(csrfToken),
  });
  return normalizeRecoveryCodes(unwrapPayload(payload));
}

export async function beginCustomerTotpReplacement(
  input: SecurityStepUpInput,
  csrfToken: string | null
): Promise<CustomerTotpEnrollmentResult> {
  const payload = await authRequest('/api/auth/customer/security/totp/replace/start', {
    method: 'POST',
    body: JSON.stringify(securityStepUpBody(input)),
    headers: securityHeaders(csrfToken),
  });
  const setup = normalizeTotpSetup(payload);
  if (!setup) throw new AuthApiError(502, 'invalid_auth_response', 'TOTP setup data is missing');
  const data = unwrapPayload(payload);
  return { ...setup, expiresAt: readString(data, ['expires_at', 'expiresAt']) };
}

export async function verifyCustomerTotpReplacement(
  enrollmentToken: string,
  code: string,
  csrfToken: string | null
) {
  const payload = await authRequest('/api/auth/customer/security/totp/replace/verify', {
    method: 'POST',
    body: JSON.stringify({ enrollment_token: enrollmentToken, code }),
    headers: securityHeaders(csrfToken),
  });
  const data = unwrapPayload(payload);
  return {
    recoveryCodes: normalizeRecoveryCodes(data),
    otherSessionsRevoked:
      readBoolean(data, ['other_sessions_revoked', 'otherSessionsRevoked']) === true,
  };
}

export async function requestCustomerEmailChange(
  input: SecurityStepUpInput & { newEmail: string },
  csrfToken: string | null
) {
  await authRequest('/api/auth/customer/security/email-change/request', {
    method: 'POST',
    body: JSON.stringify({ ...securityStepUpBody(input), new_email: input.newEmail }),
    headers: securityHeaders(csrfToken),
  });
}

export async function verifyCustomerEmailChange(emailChangeToken: string) {
  return authRequest('/api/auth/customer/email-change/verify', {
    method: 'POST',
    body: JSON.stringify({ email_change_token: emailChangeToken }),
  });
}

export async function applyCustomerEmailChange(
  input: SecurityStepUpInput,
  csrfToken: string | null
) {
  await authRequest('/api/auth/customer/security/email-change/apply', {
    method: 'POST',
    body: JSON.stringify(securityStepUpBody(input)),
    headers: securityHeaders(csrfToken),
  });
}

export async function changeCustomerWithdrawalLock(
  action: 'enable' | 'request-unlock' | 'confirm-unlock',
  input: SecurityStepUpInput,
  csrfToken: string | null
) {
  await authRequest(`/api/auth/customer/security/withdrawal-lock/${action}`, {
    method: 'POST',
    body: JSON.stringify(securityStepUpBody(input)),
    headers: securityHeaders(csrfToken),
  });
}

export async function exportCustomerData(
  input: SecurityStepUpInput,
  csrfToken: string | null
) {
  return authRequest('/api/auth/customer/security/data-export', {
    method: 'POST',
    body: JSON.stringify(securityStepUpBody(input)),
    headers: securityHeaders(csrfToken),
  });
}

export async function requestCustomerAccountClosure(
  input: SecurityStepUpInput & { reason: string },
  csrfToken: string | null
) {
  await authRequest('/api/auth/customer/security/account-closure/request', {
    method: 'POST',
    body: JSON.stringify({ ...securityStepUpBody(input), reason: input.reason }),
    headers: securityHeaders(csrfToken),
  });
}

export async function cancelCustomerAccountClosure(csrfToken: string | null) {
  await authRequest('/api/auth/customer/security/account-closure/cancel', {
    method: 'POST',
    body: JSON.stringify({}),
    headers: securityHeaders(csrfToken),
  });
}

export function customerPasskeysSupported() {
  return browserSupportsWebAuthn();
}

export async function registerCustomerPasskey(
  input: SecurityStepUpInput & { displayName: string },
  csrfToken: string | null
) {
  const beginPayload = await authRequest('/api/auth/customer/passkey/register/options', {
    method: 'POST',
    body: JSON.stringify({ ...securityStepUpBody(input), display_name: input.displayName }),
    headers: securityHeaders(csrfToken),
  });
  const begin = unwrapPayload(beginPayload);
  const challengeId = readString(begin, ['challenge_id']);
  if (!challengeId || !isRecord(begin.options)) {
    throw new AuthApiError(502, 'invalid_auth_response', 'Passkey options are missing');
  }
  const credential = await startRegistration({
    optionsJSON: begin.options as unknown as PublicKeyCredentialCreationOptionsJSON,
  });
  await authRequest('/api/auth/customer/passkey/register/verify', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: challengeId, credential }),
    headers: securityHeaders(csrfToken),
  });
}

export async function removeCustomerPasskey(
  passkeyId: string,
  input: SecurityStepUpInput,
  csrfToken: string | null
) {
  await authRequest(`/api/auth/customer/passkey/${encodeURIComponent(passkeyId)}/remove`, {
    method: 'POST',
    body: JSON.stringify(securityStepUpBody(input)),
    headers: securityHeaders(csrfToken),
  });
}

export async function loginCustomerWithPasskey(): Promise<AuthFlowResult> {
  const beginPayload = await authRequest('/api/auth/customer/passkey/login/options', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  const begin = unwrapPayload(beginPayload);
  const challengeId = readString(begin, ['challenge_id']);
  if (!challengeId || !isRecord(begin.options)) {
    throw new AuthApiError(502, 'invalid_auth_response', 'Passkey options are missing');
  }
  const credential = await startAuthentication({
    optionsJSON: begin.options as unknown as PublicKeyCredentialRequestOptionsJSON,
  });
  const payload = await authRequest('/api/auth/customer/passkey/login/verify', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: challengeId, credential }),
  });
  return normalizeAuthFlow(payload);
}

export async function beginCustomerTotpEnrollment(
  currentPassword: string,
  csrfToken: string | null
): Promise<CustomerTotpEnrollmentResult> {
  const payload = await authRequest('/api/auth/customer/totp/enroll/start', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword }),
    headers: {
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
  });
  const setup = normalizeTotpSetup(payload);
  if (!setup) {
    throw new AuthApiError(502, 'invalid_auth_response', 'TOTP setup data is missing');
  }
  const data = unwrapPayload(payload);
  return {
    ...setup,
    expiresAt: readString(data, ['expires_at', 'expiresAt']),
  };
}

export async function verifyCustomerTotpEnrollment(
  enrollmentToken: string,
  code: string,
  csrfToken: string | null
): Promise<CustomerTotpVerificationResult> {
  const payload = await authRequest('/api/auth/customer/totp/enroll/verify', {
    method: 'POST',
    body: JSON.stringify({ enrollment_token: enrollmentToken, code }),
    headers: {
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
  });
  const data = unwrapPayload(payload);
  return {
    totpEnabled: readBoolean(data, ['totp_enabled', 'totpEnabled']) === true,
    recoveryCodes: normalizeRecoveryCodes(data),
    otherSessionsRevoked:
      readBoolean(data, ['other_sessions_revoked', 'otherSessionsRevoked']) === true,
  };
}

export async function logoutSession(expectedRole: AuthRole | null, csrfToken: string | null) {
  await authRequest(sessionAuthPath(expectedRole, 'logout'), {
    method: 'POST',
    body: JSON.stringify({}),
    headers: {
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
  });
}
