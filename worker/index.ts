import {
  AuthPrincipal,
  authorizeBrowserRequest,
  authorizeLegacyHumanRequest,
  cleanupExpiredAuthState,
  handleAuthRequest,
  rewriteBrowserApiRequest,
  verifyAuthenticatedTotpStepUp,
} from './auth';
import {
  handlePortalTeamRequest,
  PortalTeamPermission,
  PortalTeamPrincipal,
  requirePortalTeamPermission,
  resolvePortalTeamPrincipal,
} from './portal-team';
import {
  SUPPORTED_CALLING_CODE_VALUES,
  SUPPORTED_COUNTRY_CALLING_CODES,
} from '../src/data/supported-country-calling-codes';

type ApplicationStatus =
  | 'submitted'
  | 'kyc_link_ready'
  | 'kyc_approved'
  | 'va_processing'
  | 'active'
  | 'changes_requested';

type ApplicationStage = Exclude<ApplicationStatus, 'changes_requested'>;

type CreateApplicationBody = {
  partner_customer_id: string;
  phone_country_code: string;
  phone_number: string;
  email: string;
  customer_name: string;
};

type VaAccountBody = {
  account_name: string;
  account_number: string;
  iban?: string | null;
  currency: string;
  swift_bic: string;
  bank_name: string;
  bank_address: string;
};

type UpdateApplicationBody = {
  kyc_url?: string;
  status?: ApplicationStage;
  va_account?: VaAccountBody;
  profile?: Omit<CreateApplicationBody, 'partner_customer_id'> & {
    partner_customer_id?: string | null;
  };
};

const SUPPORTED_CRYPTO_NETWORKS = ['TRON', 'ETHEREUM', 'SOLANA', 'BSC'] as const;
const PARTNER_API_VERSION = '1.7.0';
const PARTNER_KEY = 'ethan';
const WEBHOOK_EVENTS = [
  'application.status_changed',
  'va_account.activated',
  'fund_transaction.status_changed',
  'otc_order.status_changed',
  'fiat_deposit.cleared_and_converted',
  'usdt_sweep.locked',
  'usdt_sweep.completed',
  'usdt_sweep.cancelled',
] as const;
const WEBHOOK_MAX_ATTEMPTS = 5;
const WEBHOOK_DELIVERY_TIMEOUT_MS = 10_000;
const AUTHENTICATED_ACTOR_HEADER = 'X-VA-Authenticated-User-Email';
const COUNTRY_CALLING_CODE_POLICY = {
  id: 'supported_country_calling_codes_v1',
  reviewed_at: '2026-07-29',
  excluded_iso2: ['CU', 'IR', 'KP'],
  scope: 'country_level_pre_screening',
  disclaimer:
    'This supported-country list is a country-level onboarding pre-screen only. It does not replace customer, beneficial-owner, entity, SDN, or regional sanctions screening.',
} as const;

type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];
type WebhookDeliveryEventType = WebhookEventType | 'webhook.test';
type WebhookEnv = Env & {
  AUTH_LOCAL_BYPASS?: string;
  AUTH_SESSION_SECRET?: string;
  API_CREDENTIAL_LOCAL_DEMO?: string;
  PARTNER_WEBHOOK_SIGNING_SECRET?: string;
  API_CREDENTIAL_ENCRYPTION_KEY?: string;
  CLOUDFLARE_ACCESS_MANAGEMENT_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  PARTNER_ACCESS_SERVICE_TOKEN_ID?: string;
  PARTNER_ACCESS_ROTATION_OVERLAP_HOURS?: string;
};

type ApplicationRow = {
  id: string;
  partner_customer_id: string | null;
  phone_country_code: string;
  phone_number: string;
  email: string;
  customer_name: string;
  status: ApplicationStage;
  kyc_url: string | null;
  submission_round: number;
  application_version: number;
  last_submitted_at: string | null;
  current_review_id: string | null;
  review_submission_round: number | null;
  review_stage: ApplicationStage | null;
  public_reason_code: string | null;
  public_reason_text: string | null;
  required_fields_json: string | null;
  internal_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  account_name: string | null;
  account_number: string | null;
  iban: string | null;
  currency: string | null;
  swift_bic: string | null;
  bank_name: string | null;
  bank_address: string | null;
};

const APPLICATION_SELECT = `
  SELECT
    a.id,
    a.partner_customer_id,
    a.phone_country_code,
    a.phone_number,
    a.email,
    a.customer_name,
    a.status,
    a.kyc_url,
    a.submission_round,
    a.application_version,
    a.last_submitted_at,
    a.current_review_id,
    a.created_at,
    a.updated_at,
    r.submission_round AS review_submission_round,
    r.review_stage,
    r.public_reason_code,
    r.public_reason_text,
    r.required_fields_json,
    r.internal_note,
    r.reviewed_by,
    r.reviewed_at,
    v.account_name,
    v.account_number,
    v.iban,
    v.currency,
    v.swift_bic,
    v.bank_name,
    v.bank_address
  FROM va_applications a
  LEFT JOIN va_accounts v ON v.application_id = a.id
  LEFT JOIN va_application_reviews r ON r.id = a.current_review_id
`;

const STATUS_TRANSITIONS: Record<ApplicationStage, ApplicationStage[]> = {
  submitted: ['kyc_link_ready'],
  kyc_link_ready: ['kyc_approved'],
  kyc_approved: ['va_processing', 'active'],
  va_processing: ['active'],
  active: [],
};

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function secureResponse(response: Response, apiResponse = false, requestId?: string) {
  const headers = new Headers(response.headers);
  if (apiResponse && requestId) headers.set('x-request-id', requestId);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('strict-transport-security', 'max-age=31536000');
  headers.set(
    'content-security-policy',
    apiResponse
      ? "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function error(status: number, code: string, message: string, details?: unknown) {
  return json(
    {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    status
  );
}

function portalPermissionForRequest(
  scopedPath: string,
  method: string
): PortalTeamPermission | null {
  const normalizedMethod = method.toUpperCase();

  if (scopedPath.startsWith('/team/')) {
    if (/^\/team\/members\/[^/]+$/.test(scopedPath)) {
      return 'team.manage_members';
    }
    if (/^\/team\/invitations\/[^/]+\/revoke$/.test(scopedPath)) {
      return 'team.invite';
    }
    if (scopedPath === '/team/invitations' && normalizedMethod === 'POST') {
      return 'team.invite';
    }
    if (scopedPath === '/team/roles' && normalizedMethod === 'POST') {
      return 'team.manage_roles';
    }
    if (/^\/team\/roles\/[^/]+$/.test(scopedPath) && normalizedMethod !== 'GET') {
      return 'team.manage_roles';
    }
    return 'team.read';
  }
  if (scopedPath === '/customers' || /^\/customers\/[^/]+$/.test(scopedPath)) {
    return 'customers.read';
  }
  if (scopedPath === '/va-applications') {
    return normalizedMethod === 'POST' ? 'customers.create' : 'customers.read';
  }
  if (/^\/va-applications\/[^/]+\/resubmit$/.test(scopedPath) && normalizedMethod === 'POST') {
    return 'customers.create';
  }
  if (/^\/va-applications\/[^/]+$/.test(scopedPath)) return 'customers.read';
  if (scopedPath === '/balances' || scopedPath === '/withdrawal-fees') {
    return 'balances.read';
  }
  if (
    scopedPath === '/reconciliation' ||
    scopedPath === '/reconciliation/movements' ||
    scopedPath === '/transactions' ||
    scopedPath === '/fund-transactions' ||
    /^\/fund-transactions\/[^/]+$/.test(scopedPath) ||
    scopedPath === '/otc-orders' ||
    /^\/otc-orders\/[^/]+$/.test(scopedPath) ||
    scopedPath === '/sweep-batches' ||
    /^\/sweep-batches\/[^/]+$/.test(scopedPath)
  ) {
    return 'transactions.read';
  }
  if (scopedPath.startsWith('/notifications')) return 'notifications.read';
  if (/^\/api-integration\/credentials\/[^/]+\/reveal$/.test(scopedPath)) {
    return 'credentials.reveal';
  }
  if (/^\/api-integration\/webhook-signing-keys\/[^/]+\/reveal$/.test(scopedPath)) {
    return 'credentials.reveal';
  }
  if (scopedPath === '/api-integration' || scopedPath.startsWith('/api-integration/')) {
    return normalizedMethod === 'GET' ? 'integrations.read' : 'integrations.request_change';
  }
  if (scopedPath === '/openapi.yaml') return 'integrations.read';
  return null;
}

function normalizeApplication(row: ApplicationRow, includeInactiveKycUrl = false) {
  const status: ApplicationStatus = row.current_review_id ? 'changes_requested' : row.status;
  let requiredFields: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.required_fields_json || '[]');
    if (Array.isArray(parsed)) {
      requiredFields = parsed.filter((value): value is string => typeof value === 'string');
    }
  } catch {
    requiredFields = [];
  }
  const kycUrlIsActionable =
    row.status === 'kyc_link_ready' ||
    (Boolean(row.current_review_id) && requiredFields.includes('kyc_documents'));
  return {
    application_id: row.id,
    partner_customer_id: row.partner_customer_id,
    phone_country_code: row.phone_country_code,
    phone_number: row.phone_number,
    email: row.email,
    customer_name: row.customer_name,
    status,
    onboarding_stage: row.status,
    submission_round: row.submission_round,
    application_version: row.application_version,
    last_submitted_at: row.last_submitted_at,
    action_required: row.current_review_id
      ? {
          type: 'resubmit',
          reason_code: row.public_reason_code,
          reason_message: row.public_reason_text,
          required_fields: requiredFields,
          requested_at: row.reviewed_at,
          ...(includeInactiveKycUrl
            ? {
                internal_note: row.internal_note,
                reviewed_by: row.reviewed_by,
              }
            : {}),
        }
      : null,
    // Keep the stored URL for operator audit/correction, but do not expose a
    // completed or otherwise inactive KYC session to partner consumers.
    kyc_url: includeInactiveKycUrl || kycUrlIsActionable ? row.kyc_url : null,
    va_account: row.account_number
      ? {
          account_name: row.account_name,
          account_number: row.account_number,
          iban: row.iban,
          currency: row.currency,
          swift_bic: row.swift_bic,
          bank_name: row.bank_name,
          bank_address: row.bank_address,
        }
      : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const APPLICATION_CHANGE_REASON_CODES = [
  'customer_information_incomplete',
  'customer_information_mismatch',
  'phone_unverifiable',
  'email_unverifiable',
  'kyc_documents_incomplete',
  'kyc_documents_expired',
  'kyc_retry_required',
  'duplicate_customer',
  'unsupported_customer_profile',
  'other',
] as const;

const APPLICATION_CORRECTABLE_FIELDS = [
  'customer_name',
  'phone_country_code',
  'phone_number',
  'email',
  'kyc_documents',
] as const;

function applicationActionRequiredData(row: ApplicationRow) {
  const normalized = normalizeApplication(row);
  return {
    onboarding_stage: row.status,
    submission_round: row.submission_round,
    application_version: row.application_version,
    action_required: normalized.action_required,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > 16_384) {
    return error(413, 'payload_too_large', '请求内容不能超过 16 KB');
  }

  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 16_384) {
      return error(413, 'payload_too_large', '请求内容不能超过 16 KB');
    }
    const body: unknown = JSON.parse(text);
    return isRecord(body) ? body : error(400, 'invalid_json', '请求内容必须是 JSON 对象');
  } catch {
    return error(400, 'invalid_json', '无法解析 JSON 请求内容');
  }
}

function resolveIdempotencyKey(request: Request, required: boolean): string | Response {
  const provided = request.headers.get('Idempotency-Key')?.trim() || '';
  if (required && !provided) {
    return error(422, 'idempotency_key_required', '客户发起资金操作必须提供 Idempotency-Key');
  }
  const key = provided || crypto.randomUUID();
  if (key.length > 128) {
    return error(422, 'validation_error', 'Idempotency-Key 不能超过 128 个字符');
  }
  if (!/^[\x21-\x7e]+$/.test(key)) {
    return error(422, 'validation_error', 'Idempotency-Key 只能包含无空格的可打印 ASCII 字符');
  }
  return key;
}

function normalizeOptionalText(
  value: unknown,
  field: string,
  maxLength = 1000
): string | null | Response {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    return error(422, 'validation_error', `${field} 必须是字符串`);
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    return error(422, 'validation_error', `${field} 不能超过 ${maxLength} 个字符`);
  }
  return normalized;
}

function rejectUnknownFields(
  body: Record<string, unknown>,
  allowedFields: readonly string[]
): Response | null {
  const allowed = new Set(allowedFields);
  const unknownFields = Object.keys(body)
    .filter((field) => !allowed.has(field))
    .sort();
  return unknownFields.length
    ? error(422, 'unknown_fields', '请求包含不受支持的字段', { fields: unknownFields })
    : null;
}

function trustedAccessReviewer(request: Request) {
  const identity = request.headers.get(AUTHENTICATED_ACTOR_HEADER)?.trim().toLowerCase();
  return identity && identity.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity)
    ? identity
    : 'operator';
}

function auditActor(request: Request, actorType: 'operator' | 'partner') {
  const identity = request.headers.get(AUTHENTICATED_ACTOR_HEADER)?.trim().toLowerCase();
  if (identity && identity.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity)) {
    return identity;
  }
  return actorType === 'partner' ? 'partner_api' : 'operator';
}

function auditMetadata(
  request: Request,
  actorType: 'operator' | 'partner',
  metadata: Record<string, unknown>
) {
  return {
    ...metadata,
    actor: auditActor(request, actorType),
  };
}

function withoutAuthenticatedPrincipal(request: Request) {
  const headers = new Headers(request.headers);
  headers.delete(AUTHENTICATED_ACTOR_HEADER);
  return new Request(request, { headers });
}

function withAuthenticatedPrincipal(request: Request, principal: AuthPrincipal) {
  const headers = new Headers(request.headers);
  headers.set(AUTHENTICATED_ACTOR_HEADER, principal.email);
  return new Request(request, { headers });
}

async function requestFingerprint(value: Record<string, unknown>) {
  const input = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateCreate(body: Record<string, unknown>, allowMissingPartnerCustomerId = false) {
  const required = [
    ...(allowMissingPartnerCustomerId ? [] : (['partner_customer_id'] as const)),
    'phone_country_code',
    'phone_number',
    'email',
    'customer_name',
  ] as const;
  const missing = required.filter(
    (key) => typeof body[key] !== 'string' || !String(body[key]).trim()
  );

  if (missing.length) {
    return error(422, 'validation_error', '缺少必填字段', { fields: missing });
  }
  if (
    body.partner_customer_id !== undefined &&
    body.partner_customer_id !== null &&
    (typeof body.partner_customer_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        body.partner_customer_id
      ))
  ) {
    return error(422, 'invalid_partner_customer_id', '客户方客户 ID 必须是小写 UUID v4 字符串', {
      field: 'partner_customer_id',
    });
  }
  if (!/^\+\d{1,3}$/.test(String(body.phone_country_code))) {
    return error(422, 'validation_error', '国家区号格式无效', {
      field: 'phone_country_code',
    });
  }
  if (!SUPPORTED_CALLING_CODE_VALUES.includes(String(body.phone_country_code))) {
    return error(422, 'unsupported_country_code', '该国家区号不在当前支持的国家/地区列表中', {
      field: 'phone_country_code',
    });
  }
  if (!/^[\d\s-]{4,24}$/.test(String(body.phone_number))) {
    return error(422, 'validation_error', '电话号码格式无效', {
      field: 'phone_number',
    });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email))) {
    return error(422, 'validation_error', '电子邮箱格式无效', { field: 'email' });
  }
  if (String(body.email).length > 254 || String(body.customer_name).trim().length > 160) {
    return error(422, 'validation_error', '电子邮箱或客户名称过长');
  }
  return null;
}

function validateAccount(value: unknown): value is VaAccountBody {
  if (!isRecord(value)) return false;
  const requiredFieldsValid = [
    'account_name',
    'account_number',
    'currency',
    'swift_bic',
    'bank_name',
    'bank_address',
  ].every((key) => typeof value[key] === 'string' && String(value[key]).trim());
  const iban = value.iban;
  return requiredFieldsValid && (iban === undefined || iban === null || typeof iban === 'string');
}

async function writeAudit(
  env: Env,
  applicationId: string | null,
  action: string,
  metadata: Record<string, unknown> = {},
  actorType: 'operator' | 'partner' = 'operator'
) {
  await env.DB.prepare(
    `INSERT INTO audit_logs
      (id, application_id, action, actor_type, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      applicationId,
      action,
      actorType,
      JSON.stringify(metadata),
      new Date().toISOString()
    )
    .run();
}

function auditInsertStatement(
  env: Env,
  applicationId: string | null,
  action: string,
  metadata: Record<string, unknown>,
  actorType: 'operator' | 'partner',
  createdAt: string
) {
  return env.DB.prepare(
    `INSERT INTO audit_logs
      (id,application_id,action,actor_type,metadata_json,created_at)
     VALUES (?,?,?,?,?,?)`
  ).bind(
    crypto.randomUUID(),
    applicationId,
    action,
    actorType,
    JSON.stringify(metadata),
    createdAt
  );
}

function guardedAuditStatement(
  env: Env,
  applicationId: string | null,
  action: string,
  metadata: Record<string, unknown>,
  actorType: 'operator' | 'partner',
  createdAt: string,
  source: {
    table: 'fund_transactions' | 'usdt_sweep_batches';
    id: string;
    status: string;
    updatedAt: string;
  }
) {
  return env.DB.prepare(
    `INSERT INTO audit_logs
      (id,application_id,action,actor_type,metadata_json,created_at)
     SELECT ?,?,?,?,?,?
     WHERE EXISTS (
       SELECT 1 FROM ${source.table}
       WHERE id=? AND status=? AND updated_at=?
     )`
  ).bind(
    crypto.randomUUID(),
    applicationId,
    action,
    actorType,
    JSON.stringify(metadata),
    createdAt,
    source.id,
    source.status,
    source.updatedAt
  );
}

function businessAuditStatement(
  env: Env,
  applicationId: string,
  action: string,
  metadata: Record<string, unknown>,
  actorType: 'operator' | 'partner',
  source: {
    table: 'va_applications' | 'fund_transactions' | 'otc_orders';
    id: string;
    status: string;
    updatedAt: string;
    currentReviewId?: string;
    resolvedReview?: {
      id: string;
      idempotencyKey: string;
      requestFingerprint: string;
    };
  }
) {
  return env.DB.prepare(
    `INSERT INTO audit_logs
      (id,application_id,action,actor_type,metadata_json,created_at)
     SELECT ?,?,?,?,?,?
     WHERE EXISTS (
       SELECT 1 FROM ${source.table}
       WHERE id=? AND status=? AND updated_at=?
       ${source.currentReviewId ? 'AND current_review_id=?' : ''}
       ${
         source.resolvedReview
           ? `AND EXISTS (
                SELECT 1 FROM va_application_reviews r
                WHERE r.id=? AND r.application_id=${source.table}.id
                  AND r.idempotency_key=? AND r.request_fingerprint=?
              )`
           : ''
       }
     )`
  ).bind(
    crypto.randomUUID(),
    applicationId,
    action,
    actorType,
    JSON.stringify(metadata),
    source.updatedAt,
    source.id,
    source.status,
    source.updatedAt,
    ...(source.currentReviewId ? [source.currentReviewId] : []),
    ...(source.resolvedReview
      ? [
          source.resolvedReview.id,
          source.resolvedReview.idempotencyKey,
          source.resolvedReview.requestFingerprint,
        ]
      : [])
  );
}

type IpFamily = 4 | 6;

type ParsedIpCidr = {
  family: IpFamily;
  prefixLength: number;
  networkBytes: number[];
  canonical: string;
};

type ApiSecuritySettingsRow = {
  ip_allowlist_enabled: number;
  updated_at: string;
};

type ApiIpAllowlistRow = {
  id: string;
  cidr: string;
  label: string | null;
  enabled: number;
  environment: 'production' | 'disaster_recovery' | 'development';
  source_request_id: string | null;
  created_at: string;
  updated_at: string;
};

type IpAllowlistRequestRow = {
  id: string;
  partner_key: string;
  action: 'add' | 'remove';
  target_entry_id: string | null;
  target_updated_at: string | null;
  cidr: string;
  label: string | null;
  environment: 'production' | 'disaster_recovery' | 'development';
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requested_by: string;
  requested_via: 'portal' | 'api';
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
};

type WebhookRequestRow = {
  id: string;
  partner_key: string;
  action: 'upsert' | 'disable';
  endpoint_url: string | null;
  events_json: string;
  target_updated_at: string | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requested_by: string;
  requested_via: 'portal' | 'api';
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
};

type WebhookSettingsRow = {
  partner_key: string;
  endpoint_url: string | null;
  events_json: string;
  status: 'active' | 'paused' | 'disabled';
  signing_secret_version: string;
  source_request_id: string | null;
  created_at: string;
  updated_at: string;
};

type WebhookDeliveryRow = {
  id: string;
  partner_key: string;
  event_type: WebhookDeliveryEventType;
  resource_type:
    | 'va_application'
    | 'va_account'
    | 'fund_transaction'
    | 'otc_order'
    | 'usdt_sweep_batch'
    | 'webhook';
  resource_id: string;
  application_id: string | null;
  resource_status: string;
  endpoint_url: string;
  payload_json: string;
  signing_secret_version: string;
  status: 'pending' | 'delivering' | 'retry_scheduled' | 'delivered' | 'dead_letter' | 'suppressed';
  attempt_count: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  response_status: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
};

type ApiCredentialRow = {
  id: string;
  partner_key: string;
  provider: 'cloudflare_access';
  service_token_id: string;
  client_id: string;
  client_secret_ciphertext: string | null;
  client_secret_iv: string | null;
  secret_version: number;
  duration: string;
  expires_at: string;
  previous_secret_expires_at: string | null;
  status: 'active' | 'expired' | 'revoked';
  reveal_status: 'available' | 'revealed' | 'unavailable';
  source_request_id: string | null;
  created_at: string;
  updated_at: string;
  revealed_at: string | null;
};

type CredentialRotationRequestRow = {
  id: string;
  partner_key: string;
  service_token_id: string;
  reason: string;
  migration_window_hours: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requested_by: string;
  requested_via: 'portal' | 'api';
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
};

type WebhookSigningKeyRow = {
  id: string;
  partner_key: string;
  secret_ciphertext: string;
  secret_iv: string;
  secret_version: number;
  status: 'available' | 'active' | 'retiring' | 'revoked';
  reveal_status: 'available' | 'revealed';
  source_request_id: string;
  overlap_hours: number;
  created_at: string;
  updated_at: string;
  revealed_at: string | null;
  activated_at: string | null;
  retiring_at: string | null;
  expires_at: string | null;
};

type WebhookSigningKeyRequestRow = {
  id: string;
  partner_key: string;
  reason: string;
  overlap_hours: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requested_by: string;
  requested_via: 'portal' | 'api';
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
};

function parseIpv4Bytes(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part))) {
    return null;
  }
  const bytes = parts.map(Number);
  return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : null;
}

function parseIpv6Bytes(value: string): number[] | null {
  if (!value || value.includes('%')) return null;
  let candidate = value.toLowerCase();

  if (candidate.includes('.')) {
    const lastColon = candidate.lastIndexOf(':');
    if (lastColon < 0) return null;
    const ipv4Bytes = parseIpv4Bytes(candidate.slice(lastColon + 1));
    if (!ipv4Bytes) return null;
    const high = ((ipv4Bytes[0] << 8) | ipv4Bytes[1]).toString(16);
    const low = ((ipv4Bytes[2] << 8) | ipv4Bytes[3]).toString(16);
    candidate = `${candidate.slice(0, lastColon + 1)}${high}:${low}`;
  }

  if (!/^[0-9a-f:]+$/.test(candidate)) return null;
  const compressedIndex = candidate.indexOf('::');
  if (compressedIndex >= 0 && compressedIndex !== candidate.lastIndexOf('::')) {
    return null;
  }

  let groups: string[];
  if (compressedIndex >= 0) {
    const [left, right] = candidate.split('::');
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const missingGroups = 8 - leftGroups.length - rightGroups.length;
    if (missingGroups < 1) return null;
    groups = [...leftGroups, ...Array<string>(missingGroups).fill('0'), ...rightGroups];
  } else {
    groups = candidate.split(':');
    if (groups.length !== 8) return null;
  }

  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null;
  }

  const bytes: number[] = [];
  groups.forEach((group) => {
    const value16 = Number.parseInt(group, 16);
    bytes.push(value16 >> 8, value16 & 0xff);
  });
  return bytes;
}

function maskIpBytes(bytes: number[], prefixLength: number) {
  return bytes.map((byte, index) => {
    const remaining = prefixLength - index * 8;
    if (remaining >= 8) return byte;
    if (remaining <= 0) return 0;
    return byte & ((0xff << (8 - remaining)) & 0xff);
  });
}

function formatIpv6(bytes: number[]) {
  const groups: number[] = [];
  for (let index = 0; index < 16; index += 2) {
    groups.push((bytes[index] << 8) | bytes[index + 1]);
  }

  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length; ) {
    if (groups[index] !== 0) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === 0) end += 1;
    const length = end - index;
    if (length >= 2 && length > bestLength) {
      bestStart = index;
      bestLength = length;
    }
    index = end;
  }

  const formatted = groups.map((group) => group.toString(16));
  if (bestStart < 0) return formatted.join(':');
  const left = formatted.slice(0, bestStart).join(':');
  const right = formatted.slice(bestStart + bestLength).join(':');
  if (!left && !right) return '::';
  if (!left) return `::${right}`;
  if (!right) return `${left}::`;
  return `${left}::${right}`;
}

function parseIpCidr(value: string): ParsedIpCidr | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128 || /\s/.test(trimmed)) return null;
  const parts = trimmed.split('/');
  if (parts.length > 2 || !parts[0]) return null;

  const isIpv6 = parts[0].includes(':');
  const family: IpFamily = isIpv6 ? 6 : 4;
  const bytes = isIpv6 ? parseIpv6Bytes(parts[0]) : parseIpv4Bytes(parts[0]);
  if (!bytes) return null;

  const maximumPrefix = family === 4 ? 32 : 128;
  let prefixLength = maximumPrefix;
  if (parts.length === 2) {
    if (!/^(0|[1-9]\d{0,2})$/.test(parts[1])) return null;
    prefixLength = Number(parts[1]);
    if (prefixLength > maximumPrefix) return null;
  }

  const networkBytes = maskIpBytes(bytes, prefixLength);
  const address = family === 4 ? networkBytes.join('.') : formatIpv6(networkBytes);
  return {
    family,
    prefixLength,
    networkBytes,
    canonical: `${address}/${prefixLength}`,
  };
}

function cidrsOverlap(left: ParsedIpCidr, right: ParsedIpCidr) {
  if (left.family !== right.family) return false;
  const shorter = left.prefixLength <= right.prefixLength ? left : right;
  const longer = shorter === left ? right : left;
  return ipMatchesCidr(longer, shorter);
}

function policyCidr(value: string) {
  const parsed = parseIpCidr(value);
  if (!parsed) throw new Error(`Invalid static IP policy CIDR: ${value}`);
  return parsed;
}

const IPV4_NON_PUBLIC_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.31.196.0/24',
  '192.52.193.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '192.175.48.0/24',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
].map(policyCidr);

const IPV6_GLOBAL_UNICAST_CIDR = policyCidr('2000::/3');
const IPV6_NON_PUBLIC_CIDRS = [
  '2001::/23',
  '2001:db8::/32',
  '2002::/16',
  '2620:4f:8000::/48',
  '3fff::/20',
].map(policyCidr);

function isPublicApiAllowlistCidr(cidr: ParsedIpCidr) {
  if (cidr.family === 4) {
    return (
      cidr.prefixLength >= 8 &&
      !IPV4_NON_PUBLIC_CIDRS.some((blocked) => cidrsOverlap(cidr, blocked))
    );
  }
  return (
    cidr.prefixLength >= 32 &&
    cidr.prefixLength >= IPV6_GLOBAL_UNICAST_CIDR.prefixLength &&
    ipMatchesCidr(cidr, IPV6_GLOBAL_UNICAST_CIDR) &&
    !IPV6_NON_PUBLIC_CIDRS.some((blocked) => cidrsOverlap(cidr, blocked))
  );
}

function parsePublicApiAllowlistCidr(value: string) {
  const parsed = parseIpCidr(value);
  return parsed && isPublicApiAllowlistCidr(parsed) ? parsed : null;
}

function ipMatchesCidr(client: ParsedIpCidr, cidr: ParsedIpCidr) {
  if (client.family !== cidr.family) return false;
  const clientNetwork = maskIpBytes(client.networkBytes, cidr.prefixLength);
  return clientNetwork.every((byte, index) => byte === cidr.networkBytes[index]);
}

function apiSecurityAuditStatement(
  env: Env,
  action: string,
  metadata: Record<string, unknown>,
  now: string
) {
  return env.DB.prepare(
    `INSERT INTO audit_logs
      (id,application_id,action,actor_type,metadata_json,created_at)
     VALUES (?,NULL,?,'operator',?,?)`
  ).bind(crypto.randomUUID(), action, JSON.stringify(metadata), now);
}

function apiSecuritySettingsAuditStatement(
  env: Env,
  action: string,
  metadata: Record<string, unknown>,
  enabled: boolean,
  now: string
) {
  return env.DB.prepare(
    `INSERT INTO audit_logs
      (id,application_id,action,actor_type,metadata_json,created_at)
     SELECT ?,NULL,?,'operator',?,?
     WHERE changes()=1
       AND EXISTS (
         SELECT 1 FROM api_security_settings
         WHERE id=1 AND ip_allowlist_enabled=? AND updated_at=?
       )`
  ).bind(crypto.randomUUID(), action, JSON.stringify(metadata), now, enabled ? 1 : 0, now);
}

function apiSecurityAllowlistAuditStatement(
  env: Env,
  action: string,
  metadata: Record<string, unknown>,
  allowlistId: string,
  now: string,
  deleted = false
) {
  return env.DB.prepare(
    `INSERT INTO audit_logs
      (id,application_id,action,actor_type,metadata_json,created_at)
     SELECT ?,NULL,?,'operator',?,?
     WHERE changes()=1
       AND ${deleted ? 'NOT ' : ''}EXISTS (
         SELECT 1 FROM api_ip_allowlist
         WHERE id=?${deleted ? '' : ' AND updated_at=?'}
       )`
  ).bind(
    crypto.randomUUID(),
    action,
    JSON.stringify(metadata),
    now,
    allowlistId,
    ...(deleted ? [] : [now])
  );
}

function publicAllowlistIds(rows: ApiIpAllowlistRow[], excludedId?: string) {
  return rows
    .filter(
      (row) =>
        row.id !== excludedId && row.enabled === 1 && Boolean(parsePublicApiAllowlistCidr(row.cidr))
    )
    .map((row) => row.id);
}

async function getApiSecuritySettings(env: Env) {
  return env.DB.prepare(
    `SELECT ip_allowlist_enabled,updated_at
     FROM api_security_settings WHERE id=1`
  ).first<ApiSecuritySettingsRow>();
}

async function listApiIpAllowlistRows(env: Env) {
  const result = await env.DB.prepare(
    `SELECT id,cidr,label,enabled,environment,source_request_id,created_at,updated_at
     FROM api_ip_allowlist
     ORDER BY created_at DESC`
  ).all<ApiIpAllowlistRow>();
  return result.results;
}

async function getApiIpAllowlistRow(env: Env, id: string) {
  return env.DB.prepare(
    `SELECT id,cidr,label,enabled,environment,source_request_id,created_at,updated_at
     FROM api_ip_allowlist WHERE id=?`
  )
    .bind(id)
    .first<ApiIpAllowlistRow>();
}

function normalizeApiIpAllowlistRow(row: ApiIpAllowlistRow) {
  const parsed = parsePublicApiAllowlistCidr(row.cidr);
  return {
    ...row,
    cidr: parsed?.canonical || row.cidr,
    enabled: row.enabled === 1,
    valid: Boolean(parsed && isPublicApiAllowlistCidr(parsed)),
  };
}

async function getApiSecurityState(env: Env) {
  const [settings, ipAllowlist] = await Promise.all([
    getApiSecuritySettings(env),
    listApiIpAllowlistRows(env),
  ]);
  const validEntryCount = ipAllowlist.reduce(
    (count, row) => count + (row.enabled === 1 && parsePublicApiAllowlistCidr(row.cidr) ? 1 : 0),
    0
  );
  return {
    enabled: settings?.ip_allowlist_enabled === 1,
    ip_allowlist_enabled: settings?.ip_allowlist_enabled === 1,
    valid_entry_count: validEntryCount,
    updated_at: settings?.updated_at || null,
    ip_allowlist: ipAllowlist.map(normalizeApiIpAllowlistRow),
    rate_limit: {
      enabled: true,
      limit: 120,
      period_seconds: 60,
    },
  };
}

async function listApiSecurity(env: Env) {
  return json({
    data: {
      access_service_token_required: true,
      ...(await getApiSecurityState(env)),
    },
  });
}

function validateApiIpCidr(value: unknown): ParsedIpCidr | Response {
  if (typeof value !== 'string') {
    return error(422, 'validation_error', 'cidr 必须是 IPv4、IPv6 或 CIDR 字符串');
  }
  const parsed = parseIpCidr(value);
  if (!parsed) {
    return error(
      422,
      'validation_error',
      'cidr 必须是有效的 IPv4、IPv6 或 CIDR，且前缀长度不能有前导零'
    );
  }
  if (!isPublicApiAllowlistCidr(parsed)) {
    return error(
      422,
      'api_ip_allowlist_non_public_network',
      'cidr 必须是全球公网单播地址，且不能是过宽或保留网段'
    );
  }
  return parsed;
}

function validateApiIpLabel(value: unknown): string | null | Response {
  if (value === null) return null;
  if (typeof value !== 'string') {
    return error(422, 'validation_error', 'label 必须是字符串或 null');
  }
  const label = value.trim();
  if (!label || label.length > 120) {
    return error(422, 'validation_error', 'label 长度必须为 1 到 120 个字符');
  }
  return label;
}

async function updateApiSecurity(env: Env, request: Request, requestId: string) {
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  if (
    parsed.ip_allowlist_enabled !== undefined &&
    parsed.enabled !== undefined &&
    parsed.ip_allowlist_enabled !== parsed.enabled
  ) {
    return error(422, 'validation_error', '白名单开关字段相互冲突');
  }
  const enabledValue = parsed.ip_allowlist_enabled ?? parsed.enabled;
  if (typeof enabledValue !== 'boolean') {
    return error(422, 'validation_error', 'ip_allowlist_enabled 必须是布尔值');
  }

  const current = await getApiSecuritySettings(env);
  if (!current) {
    return error(500, 'api_security_configuration_missing', 'API 安全配置不存在');
  }
  const nextEnabled = enabledValue;
  const currentEnabled = current.ip_allowlist_enabled === 1;
  let validEntryIds: string[] = [];
  if (nextEnabled) {
    const rows = await listApiIpAllowlistRows(env);
    validEntryIds = publicAllowlistIds(rows);
    if (validEntryIds.length === 0) {
      return error(409, 'api_ip_allowlist_empty', '至少添加一个有效的 IP 或 CIDR 后才能启用白名单');
    }
  }
  if (nextEnabled === currentEnabled) return listApiSecurity(env);

  const now = new Date().toISOString();
  const updateStatement = nextEnabled
    ? env.DB.prepare(
        `UPDATE api_security_settings
         SET ip_allowlist_enabled=1,updated_at=?
         WHERE id=1 AND updated_at=?
           AND EXISTS (
             SELECT 1 FROM api_ip_allowlist
             WHERE enabled=1
               AND id IN (SELECT value FROM json_each(?))
           )`
      ).bind(now, current.updated_at, JSON.stringify(validEntryIds))
    : env.DB.prepare(
        `UPDATE api_security_settings
         SET ip_allowlist_enabled=0,updated_at=?
         WHERE id=1 AND updated_at=?`
      ).bind(now, current.updated_at);
  const [result] = await env.DB.batch([
    updateStatement,
    apiSecuritySettingsAuditStatement(
      env,
      'api_security.ip_allowlist_toggled',
      {
        old_enabled: currentEnabled,
        new_enabled: nextEnabled,
      },
      nextEnabled,
      now
    ),
  ]);
  if (result.meta.changes === 0) {
    const latest = await getApiSecuritySettings(env);
    if (nextEnabled) {
      const latestRows = await listApiIpAllowlistRows(env);
      if (publicAllowlistIds(latestRows).length === 0) {
        return error(
          409,
          'api_ip_allowlist_empty',
          '至少添加一个有效的 IP 或 CIDR 后才能启用白名单'
        );
      }
    }
    if (latest && (latest.ip_allowlist_enabled === 1) === nextEnabled) {
      return listApiSecurity(env);
    }
    return error(409, 'stale_api_security_settings', 'API 安全配置已发生变化，请重试');
  }
  console.log(
    JSON.stringify({
      event: 'partner_api_ip_allowlist_toggled',
      request_id: requestId,
      old_enabled: currentEnabled,
      new_enabled: nextEnabled,
    })
  );
  return listApiSecurity(env);
}

async function createApiIpAllowlist(env: Env, request: Request) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsedCidr = validateApiIpCidr(body.cidr);
  if (parsedCidr instanceof Response) return parsedCidr;
  const parsedLabel = body.label === undefined ? null : validateApiIpLabel(body.label);
  if (parsedLabel instanceof Response) return parsedLabel;
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    return error(422, 'validation_error', 'enabled 必须是布尔值');
  }
  const enabled = body.enabled === undefined ? true : body.enabled;

  const id = `ip_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO api_ip_allowlist
          (id,cidr,label,enabled,created_at,updated_at)
         VALUES (?,?,?,?,?,?)`
      ).bind(id, parsedCidr.canonical, parsedLabel, enabled ? 1 : 0, now, now),
      apiSecurityAuditStatement(
        env,
        'api_security.ip_allowlist_created',
        {
          allowlist_id: id,
          cidr: parsedCidr.canonical,
          label: parsedLabel,
          enabled,
        },
        now
      ),
    ]);
  } catch (caught) {
    if ((caught instanceof Error ? caught.message : '').includes('UNIQUE')) {
      return error(409, 'duplicate_ip_allowlist_entry', '该 IP 或 CIDR 已在白名单中');
    }
    throw caught;
  }

  const row = await getApiIpAllowlistRow(env, id);
  return json({ data: normalizeApiIpAllowlistRow(row as ApiIpAllowlistRow) }, 201, {
    location: `/api/v1/admin/api-security/ip-allowlist/${id}`,
  });
}

async function updateApiIpAllowlist(env: Env, id: string, request: Request) {
  const current = await getApiIpAllowlistRow(env, id);
  if (!current) return error(404, 'not_found', 'IP 白名单条目不存在');

  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (body.cidr === undefined && body.label === undefined && body.enabled === undefined) {
    return error(422, 'validation_error', '没有可更新的字段');
  }

  let nextCidr = current.cidr;
  if (body.cidr !== undefined) {
    const parsedCidr = validateApiIpCidr(body.cidr);
    if (parsedCidr instanceof Response) return parsedCidr;
    nextCidr = parsedCidr.canonical;
  }
  let nextLabel = current.label;
  if (body.label !== undefined) {
    const parsedLabel = validateApiIpLabel(body.label);
    if (parsedLabel instanceof Response) return parsedLabel;
    nextLabel = parsedLabel;
  }
  let nextEnabled = current.enabled === 1;
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') {
      return error(422, 'validation_error', 'enabled 必须是布尔值');
    }
    nextEnabled = body.enabled;
  }
  if (
    nextCidr === current.cidr &&
    nextLabel === current.label &&
    nextEnabled === (current.enabled === 1)
  ) {
    return json({ data: normalizeApiIpAllowlistRow(current) });
  }
  const disablesValidEntry = Boolean(
    current.enabled === 1 && parsePublicApiAllowlistCidr(current.cidr) && !nextEnabled
  );
  let otherValidEntryIds: string[] = [];
  if (disablesValidEntry) {
    const [settings, rows] = await Promise.all([
      getApiSecuritySettings(env),
      listApiIpAllowlistRows(env),
    ]);
    otherValidEntryIds = publicAllowlistIds(rows, id);
    if (settings?.ip_allowlist_enabled === 1 && otherValidEntryIds.length === 0) {
      return error(
        409,
        'api_ip_allowlist_would_lock_out',
        '全局白名单已启用，不能停用最后一条有效规则'
      );
    }
  }

  const now = new Date().toISOString();
  try {
    const updateStatement = disablesValidEntry
      ? env.DB.prepare(
          `UPDATE api_ip_allowlist
           SET cidr=?,label=?,enabled=0,updated_at=?
           WHERE id=? AND updated_at=?
             AND (
               NOT EXISTS (
                 SELECT 1 FROM api_security_settings
                 WHERE id=1 AND ip_allowlist_enabled=1
               )
               OR EXISTS (
                 SELECT 1 FROM api_ip_allowlist
                 WHERE enabled=1
                   AND id IN (SELECT value FROM json_each(?))
               )
             )`
        ).bind(nextCidr, nextLabel, now, id, current.updated_at, JSON.stringify(otherValidEntryIds))
      : env.DB.prepare(
          `UPDATE api_ip_allowlist
           SET cidr=?,label=?,enabled=?,updated_at=?
           WHERE id=? AND updated_at=?`
        ).bind(nextCidr, nextLabel, nextEnabled ? 1 : 0, now, id, current.updated_at);
    const [result] = await env.DB.batch([
      updateStatement,
      apiSecurityAllowlistAuditStatement(
        env,
        'api_security.ip_allowlist_updated',
        {
          allowlist_id: id,
          old_cidr: current.cidr,
          new_cidr: nextCidr,
          old_label: current.label,
          new_label: nextLabel,
          old_enabled: current.enabled === 1,
          new_enabled: nextEnabled,
        },
        id,
        now
      ),
    ]);
    if (result.meta.changes === 0) {
      const latest = await getApiIpAllowlistRow(env, id);
      if (!latest) return error(404, 'not_found', 'IP 白名单条目不存在');
      if (disablesValidEntry) {
        const [settings, rows] = await Promise.all([
          getApiSecuritySettings(env),
          listApiIpAllowlistRows(env),
        ]);
        if (settings?.ip_allowlist_enabled === 1 && publicAllowlistIds(rows, id).length === 0) {
          return error(
            409,
            'api_ip_allowlist_would_lock_out',
            '全局白名单已启用，不能停用最后一条有效规则'
          );
        }
      }
      return error(409, 'stale_ip_allowlist_entry', 'IP 白名单条目已发生变化，请重试');
    }
  } catch (caught) {
    if ((caught instanceof Error ? caught.message : '').includes('UNIQUE')) {
      return error(409, 'duplicate_ip_allowlist_entry', '该 IP 或 CIDR 已在白名单中');
    }
    throw caught;
  }

  const updated = await getApiIpAllowlistRow(env, id);
  return json({
    data: normalizeApiIpAllowlistRow(updated as ApiIpAllowlistRow),
  });
}

async function deleteApiIpAllowlist(env: Env, id: string) {
  const current = await getApiIpAllowlistRow(env, id);
  if (!current) return error(404, 'not_found', 'IP 白名单条目不存在');
  const deletesValidEntry = Boolean(
    current.enabled === 1 && parsePublicApiAllowlistCidr(current.cidr)
  );
  let otherValidEntryIds: string[] = [];
  if (deletesValidEntry) {
    const [settings, rows] = await Promise.all([
      getApiSecuritySettings(env),
      listApiIpAllowlistRows(env),
    ]);
    otherValidEntryIds = publicAllowlistIds(rows, id);
    if (settings?.ip_allowlist_enabled === 1 && otherValidEntryIds.length === 0) {
      return error(
        409,
        'api_ip_allowlist_would_lock_out',
        '全局白名单已启用，不能删除最后一条有效规则'
      );
    }
  }

  const now = new Date().toISOString();
  const deleteStatement = deletesValidEntry
    ? env.DB.prepare(
        `DELETE FROM api_ip_allowlist
         WHERE id=? AND updated_at=?
           AND (
             NOT EXISTS (
               SELECT 1 FROM api_security_settings
               WHERE id=1 AND ip_allowlist_enabled=1
             )
             OR EXISTS (
               SELECT 1 FROM api_ip_allowlist
               WHERE enabled=1
                 AND id IN (SELECT value FROM json_each(?))
             )
           )`
      ).bind(id, current.updated_at, JSON.stringify(otherValidEntryIds))
    : env.DB.prepare(`DELETE FROM api_ip_allowlist WHERE id=? AND updated_at=?`).bind(
        id,
        current.updated_at
      );
  const [result] = await env.DB.batch([
    deleteStatement,
    apiSecurityAllowlistAuditStatement(
      env,
      'api_security.ip_allowlist_deleted',
      {
        allowlist_id: id,
        cidr: current.cidr,
        label: current.label,
        enabled: current.enabled === 1,
      },
      id,
      now,
      true
    ),
  ]);
  if (result.meta.changes === 0) {
    const latest = await getApiIpAllowlistRow(env, id);
    if (!latest) return error(404, 'not_found', 'IP 白名单条目不存在');
    if (deletesValidEntry) {
      const [settings, rows] = await Promise.all([
        getApiSecuritySettings(env),
        listApiIpAllowlistRows(env),
      ]);
      if (settings?.ip_allowlist_enabled === 1 && publicAllowlistIds(rows, id).length === 0) {
        return error(
          409,
          'api_ip_allowlist_would_lock_out',
          '全局白名单已启用，不能删除最后一条有效规则'
        );
      }
    }
    return error(409, 'stale_ip_allowlist_entry', 'IP 白名单条目已发生变化，请重试');
  }
  return new Response(null, {
    status: 204,
    headers: { 'cache-control': 'no-store' },
  });
}

async function enforcePartnerApiIpAllowlist(
  env: Env,
  request: Request,
  path: string,
  requestId: string
): Promise<Response | null> {
  const settings = await getApiSecuritySettings(env);
  if (!settings) {
    console.error(
      JSON.stringify({
        event: 'partner_api_security_configuration_missing',
        request_id: requestId,
        path,
      })
    );
    return error(503, 'api_security_configuration_missing', 'Partner API 安全配置不可用');
  }
  if (settings.ip_allowlist_enabled !== 1) return null;

  const rows = await listApiIpAllowlistRows(env);
  const validCidrs = rows
    .filter((row) => row.enabled === 1)
    .map((row) => parsePublicApiAllowlistCidr(row.cidr))
    .filter((cidr): cidr is ParsedIpCidr => Boolean(cidr));
  const connectingIpv6 = request.headers.get('CF-Connecting-IPv6');
  const clientIpValue = connectingIpv6 || request.headers.get('CF-Connecting-IP');
  const client = clientIpValue && !clientIpValue.includes('/') ? parseIpCidr(clientIpValue) : null;
  const hasInvalidConnectingIpv6 = Boolean(connectingIpv6 && client?.family !== 6);
  const allowed = Boolean(
    client &&
      !hasInvalidConnectingIpv6 &&
      validCidrs.length &&
      validCidrs.some((cidr) => ipMatchesCidr(client, cidr))
  );
  if (allowed) return null;

  const reason =
    validCidrs.length === 0
      ? 'no_valid_allowlist_entries'
      : !clientIpValue
      ? 'missing_cf_connecting_ip'
      : !client || hasInvalidConnectingIpv6
      ? 'invalid_cf_connecting_ip'
      : 'ip_not_allowed';
  console.warn(
    JSON.stringify({
      event: 'partner_api_ip_rejected',
      request_id: requestId,
      reason,
      path,
    })
  );
  return error(403, 'api_ip_not_allowed', '当前请求 IP 不在 Partner API 白名单中');
}

function integrationAuditStatement(
  env: Env,
  action: string,
  metadata: Record<string, unknown>,
  actorType: 'operator' | 'partner',
  now: string
) {
  return env.DB.prepare(
    `INSERT INTO audit_logs
      (id,application_id,action,actor_type,metadata_json,created_at)
     VALUES (?,NULL,?,?,?,?)`
  ).bind(crypto.randomUUID(), action, actorType, JSON.stringify(metadata), now);
}

function reviewedIntegrationAuditStatement(
  env: Env,
  action: string,
  metadata: Record<string, unknown>,
  requestTable:
    | 'api_ip_allowlist_requests'
    | 'partner_webhook_requests'
    | 'partner_api_credential_rotation_requests'
    | 'partner_webhook_signing_key_requests',
  requestId: string,
  nextStatus: 'approved' | 'rejected',
  now: string
) {
  return env.DB.prepare(
    `INSERT INTO audit_logs
      (id,application_id,action,actor_type,metadata_json,created_at)
     SELECT ?,NULL,?,'operator',?,?
     WHERE EXISTS (
       SELECT 1 FROM ${requestTable}
       WHERE id=? AND status=? AND updated_at=?
     )`
  ).bind(crypto.randomUUID(), action, JSON.stringify(metadata), now, requestId, nextStatus, now);
}

function integrationStateAuditStatement(
  env: Env,
  action: string,
  metadata: Record<string, unknown>,
  actorType: 'operator' | 'partner',
  targetTable:
    | 'api_ip_allowlist_requests'
    | 'partner_webhook_requests'
    | 'partner_api_credential_rotation_requests'
    | 'webhook_deliveries',
  targetId: string,
  nextStatus: 'cancelled' | 'pending',
  now: string
) {
  return env.DB.prepare(
    `INSERT INTO audit_logs
      (id,application_id,action,actor_type,metadata_json,created_at)
     SELECT ?,NULL,?,?,?,?
     WHERE changes()=1
       AND EXISTS (
         SELECT 1 FROM ${targetTable}
         WHERE id=? AND partner_key=? AND status=? AND updated_at=?
       )`
  ).bind(
    crypto.randomUUID(),
    action,
    actorType,
    JSON.stringify(metadata),
    now,
    targetId,
    PARTNER_KEY,
    nextStatus,
    now
  );
}

function parseWebhookEventsJson(value: string): WebhookEventType[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const values = new Set(
      parsed.filter(
        (event): event is WebhookEventType =>
          typeof event === 'string' && WEBHOOK_EVENTS.includes(event as WebhookEventType)
      )
    );
    return WEBHOOK_EVENTS.filter((event) => values.has(event));
  } catch {
    return [];
  }
}

function validateWebhookEvents(value: unknown): WebhookEventType[] | Response {
  if (!Array.isArray(value) || value.length < 1) {
    return error(422, 'validation_error', 'events 必须至少选择一个支持的 Webhook 事件');
  }
  const unsupported = value.some(
    (event) => typeof event !== 'string' || !WEBHOOK_EVENTS.includes(event as WebhookEventType)
  );
  if (unsupported) {
    return error(422, 'validation_error', 'Webhook 事件类型不受支持', {
      supported_events: WEBHOOK_EVENTS,
    });
  }
  const selected = new Set(value as WebhookEventType[]);
  return WEBHOOK_EVENTS.filter((event) => selected.has(event));
}

function validateWebhookEndpoint(value: unknown): string | Response {
  if (typeof value !== 'string') {
    return error(422, 'validation_error', 'endpoint_url 必须是公共 HTTPS 地址');
  }
  const raw = value.trim();
  if (raw.length < 10 || raw.length > 2048) {
    return error(422, 'validation_error', 'endpoint_url 长度必须为 10 到 2048 个字符');
  }

  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    return error(422, 'validation_error', 'endpoint_url 必须是有效的公共 HTTPS 地址');
  }
  const hostname = endpoint.hostname.toLowerCase();
  const labels = hostname.split('.');
  const reservedSuffixes = [
    '.localhost',
    '.local',
    '.internal',
    '.home',
    '.lan',
    '.test',
    '.invalid',
    '.example',
  ];
  const validLabels =
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    );
  const topLevel = labels.at(-1) || '';
  const validTopLevel = /^[a-z]{2,63}$/.test(topLevel) || /^xn--[a-z0-9-]{2,59}$/.test(topLevel);
  const isIpLiteral =
    Boolean(parseIpv4Bytes(hostname)) || hostname.includes(':') || hostname.startsWith('[');
  if (
    endpoint.protocol !== 'https:' ||
    Boolean(endpoint.username) ||
    Boolean(endpoint.password) ||
    Boolean(endpoint.search) ||
    Boolean(endpoint.hash) ||
    Boolean(endpoint.port && endpoint.port !== '443') ||
    !validLabels ||
    !validTopLevel ||
    isIpLiteral ||
    hostname === 'localhost' ||
    reservedSuffixes.some((suffix) => hostname.endsWith(suffix))
  ) {
    return error(422, 'validation_error', 'Webhook 仅允许公共 HTTPS 域名和标准 443 端口');
  }
  return endpoint.toString();
}

function validateIntegrationEnvironment(
  value: unknown
): ApiIpAllowlistRow['environment'] | Response {
  const environment = value === undefined ? 'production' : value;
  if (
    environment !== 'production' &&
    environment !== 'disaster_recovery' &&
    environment !== 'development'
  ) {
    return error(
      422,
      'validation_error',
      'environment 必须是 production、disaster_recovery 或 development'
    );
  }
  return environment;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function localCredentialDemoEnabled(request: Request, env: WebhookEnv) {
  const url = new URL(request.url);
  return (
    env.API_CREDENTIAL_LOCAL_DEMO === 'true' &&
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
  );
}

async function credentialEncryptionKey(env: WebhookEnv, localDemo = false) {
  let encodedKey = env.API_CREDENTIAL_ENCRYPTION_KEY;
  if (!encodedKey && localDemo && env.AUTH_SESSION_SECRET) {
    const derived = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`local-api-credential:${env.AUTH_SESSION_SECRET}`)
    );
    encodedKey = bytesToBase64Url(new Uint8Array(derived));
  }
  if (!encodedKey) {
    throw new Error('API_CREDENTIAL_ENCRYPTION_KEY is missing');
  }
  const bytes = base64UrlToBytes(encodedKey);
  if (bytes.length !== 32) {
    throw new Error('API_CREDENTIAL_ENCRYPTION_KEY must be a base64url 32-byte key');
  }
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function credentialAdditionalData(credentialId: string, secretVersion: number) {
  return new TextEncoder().encode(`va-api-credential:${credentialId}:v${secretVersion}`);
}

async function encryptApiCredentialSecret(
  env: WebhookEnv,
  credentialId: string,
  secretVersion: number,
  value: string,
  localDemo = false
) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: credentialAdditionalData(credentialId, secretVersion),
      tagLength: 128,
    },
    await credentialEncryptionKey(env, localDemo),
    new TextEncoder().encode(value)
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

async function decryptApiCredentialSecret(
  env: WebhookEnv,
  row: ApiCredentialRow,
  localDemo = false
) {
  if (!row.client_secret_ciphertext || !row.client_secret_iv) {
    throw new Error('API credential secret is not available');
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlToBytes(row.client_secret_iv),
      additionalData: credentialAdditionalData(row.id, row.secret_version),
      tagLength: 128,
    },
    await credentialEncryptionKey(env, localDemo),
    base64UrlToBytes(row.client_secret_ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}

function webhookSigningKeyAdditionalData(keyId: string, secretVersion: number) {
  return new TextEncoder().encode(`va-webhook-signing-key:${keyId}:v${secretVersion}`);
}

async function encryptWebhookSigningSecret(
  env: WebhookEnv,
  keyId: string,
  secretVersion: number,
  value: string,
  localDemo = false
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: webhookSigningKeyAdditionalData(keyId, secretVersion),
      tagLength: 128,
    },
    await credentialEncryptionKey(env, localDemo),
    new TextEncoder().encode(value)
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

async function decryptWebhookSigningSecret(
  env: WebhookEnv,
  row: WebhookSigningKeyRow,
  localDemo = false
) {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlToBytes(row.secret_iv),
      additionalData: webhookSigningKeyAdditionalData(row.id, row.secret_version),
      tagLength: 128,
    },
    await credentialEncryptionKey(env, localDemo),
    base64UrlToBytes(row.secret_ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}

type CloudflareServiceTokenResult = {
  id?: string;
  client_id?: string;
  client_secret?: string;
  duration?: string;
  expires_at?: string;
};

async function rotateCloudflareAccessServiceToken(
  env: WebhookEnv,
  previousSecretExpiresAt: string
): Promise<CloudflareServiceTokenResult | Response> {
  const missing = [
    !env.CLOUDFLARE_ACCOUNT_ID && 'CLOUDFLARE_ACCOUNT_ID',
    !env.PARTNER_ACCESS_SERVICE_TOKEN_ID && 'PARTNER_ACCESS_SERVICE_TOKEN_ID',
    !env.CLOUDFLARE_ACCESS_MANAGEMENT_API_TOKEN && 'CLOUDFLARE_ACCESS_MANAGEMENT_API_TOKEN',
    !env.API_CREDENTIAL_ENCRYPTION_KEY && 'API_CREDENTIAL_ENCRYPTION_KEY',
  ].filter((value): value is string => Boolean(value));
  if (missing.length) {
    return error(503, 'api_credential_management_unavailable', 'API 凭证管理尚未完成后台配置', {
      missing,
    });
  }
  const accountId = env.CLOUDFLARE_ACCOUNT_ID as string;
  const serviceTokenId = env.PARTNER_ACCESS_SERVICE_TOKEN_ID as string;
  const managementToken = env.CLOUDFLARE_ACCESS_MANAGEMENT_API_TOKEN as string;

  const serviceTokenEndpoint =
    `https://api.cloudflare.com/client/v4/accounts/` +
    `${encodeURIComponent(accountId)}/access/service_tokens/` +
    `${encodeURIComponent(serviceTokenId)}`;
  const authorization = `Bearer ${managementToken}`;
  let metadataResponse: Response;
  try {
    metadataResponse = await fetch(serviceTokenEndpoint, {
      headers: { authorization },
    });
  } catch {
    return error(502, 'cloudflare_access_unavailable', 'Cloudflare Access 凭证服务暂时不可用');
  }
  let metadataPayload: {
    success?: boolean;
    result?: CloudflareServiceTokenResult;
  };
  try {
    metadataPayload = (await metadataResponse.json()) as typeof metadataPayload;
  } catch {
    return error(502, 'cloudflare_access_invalid_response', 'Cloudflare Access 返回了无效响应');
  }
  if (
    !metadataResponse.ok ||
    metadataPayload.success !== true ||
    !metadataPayload.result?.expires_at
  ) {
    return error(
      502,
      'cloudflare_access_metadata_failed',
      '无法读取当前 Cloudflare Access 凭证状态'
    );
  }

  let refreshed: CloudflareServiceTokenResult;
  try {
    const refreshResponse = await fetch(`${serviceTokenEndpoint}/refresh`, {
      method: 'POST',
      headers: { authorization },
    });
    const refreshPayload = (await refreshResponse.json()) as {
      success?: boolean;
      result?: CloudflareServiceTokenResult;
      errors?: { code?: number; message?: string }[];
    };
    if (
      !refreshResponse.ok ||
      refreshPayload.success !== true ||
      !refreshPayload.result?.id ||
      !refreshPayload.result.expires_at
    ) {
      console.error(
        JSON.stringify({
          event: 'cloudflare_access_service_token_refresh_failed',
          status: refreshResponse.status,
          errors: refreshPayload.errors || [],
        })
      );
      return error(502, 'cloudflare_access_refresh_failed', 'Cloudflare Access 凭证有效期刷新失败');
    }
    refreshed = refreshPayload.result;
  } catch {
    return error(502, 'cloudflare_access_unavailable', 'Cloudflare Access 凭证服务暂时不可用');
  }

  let response: Response;
  try {
    response = await fetch(`${serviceTokenEndpoint}/rotate`, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        previous_client_secret_expires_at: previousSecretExpiresAt,
      }),
    });
  } catch {
    return error(502, 'cloudflare_access_unavailable', 'Cloudflare Access 凭证服务暂时不可用');
  }

  let payload: {
    success?: boolean;
    result?: CloudflareServiceTokenResult;
    errors?: { code?: number; message?: string }[];
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    return error(502, 'cloudflare_access_invalid_response', 'Cloudflare Access 返回了无效响应');
  }
  if (
    !response.ok ||
    payload.success !== true ||
    !payload.result?.id ||
    !payload.result.client_id ||
    !payload.result.client_secret ||
    !payload.result.duration
  ) {
    console.error(
      JSON.stringify({
        event: 'cloudflare_access_service_token_rotation_failed',
        status: response.status,
        errors: payload.errors || [],
      })
    );
    return error(502, 'cloudflare_access_rotation_failed', 'Cloudflare Access 凭证轮换失败');
  }
  return {
    ...payload.result,
    expires_at: refreshed.expires_at,
  };
}

function normalizeApiCredential(row: ApiCredentialRow) {
  return {
    id: row.id,
    provider: row.provider,
    client_id: row.client_id,
    secret_version: row.secret_version,
    duration: row.duration,
    expires_at: row.expires_at,
    previous_secret_expires_at: row.previous_secret_expires_at,
    status: row.status,
    reveal_status: row.reveal_status,
    secret_available: row.reveal_status === 'available',
    source_request_id: row.source_request_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    revealed_at: row.revealed_at,
  };
}

function normalizeCredentialRotationRequest(
  row: CredentialRotationRequestRow,
  includeInternalFields: boolean
) {
  return {
    id: row.id,
    kind: 'credential_rotation' as const,
    partner_key: row.partner_key,
    reason: row.reason,
    migration_window_hours: row.migration_window_hours,
    status: row.status,
    requested_by: row.requested_by,
    requested_via: row.requested_via,
    review_note: row.review_note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reviewed_at: row.reviewed_at,
    ...(includeInternalFields ? { reviewed_by: row.reviewed_by } : {}),
  };
}

function normalizeIpAllowlistRequest(row: IpAllowlistRequestRow, includeInternalFields: boolean) {
  return {
    id: row.id,
    kind: 'ip_allowlist' as const,
    partner_key: row.partner_key,
    action: row.action,
    target_entry_id: row.target_entry_id,
    cidr: row.cidr,
    label: row.label,
    environment: row.environment,
    reason: row.reason,
    status: row.status,
    requested_by: row.requested_by,
    requested_via: row.requested_via,
    review_note: row.review_note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reviewed_at: row.reviewed_at,
    ...(includeInternalFields
      ? {
          reviewed_by: row.reviewed_by,
          target_updated_at: row.target_updated_at,
        }
      : {}),
  };
}

function normalizeWebhookRequest(row: WebhookRequestRow, includeInternalFields: boolean) {
  return {
    id: row.id,
    kind: 'webhook' as const,
    partner_key: row.partner_key,
    action: row.action,
    endpoint_url: row.endpoint_url,
    events: parseWebhookEventsJson(row.events_json),
    reason: row.reason,
    status: row.status,
    requested_by: row.requested_by,
    requested_via: row.requested_via,
    review_note: row.review_note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reviewed_at: row.reviewed_at,
    ...(includeInternalFields
      ? {
          reviewed_by: row.reviewed_by,
          target_updated_at: row.target_updated_at,
        }
      : {}),
  };
}

function normalizeWebhookSettings(
  row: WebhookSettingsRow,
  includeInternalFields: boolean,
  deliveryTimes?: {
    last_delivery_at: string | null;
    last_success_at: string | null;
  } | null
) {
  return {
    id: row.partner_key,
    partner_key: row.partner_key,
    endpoint_url: row.endpoint_url,
    events: parseWebhookEventsJson(row.events_json),
    status: row.status,
    last_delivery_at: deliveryTimes?.last_delivery_at || null,
    last_success_at: deliveryTimes?.last_success_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(includeInternalFields
      ? {
          signing_secret_version: row.signing_secret_version,
          source_request_id: row.source_request_id,
        }
      : {}),
  };
}

function normalizeWebhookDelivery(row: WebhookDeliveryRow, includeInternalFields: boolean) {
  return {
    id: row.id,
    event_type: row.event_type,
    resource_type: row.resource_type,
    resource_id: row.resource_id,
    application_id: row.application_id,
    resource_status: row.resource_status,
    endpoint_url: row.endpoint_url,
    status: row.status,
    attempt_count: row.attempt_count,
    next_attempt_at: row.next_attempt_at,
    last_attempt_at: row.last_attempt_at,
    response_status: row.response_status,
    payload_json: row.payload_json,
    created_at: row.created_at,
    updated_at: row.updated_at,
    delivered_at: row.delivered_at,
    ...(includeInternalFields
      ? {
          last_error: row.last_error,
          signing_secret_version: row.signing_secret_version,
        }
      : {}),
  };
}

function normalizeWebhookSigningKey(row: WebhookSigningKeyRow) {
  return {
    id: row.id,
    key_id: row.id,
    secret_version: row.secret_version,
    status: row.status,
    reveal_status: row.reveal_status,
    secret_available: row.reveal_status === 'available',
    overlap_hours: row.overlap_hours,
    created_at: row.created_at,
    updated_at: row.updated_at,
    revealed_at: row.revealed_at,
    activated_at: row.activated_at,
    retiring_at: row.retiring_at,
    expires_at: row.expires_at,
  };
}

function normalizeWebhookSigningKeyRequest(
  row: WebhookSigningKeyRequestRow,
  includeInternalFields: boolean
) {
  return {
    id: row.id,
    kind: 'webhook_signing_key' as const,
    reason: row.reason,
    overlap_hours: row.overlap_hours,
    status: row.status,
    requested_by: row.requested_by,
    requested_via: row.requested_via,
    review_note: row.review_note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reviewed_at: row.reviewed_at,
    ...(includeInternalFields ? { reviewed_by: row.reviewed_by } : {}),
  };
}

async function getWebhookSettings(env: Env) {
  return env.DB.prepare(
    `SELECT partner_key,endpoint_url,events_json,status,signing_secret_version,
      source_request_id,created_at,updated_at
     FROM partner_webhook_settings WHERE partner_key=?`
  )
    .bind(PARTNER_KEY)
    .first<WebhookSettingsRow>();
}

async function listApiIntegration(
  env: WebhookEnv,
  includeInternalFields: boolean,
  request: Request
) {
  const [
    security,
    ipRows,
    ipRequests,
    webhookRequests,
    credentials,
    credentialRotationRequests,
    webhookSigningKeys,
    webhookSigningKeyRequests,
    webhookSettings,
    deliveries,
    webhookDeliveryTimes,
    pendingCount,
    failedCount,
  ] = await Promise.all([
    getApiSecurityState(env),
    listApiIpAllowlistRows(env),
    env.DB.prepare(
      `SELECT * FROM api_ip_allowlist_requests
       WHERE partner_key=? ORDER BY created_at DESC LIMIT 100`
    )
      .bind(PARTNER_KEY)
      .all<IpAllowlistRequestRow>(),
    env.DB.prepare(
      `SELECT * FROM partner_webhook_requests
       WHERE partner_key=? ORDER BY created_at DESC LIMIT 100`
    )
      .bind(PARTNER_KEY)
      .all<WebhookRequestRow>(),
    env.DB.prepare(
      `SELECT * FROM partner_api_credentials
       WHERE partner_key=? ORDER BY updated_at DESC LIMIT 10`
    )
      .bind(PARTNER_KEY)
      .all<ApiCredentialRow>(),
    env.DB.prepare(
      `SELECT * FROM partner_api_credential_rotation_requests
       WHERE partner_key=? ORDER BY created_at DESC LIMIT 100`
    )
      .bind(PARTNER_KEY)
      .all<CredentialRotationRequestRow>(),
    env.DB.prepare(
      `SELECT * FROM partner_webhook_signing_keys
       WHERE partner_key=? ORDER BY secret_version DESC LIMIT 10`
    )
      .bind(PARTNER_KEY)
      .all<WebhookSigningKeyRow>(),
    env.DB.prepare(
      `SELECT * FROM partner_webhook_signing_key_requests
       WHERE partner_key=? ORDER BY created_at DESC LIMIT 100`
    )
      .bind(PARTNER_KEY)
      .all<WebhookSigningKeyRequestRow>(),
    getWebhookSettings(env),
    env.DB.prepare(
      `SELECT * FROM webhook_deliveries
       WHERE partner_key=? ORDER BY created_at DESC LIMIT 100`
    )
      .bind(PARTNER_KEY)
      .all<WebhookDeliveryRow>(),
    env.DB.prepare(
      `SELECT MAX(created_at) last_delivery_at,
        MAX(CASE WHEN status='delivered' THEN delivered_at END) last_success_at
       FROM webhook_deliveries WHERE partner_key=?`
    )
      .bind(PARTNER_KEY)
      .first<{
        last_delivery_at: string | null;
        last_success_at: string | null;
      }>(),
    env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM api_ip_allowlist_requests
          WHERE partner_key=? AND status='pending') +
        (SELECT COUNT(*) FROM partner_webhook_requests
          WHERE partner_key=? AND status='pending') +
        (SELECT COUNT(*) FROM partner_api_credential_rotation_requests
          WHERE partner_key=? AND status='pending') +
        (SELECT COUNT(*) FROM partner_webhook_signing_key_requests
          WHERE partner_key=? AND status='pending') total`
    )
      .bind(PARTNER_KEY, PARTNER_KEY, PARTNER_KEY, PARTNER_KEY)
      .first<{ total: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) total FROM webhook_deliveries
       WHERE partner_key=? AND status IN ('retry_scheduled','dead_letter')`
    )
      .bind(PARTNER_KEY)
      .first<{ total: number }>(),
  ]);

  const requests = [
    ...ipRequests.results.map((row) => normalizeIpAllowlistRequest(row, includeInternalFields)),
    ...webhookRequests.results.map((row) => normalizeWebhookRequest(row, includeInternalFields)),
  ].sort((left, right) => right.created_at.localeCompare(left.created_at));

  return json({
    data: {
      summary: {
        pending: Number(pendingCount?.total || 0),
        approved_ip_rules: ipRows.filter((row) => row.enabled === 1).length,
        webhook_endpoints:
          webhookSettings?.endpoint_url && ['active', 'paused'].includes(webhookSettings.status)
            ? 1
            : 0,
        api_credentials: credentials.results.filter((row) => row.status === 'active').length,
        failed_deliveries: Number(failedCount?.total || 0),
      },
      requests,
      credentials: credentials.results.map(normalizeApiCredential),
      credential_rotation_requests: credentialRotationRequests.results.map((row) =>
        normalizeCredentialRotationRequest(row, includeInternalFields)
      ),
      webhook_signing_keys: webhookSigningKeys.results.map(normalizeWebhookSigningKey),
      webhook_signing_key_requests: webhookSigningKeyRequests.results.map((row) =>
        normalizeWebhookSigningKeyRequest(row, includeInternalFields)
      ),
      ip_allowlist: ipRows.map((row) => {
        const normalized = normalizeApiIpAllowlistRow(row);
        if (includeInternalFields) return normalized;
        const { source_request_id: _sourceRequestId, ...safe } = normalized;
        return safe;
      }),
      webhooks: webhookSettings
        ? [normalizeWebhookSettings(webhookSettings, includeInternalFields, webhookDeliveryTimes)]
        : [],
      deliveries: deliveries.results.map((row) =>
        normalizeWebhookDelivery(row, includeInternalFields)
      ),
      security: {
        access_service_token_required: true,
        ip_allowlist_enabled: security.ip_allowlist_enabled,
        rate_limit: security.rate_limit,
        credential_management: {
          configured: Boolean(
            localCredentialDemoEnabled(request, env) ||
              (env.CLOUDFLARE_ACCOUNT_ID &&
                env.PARTNER_ACCESS_SERVICE_TOKEN_ID &&
                env.CLOUDFLARE_ACCESS_MANAGEMENT_API_TOKEN &&
                env.API_CREDENTIAL_ENCRYPTION_KEY)
          ),
          service_token_id: includeInternalFields
            ? env.PARTNER_ACCESS_SERVICE_TOKEN_ID || null
            : undefined,
          one_time_secret_reveal: true,
          totp_step_up_required: true,
          default_overlap_hours: Number(env.PARTNER_ACCESS_ROTATION_OVERLAP_HOURS || 48),
        },
        webhook_signing_key_management: {
          configured: Boolean(
            env.API_CREDENTIAL_ENCRYPTION_KEY ||
              (env.API_CREDENTIAL_LOCAL_DEMO === 'true' && env.AUTH_SESSION_SECRET)
          ),
          legacy_worker_secret_fallback: Boolean(env.PARTNER_WEBHOOK_SIGNING_SECRET),
          one_time_secret_reveal: true,
          totp_step_up_required: true,
        },
      },
    },
  });
}

async function listPortalWebhookDeliveries(env: Env, url: URL) {
  const page = Number(url.searchParams.get('page') || '1');
  const limit = Number(url.searchParams.get('limit') || '50');
  const status = (url.searchParams.get('status') || 'all').trim();
  const eventType = (url.searchParams.get('event_type') || 'all').trim();
  const allowedStatuses = new Set([
    'pending',
    'delivering',
    'retry_scheduled',
    'delivered',
    'dead_letter',
    'suppressed',
  ]);
  const allowedEvents = new Set<string>([...WEBHOOK_EVENTS, 'webhook.test']);

  if (!Number.isInteger(page) || page < 1) {
    return error(422, 'validation_error', 'page 必须是正整数');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return error(422, 'validation_error', 'limit 必须是 1 到 100 的整数');
  }
  if (status !== 'all' && !allowedStatuses.has(status)) {
    return error(422, 'validation_error', 'status 不是支持的 Webhook 投递状态');
  }
  if (eventType !== 'all' && !allowedEvents.has(eventType)) {
    return error(422, 'validation_error', 'event_type 不是支持的 Webhook 事件类型');
  }

  const conditions = ['partner_key=?'];
  const bindings: Array<string | number> = [PARTNER_KEY];
  if (status !== 'all') {
    conditions.push('status=?');
    bindings.push(status);
  }
  if (eventType !== 'all') {
    conditions.push('event_type=?');
    bindings.push(eventType);
  }

  const where = conditions.join(' AND ');
  const offset = (page - 1) * limit;
  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM webhook_deliveries
       WHERE ${where}
       ORDER BY created_at DESC,id DESC
       LIMIT ? OFFSET ?`
    )
      .bind(...bindings, limit, offset)
      .all<WebhookDeliveryRow>(),
    env.DB.prepare(`SELECT COUNT(*) total FROM webhook_deliveries WHERE ${where}`)
      .bind(...bindings)
      .first<{ total: number }>(),
  ]);
  const total = Number(countRow?.total || 0);

  return json({
    data: {
      items: rows.results.map((row) => normalizeWebhookDelivery(row, false)),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    },
  });
}

async function createIpAllowlistRequest(
  env: Env,
  request: Request,
  requestedVia: 'portal' | 'api'
) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const unknownFields = rejectUnknownFields(body, [
    'action',
    'target_entry_id',
    'cidr',
    'label',
    'environment',
    'reason',
  ]);
  if (unknownFields) return unknownFields;
  const action = body.action;
  if (action !== 'add' && action !== 'remove') {
    return error(422, 'validation_error', 'action 必须是 add 或 remove');
  }
  const reason = normalizeOptionalText(body.reason, 'reason', 500);
  if (reason instanceof Response) return reason;
  if (!reason) {
    return error(422, 'validation_error', 'reason 为必填项');
  }

  let targetEntryId: string | null = null;
  let targetUpdatedAt: string | null = null;
  let cidr: string;
  let label: string | null;
  let environment: ApiIpAllowlistRow['environment'];

  if (action === 'add') {
    const parsedCidr = validateApiIpCidr(body.cidr);
    if (parsedCidr instanceof Response) return parsedCidr;
    const parsedLabel = body.label === undefined ? null : validateApiIpLabel(body.label);
    if (parsedLabel instanceof Response) return parsedLabel;
    const parsedEnvironment = validateIntegrationEnvironment(body.environment);
    if (parsedEnvironment instanceof Response) return parsedEnvironment;
    const existing = await env.DB.prepare(
      `SELECT id FROM api_ip_allowlist WHERE cidr=? COLLATE NOCASE`
    )
      .bind(parsedCidr.canonical)
      .first<{ id: string }>();
    if (existing) {
      return error(409, 'duplicate_ip_allowlist_entry', '该 IP 或 CIDR 已在生效白名单中');
    }
    cidr = parsedCidr.canonical;
    label = parsedLabel;
    environment = parsedEnvironment;
  } else {
    targetEntryId = typeof body.target_entry_id === 'string' ? body.target_entry_id.trim() : '';
    if (!targetEntryId) {
      return error(422, 'validation_error', 'remove 申请必须提供 target_entry_id');
    }
    const current = await getApiIpAllowlistRow(env, targetEntryId);
    if (!current) return error(404, 'not_found', 'IP 白名单条目不存在');
    targetUpdatedAt = current.updated_at;
    cidr = current.cidr;
    label = current.label;
    environment = current.environment;
  }

  const id = `ipr_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO api_ip_allowlist_requests
          (id,partner_key,action,target_entry_id,target_updated_at,cidr,label,
           environment,reason,status,requested_by,requested_via,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,'pending','partner',?,?,?)`
      ).bind(
        id,
        PARTNER_KEY,
        action,
        targetEntryId,
        targetUpdatedAt,
        cidr,
        label,
        environment,
        reason,
        requestedVia,
        now,
        now
      ),
      integrationAuditStatement(
        env,
        'api_integration.ip_allowlist_requested',
        {
          request_id: id,
          action,
          target_entry_id: targetEntryId,
          cidr,
          environment,
          requested_via: requestedVia,
        },
        'partner',
        now
      ),
    ]);
  } catch (caught) {
    if ((caught instanceof Error ? caught.message : '').includes('UNIQUE')) {
      return error(409, 'pending_integration_request_exists', '相同白名单变更已有待审批申请');
    }
    throw caught;
  }
  const row = await env.DB.prepare(`SELECT * FROM api_ip_allowlist_requests WHERE id=?`)
    .bind(id)
    .first<IpAllowlistRequestRow>();
  return json({ data: normalizeIpAllowlistRequest(row as IpAllowlistRequestRow, false) }, 201, {
    location: `/api/v1/api-integration/requests/${id}`,
  });
}

async function createWebhookRequest(env: Env, request: Request, requestedVia: 'portal' | 'api') {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const unknownFields = rejectUnknownFields(body, ['action', 'endpoint_url', 'events', 'reason']);
  if (unknownFields) return unknownFields;
  const action = body.action;
  if (action !== 'upsert' && action !== 'disable') {
    return error(422, 'validation_error', 'action 必须是 upsert 或 disable');
  }
  const reason = normalizeOptionalText(body.reason, 'reason', 500);
  if (reason instanceof Response) return reason;
  if (!reason) {
    return error(422, 'validation_error', 'reason 为必填项');
  }
  const current = await getWebhookSettings(env);
  if (!current) {
    return error(500, 'webhook_configuration_missing', 'Webhook 配置不存在');
  }

  let endpointUrl: string | null;
  let events: WebhookEventType[];
  if (action === 'upsert') {
    const parsedEndpoint = validateWebhookEndpoint(body.endpoint_url);
    if (parsedEndpoint instanceof Response) return parsedEndpoint;
    const parsedEvents = validateWebhookEvents(body.events);
    if (parsedEvents instanceof Response) return parsedEvents;
    endpointUrl = parsedEndpoint;
    events = parsedEvents;
    if (
      current.status === 'active' &&
      current.endpoint_url === endpointUrl &&
      JSON.stringify(parseWebhookEventsJson(current.events_json)) === JSON.stringify(events)
    ) {
      return error(409, 'no_configuration_change', 'Webhook 配置没有变化');
    }
  } else {
    if (!current.endpoint_url || current.status === 'disabled') {
      return error(409, 'webhook_already_disabled', 'Webhook 当前已停用');
    }
    endpointUrl = current.endpoint_url;
    events = parseWebhookEventsJson(current.events_json);
  }

  const id = `whr_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO partner_webhook_requests
          (id,partner_key,action,endpoint_url,events_json,target_updated_at,
           reason,status,requested_by,requested_via,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,'pending','partner',?,?,?)`
      ).bind(
        id,
        PARTNER_KEY,
        action,
        endpointUrl,
        JSON.stringify(events),
        current.updated_at,
        reason,
        requestedVia,
        now,
        now
      ),
      integrationAuditStatement(
        env,
        'api_integration.webhook_requested',
        {
          request_id: id,
          action,
          endpoint_url: endpointUrl,
          events,
          requested_via: requestedVia,
        },
        'partner',
        now
      ),
    ]);
  } catch (caught) {
    if ((caught instanceof Error ? caught.message : '').includes('UNIQUE')) {
      return error(409, 'pending_integration_request_exists', '已有待审批的 Webhook 配置申请');
    }
    throw caught;
  }
  const row = await env.DB.prepare(`SELECT * FROM partner_webhook_requests WHERE id=?`)
    .bind(id)
    .first<WebhookRequestRow>();
  return json({ data: normalizeWebhookRequest(row as WebhookRequestRow, false) }, 201, {
    location: `/api/v1/api-integration/requests/${id}`,
  });
}

async function createCredentialRotationRequest(
  env: WebhookEnv,
  request: Request,
  requestedVia: 'portal' | 'api'
) {
  if (!env.PARTNER_ACCESS_SERVICE_TOKEN_ID) {
    return error(503, 'api_credential_management_unavailable', 'Partner API 凭证尚未完成后台绑定');
  }
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const unknownFields = rejectUnknownFields(body, ['reason', 'migration_window_hours']);
  if (unknownFields) return unknownFields;
  const reason = normalizeOptionalText(body.reason, 'reason', 500);
  if (reason instanceof Response) return reason;
  if (!reason) return error(422, 'validation_error', 'reason 为必填项');

  const defaultWindow = Number(env.PARTNER_ACCESS_ROTATION_OVERLAP_HOURS || 48);
  const migrationWindowHours =
    body.migration_window_hours === undefined ? defaultWindow : Number(body.migration_window_hours);
  if (
    !Number.isInteger(migrationWindowHours) ||
    migrationWindowHours < 1 ||
    migrationWindowHours > 168
  ) {
    return error(422, 'validation_error', 'migration_window_hours 必须是 1 到 168 的整数');
  }

  const id = `crr_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO partner_api_credential_rotation_requests
          (id,partner_key,service_token_id,reason,migration_window_hours,
           status,requested_by,requested_via,created_at,updated_at)
         VALUES (?,?,?,?,?,'pending','partner',?,?,?)`
      ).bind(
        id,
        PARTNER_KEY,
        env.PARTNER_ACCESS_SERVICE_TOKEN_ID,
        reason,
        migrationWindowHours,
        requestedVia,
        now,
        now
      ),
      integrationAuditStatement(
        env,
        'api_integration.credential_rotation_requested',
        {
          request_id: id,
          migration_window_hours: migrationWindowHours,
          requested_via: requestedVia,
        },
        'partner',
        now
      ),
    ]);
  } catch (caught) {
    if ((caught instanceof Error ? caught.message : '').includes('UNIQUE')) {
      return error(409, 'pending_credential_rotation_exists', '已有待审批的 API 凭证轮换申请');
    }
    throw caught;
  }

  const row = await env.DB.prepare(
    `SELECT * FROM partner_api_credential_rotation_requests WHERE id=?`
  )
    .bind(id)
    .first<CredentialRotationRequestRow>();
  return json(
    {
      data: normalizeCredentialRotationRequest(row as CredentialRotationRequestRow, false),
    },
    201,
    {
      location: `/api/v1/api-integration/credential-rotation-requests/${id}`,
    }
  );
}

async function cancelCredentialRotationRequest(env: Env, id: string) {
  const now = new Date().toISOString();
  const current = await env.DB.prepare(
    `SELECT * FROM partner_api_credential_rotation_requests
     WHERE id=? AND partner_key=?`
  )
    .bind(id, PARTNER_KEY)
    .first<CredentialRotationRequestRow>();
  if (!current) return error(404, 'not_found', 'API 凭证轮换申请不存在');
  if (current.status !== 'pending') {
    return error(409, 'invalid_status', '只有待审批申请可以撤回');
  }
  const [result] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE partner_api_credential_rotation_requests
       SET status='cancelled',updated_at=?
       WHERE id=? AND partner_key=? AND status='pending'`
    ).bind(now, id, PARTNER_KEY),
    integrationStateAuditStatement(
      env,
      'api_integration.credential_rotation_cancelled',
      { request_id: id },
      'partner',
      'partner_api_credential_rotation_requests',
      id,
      'cancelled',
      now
    ),
  ]);
  if (result.meta.changes !== 1) {
    return error(409, 'invalid_status', '申请已被其他操作处理');
  }
  const updated = await env.DB.prepare(
    `SELECT * FROM partner_api_credential_rotation_requests WHERE id=?`
  )
    .bind(id)
    .first<CredentialRotationRequestRow>();
  return json({
    data: normalizeCredentialRotationRequest(updated as CredentialRotationRequestRow, false),
  });
}

async function createWebhookSigningKeyRequest(
  env: WebhookEnv,
  request: Request,
  requestedVia: 'portal' | 'api'
) {
  if (!env.API_CREDENTIAL_ENCRYPTION_KEY && !localCredentialDemoEnabled(request, env)) {
    return error(
      503,
      'webhook_signing_key_management_unavailable',
      'Webhook 签名密钥管理尚未完成后台配置'
    );
  }
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const unknownFields = rejectUnknownFields(body, ['reason', 'overlap_hours']);
  if (unknownFields) return unknownFields;
  const reason = normalizeOptionalText(body.reason, 'reason', 500);
  if (reason instanceof Response) return reason;
  if (!reason) return error(422, 'validation_error', 'reason 为必填项');
  const overlapHours = body.overlap_hours === undefined ? 48 : Number(body.overlap_hours);
  if (!Number.isInteger(overlapHours) || overlapHours < 1 || overlapHours > 168) {
    return error(422, 'validation_error', 'overlap_hours 必须是 1 到 168 的整数');
  }
  const id = `whkr_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO partner_webhook_signing_key_requests
          (id,partner_key,reason,overlap_hours,status,requested_by,requested_via,
           created_at,updated_at)
         VALUES (?, ?, ?, ?, 'pending', 'partner', ?, ?, ?)`
      ).bind(id, PARTNER_KEY, reason, overlapHours, requestedVia, now, now),
      integrationAuditStatement(
        env,
        'api_integration.webhook_signing_key_requested',
        { request_id: id, overlap_hours: overlapHours, requested_via: requestedVia },
        'partner',
        now
      ),
    ]);
  } catch (caught) {
    if ((caught instanceof Error ? caught.message : '').includes('UNIQUE')) {
      return error(
        409,
        'pending_webhook_signing_key_request_exists',
        '已有待审批的 Webhook 签名密钥申请'
      );
    }
    throw caught;
  }
  const row = await env.DB.prepare(`SELECT * FROM partner_webhook_signing_key_requests WHERE id=?`)
    .bind(id)
    .first<WebhookSigningKeyRequestRow>();
  return json(
    { data: normalizeWebhookSigningKeyRequest(row as WebhookSigningKeyRequestRow, false) },
    201
  );
}

async function cancelWebhookSigningKeyRequest(env: Env, id: string) {
  const now = new Date().toISOString();
  const [result] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE partner_webhook_signing_key_requests
       SET status='cancelled',updated_at=?
       WHERE id=? AND partner_key=? AND status='pending'`
    ).bind(now, id, PARTNER_KEY),
    env.DB.prepare(
      `INSERT INTO audit_logs
        (id,application_id,action,actor_type,metadata_json,created_at)
       SELECT ?,NULL,'api_integration.webhook_signing_key_cancelled','partner',?,?
       WHERE EXISTS (
         SELECT 1 FROM partner_webhook_signing_key_requests
         WHERE id=? AND partner_key=? AND status='cancelled' AND updated_at=?
       )`
    ).bind(crypto.randomUUID(), JSON.stringify({ request_id: id }), now, id, PARTNER_KEY, now),
  ]);
  if (result.meta.changes !== 1) {
    const exists = await env.DB.prepare(
      `SELECT status FROM partner_webhook_signing_key_requests WHERE id=? AND partner_key=?`
    )
      .bind(id, PARTNER_KEY)
      .first<{ status: string }>();
    return exists
      ? error(409, 'invalid_status', '只有待审批申请可以撤回')
      : error(404, 'not_found', 'Webhook 签名密钥申请不存在');
  }
  const row = await env.DB.prepare(`SELECT * FROM partner_webhook_signing_key_requests WHERE id=?`)
    .bind(id)
    .first<WebhookSigningKeyRequestRow>();
  return json({
    data: normalizeWebhookSigningKeyRequest(row as WebhookSigningKeyRequestRow, false),
  });
}

async function reviewWebhookSigningKeyRequest(
  env: WebhookEnv,
  id: string,
  decision: 'approve' | 'reject',
  request: Request
) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const unknownFields = rejectUnknownFields(body, ['review_note']);
  if (unknownFields) return unknownFields;
  const reviewNote = normalizeOptionalText(body.review_note, 'review_note', 1000);
  if (reviewNote instanceof Response) return reviewNote;
  if (decision === 'reject' && !reviewNote) {
    return error(422, 'validation_error', '拒绝申请时必须填写 review_note');
  }
  const current = await env.DB.prepare(
    `SELECT * FROM partner_webhook_signing_key_requests WHERE id=? AND partner_key=?`
  )
    .bind(id, PARTNER_KEY)
    .first<WebhookSigningKeyRequestRow>();
  if (!current) return error(404, 'not_found', 'Webhook 签名密钥申请不存在');
  if (current.status !== 'pending') return error(409, 'invalid_status', '申请已被其他操作处理');
  const reviewer = trustedAccessReviewer(request);
  const now = new Date().toISOString();
  if (decision === 'reject') {
    const [result] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE partner_webhook_signing_key_requests
         SET status='rejected',reviewed_by=?,review_note=?,reviewed_at=?,updated_at=?
         WHERE id=? AND partner_key=? AND status='pending'`
      ).bind(reviewer, reviewNote, now, now, id, PARTNER_KEY),
      reviewedIntegrationAuditStatement(
        env,
        'api_integration.webhook_signing_key_rejected',
        { request_id: id, review_note: reviewNote, reviewed_by: reviewer },
        'partner_webhook_signing_key_requests',
        id,
        'rejected',
        now
      ),
    ]);
    if (result.meta.changes !== 1) return error(409, 'invalid_status', '申请已被其他操作处理');
  } else {
    const versionRow = await env.DB.prepare(
      `SELECT COALESCE(MAX(secret_version),0) version
       FROM partner_webhook_signing_keys WHERE partner_key=?`
    )
      .bind(PARTNER_KEY)
      .first<{ version: number }>();
    const secretVersion = Number(versionRow?.version || 0) + 1;
    const keyId = `whsk_${crypto.randomUUID().replaceAll('-', '')}`;
    const secret = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(48)));
    let encrypted: { ciphertext: string; iv: string };
    try {
      encrypted = await encryptWebhookSigningSecret(
        env,
        keyId,
        secretVersion,
        secret,
        localCredentialDemoEnabled(request, env)
      );
    } catch {
      return error(
        503,
        'webhook_signing_key_encryption_unavailable',
        'Webhook 签名密钥加密配置不可用'
      );
    }
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO partner_webhook_signing_keys
          (id,partner_key,secret_ciphertext,secret_iv,secret_version,status,
           reveal_status,source_request_id,overlap_hours,created_at,updated_at)
         SELECT ?,?,?,?,?, 'available','available',?,?,?,?
         WHERE EXISTS (
           SELECT 1 FROM partner_webhook_signing_key_requests
           WHERE id=? AND partner_key=? AND status='pending'
         )`
      ).bind(
        keyId,
        PARTNER_KEY,
        encrypted.ciphertext,
        encrypted.iv,
        secretVersion,
        id,
        current.overlap_hours,
        now,
        now,
        id,
        PARTNER_KEY
      ),
      env.DB.prepare(
        `UPDATE partner_webhook_signing_key_requests
         SET status='approved',reviewed_by=?,review_note=?,reviewed_at=?,updated_at=?
         WHERE id=? AND partner_key=? AND status='pending'
           AND EXISTS (SELECT 1 FROM partner_webhook_signing_keys WHERE source_request_id=?)`
      ).bind(reviewer, reviewNote, now, now, id, PARTNER_KEY, id),
      reviewedIntegrationAuditStatement(
        env,
        'api_integration.webhook_signing_key_approved',
        { request_id: id, key_id: keyId, secret_version: secretVersion, reviewed_by: reviewer },
        'partner_webhook_signing_key_requests',
        id,
        'approved',
        now
      ),
    ]);
    if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
      return error(409, 'webhook_signing_key_state_changed', 'Webhook 签名密钥申请状态已变化');
    }
  }
  const [updatedRequest, key] = await Promise.all([
    env.DB.prepare(`SELECT * FROM partner_webhook_signing_key_requests WHERE id=?`)
      .bind(id)
      .first<WebhookSigningKeyRequestRow>(),
    env.DB.prepare(`SELECT * FROM partner_webhook_signing_keys WHERE source_request_id=?`)
      .bind(id)
      .first<WebhookSigningKeyRow>(),
  ]);
  return json({
    data: {
      request: normalizeWebhookSigningKeyRequest(
        updatedRequest as WebhookSigningKeyRequestRow,
        true
      ),
      ...(key ? { key: normalizeWebhookSigningKey(key) } : {}),
    },
  });
}

async function revealWebhookSigningSecret(
  env: WebhookEnv,
  id: string,
  request: Request,
  principal: AuthPrincipal
) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const unknownFields = rejectUnknownFields(body, ['totp_code']);
  if (unknownFields) return unknownFields;
  const key = await env.DB.prepare(
    `SELECT * FROM partner_webhook_signing_keys
     WHERE id=? AND partner_key=? AND status IN ('available','active','retiring')`
  )
    .bind(id, PARTNER_KEY)
    .first<WebhookSigningKeyRow>();
  if (!key) return error(404, 'not_found', 'Webhook 签名密钥不存在');
  if (key.reveal_status !== 'available') {
    return error(
      409,
      'webhook_signing_secret_already_revealed',
      '该 Webhook 签名密钥已领取；如已遗失，请申请轮换'
    );
  }
  const stepUpError = await verifyAuthenticatedTotpStepUp(
    request,
    env,
    principal,
    body.totp_code,
    'webhook_secret_reveal'
  );
  if (stepUpError) return stepUpError;
  let secret: string;
  try {
    secret = await decryptWebhookSigningSecret(env, key, localCredentialDemoEnabled(request, env));
  } catch {
    return error(503, 'webhook_signing_key_encryption_unavailable', 'Webhook 签名密钥暂时无法解密');
  }
  const now = new Date().toISOString();
  const [result] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE partner_webhook_signing_keys
       SET reveal_status='revealed',revealed_at=?,updated_at=?
       WHERE id=? AND partner_key=? AND reveal_status='available'`
    ).bind(now, now, id, PARTNER_KEY),
    env.DB.prepare(
      `INSERT INTO audit_logs
        (id,application_id,action,actor_type,metadata_json,created_at)
       SELECT ?,NULL,'api_integration.webhook_signing_key_revealed','partner',?,?
       WHERE EXISTS (
         SELECT 1 FROM partner_webhook_signing_keys
         WHERE id=? AND partner_key=? AND reveal_status='revealed' AND revealed_at=?
       )`
    ).bind(
      crypto.randomUUID(),
      JSON.stringify({ key_id: id, secret_version: key.secret_version }),
      now,
      id,
      PARTNER_KEY,
      now
    ),
  ]);
  if (result.meta.changes !== 1) {
    return error(
      409,
      'webhook_signing_secret_already_revealed',
      '该 Webhook 签名密钥已被另一会话领取'
    );
  }
  return json({ data: { key_id: key.id, signing_secret: secret } });
}

async function activateWebhookSigningKey(
  env: WebhookEnv,
  id: string,
  request: Request,
  principal: AuthPrincipal
) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const unknownFields = rejectUnknownFields(body, ['totp_code']);
  if (unknownFields) return unknownFields;
  const key = await env.DB.prepare(
    `SELECT * FROM partner_webhook_signing_keys WHERE id=? AND partner_key=?`
  )
    .bind(id, PARTNER_KEY)
    .first<WebhookSigningKeyRow>();
  if (!key) return error(404, 'not_found', 'Webhook 签名密钥不存在');
  if (key.status !== 'available' || key.reveal_status !== 'revealed') {
    return error(409, 'webhook_signing_key_not_ready', '密钥必须先领取且处于待启用状态');
  }
  const settings = await getWebhookSettings(env);
  const outstanding = settings
    ? await env.DB.prepare(
        `SELECT COUNT(*) total FROM webhook_deliveries
         WHERE partner_key=? AND signing_secret_version=?
           AND status IN ('pending','delivering','retry_scheduled','dead_letter')`
      )
        .bind(PARTNER_KEY, settings.signing_secret_version)
        .first<{ total: number }>()
    : null;
  if (Number(outstanding?.total || 0) > 0) {
    return error(
      409,
      'webhook_signing_key_activation_blocked',
      '当前签名密钥仍有未完成或死信投递，请处理完成后再启用新密钥'
    );
  }
  const stepUpError = await verifyAuthenticatedTotpStepUp(
    request,
    env,
    principal,
    body.totp_code,
    'webhook_secret_reveal'
  );
  if (stepUpError) return stepUpError;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + key.overlap_hours * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE partner_webhook_signing_keys
       SET status='retiring',retiring_at=?,expires_at=?,updated_at=?
       WHERE partner_key=? AND status='active' AND id<>?`
    ).bind(nowIso, expiresAt, nowIso, PARTNER_KEY, id),
    env.DB.prepare(
      `UPDATE partner_webhook_signing_keys
       SET status='active',activated_at=?,updated_at=?
       WHERE id=? AND partner_key=? AND status='available' AND reveal_status='revealed'`
    ).bind(nowIso, nowIso, id, PARTNER_KEY),
    env.DB.prepare(
      `UPDATE partner_webhook_settings
       SET signing_secret_version=?,updated_at=?
       WHERE partner_key=?
         AND EXISTS (SELECT 1 FROM partner_webhook_signing_keys WHERE id=? AND status='active')`
    ).bind(id, nowIso, PARTNER_KEY, id),
    env.DB.prepare(
      `INSERT INTO audit_logs
        (id,application_id,action,actor_type,metadata_json,created_at)
       SELECT ?,NULL,'api_integration.webhook_signing_key_activated','partner',?,?
       WHERE EXISTS (
         SELECT 1 FROM partner_webhook_signing_keys
         WHERE id=? AND partner_key=? AND status='active' AND activated_at=?
       )`
    ).bind(
      crypto.randomUUID(),
      JSON.stringify({ key_id: id, previous_key_expires_at: expiresAt }),
      nowIso,
      id,
      PARTNER_KEY,
      nowIso
    ),
  ]);
  if (results[1].meta.changes !== 1 || results[2].meta.changes !== 1) {
    return error(409, 'webhook_signing_key_state_changed', 'Webhook 签名密钥状态已变化');
  }
  const updated = await env.DB.prepare(`SELECT * FROM partner_webhook_signing_keys WHERE id=?`)
    .bind(id)
    .first<WebhookSigningKeyRow>();
  return json({ data: normalizeWebhookSigningKey(updated as WebhookSigningKeyRow) });
}

async function getCredentialRotationRequest(env: Env, id: string, includeInternalFields = false) {
  const row = await env.DB.prepare(
    `SELECT * FROM partner_api_credential_rotation_requests
     WHERE id=? AND partner_key=?`
  )
    .bind(id, PARTNER_KEY)
    .first<CredentialRotationRequestRow>();
  if (!row) return error(404, 'not_found', 'API 凭证轮换申请不存在');
  return json({
    data: normalizeCredentialRotationRequest(row, includeInternalFields),
  });
}

async function rejectCredentialRotationRequest(
  env: Env,
  id: string,
  reviewNote: string,
  reviewer: string
) {
  const now = new Date().toISOString();
  const [result] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE partner_api_credential_rotation_requests
       SET status='rejected',reviewed_by=?,review_note=?,
         reviewed_at=?,updated_at=?
       WHERE id=? AND partner_key=? AND status='pending'`
    ).bind(reviewer, reviewNote, now, now, id, PARTNER_KEY),
    reviewedIntegrationAuditStatement(
      env,
      'api_integration.credential_rotation_rejected',
      { request_id: id, review_note: reviewNote, reviewed_by: reviewer },
      'partner_api_credential_rotation_requests',
      id,
      'rejected',
      now
    ),
  ]);
  if (result.meta.changes !== 1) {
    const exists = await env.DB.prepare(
      `SELECT status FROM partner_api_credential_rotation_requests
       WHERE id=? AND partner_key=?`
    )
      .bind(id, PARTNER_KEY)
      .first<{ status: string }>();
    return exists
      ? error(409, 'invalid_status', '申请已被其他操作处理')
      : error(404, 'not_found', 'API 凭证轮换申请不存在');
  }
  const updated = await env.DB.prepare(
    `SELECT * FROM partner_api_credential_rotation_requests WHERE id=?`
  )
    .bind(id)
    .first<CredentialRotationRequestRow>();
  return json({
    data: normalizeCredentialRotationRequest(updated as CredentialRotationRequestRow, true),
  });
}

async function approveCredentialRotationRequest(
  env: WebhookEnv,
  id: string,
  reviewNote: string | null,
  reviewer: string,
  request: Request
) {
  const rotationRequest = await env.DB.prepare(
    `SELECT * FROM partner_api_credential_rotation_requests
     WHERE id=? AND partner_key=?`
  )
    .bind(id, PARTNER_KEY)
    .first<CredentialRotationRequestRow>();
  if (!rotationRequest) {
    return error(404, 'not_found', 'API 凭证轮换申请不存在');
  }
  if (rotationRequest.status !== 'pending') {
    return error(409, 'invalid_status', '申请已被其他操作处理');
  }
  if (
    !env.PARTNER_ACCESS_SERVICE_TOKEN_ID ||
    rotationRequest.service_token_id !== env.PARTNER_ACCESS_SERVICE_TOKEN_ID
  ) {
    return error(409, 'stale_integration_request', '申请绑定的 Cloudflare Access 凭证已变化');
  }

  const previousSecretExpiresAt = new Date(
    Date.now() + rotationRequest.migration_window_hours * 60 * 60 * 1000
  ).toISOString();
  const localDemo = localCredentialDemoEnabled(request, env);
  const rotated: CloudflareServiceTokenResult | Response = localDemo
    ? {
        id: rotationRequest.service_token_id,
        client_id: `local_${crypto.randomUUID().replaceAll('-', '')}.access`,
        client_secret: `local_secret_${bytesToBase64Url(
          crypto.getRandomValues(new Uint8Array(32))
        )}`,
        duration: '8760h',
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      }
    : await rotateCloudflareAccessServiceToken(env, previousSecretExpiresAt);
  if (rotated instanceof Response) return rotated;
  if (
    rotated.id !== rotationRequest.service_token_id ||
    !rotated.client_id ||
    !rotated.client_secret ||
    !rotated.duration ||
    !rotated.expires_at
  ) {
    return error(
      502,
      'cloudflare_access_invalid_response',
      'Cloudflare Access 返回的凭证资料不完整'
    );
  }

  const current = await env.DB.prepare(`SELECT * FROM partner_api_credentials WHERE partner_key=?`)
    .bind(PARTNER_KEY)
    .first<ApiCredentialRow>();
  const credentialId =
    current?.id || `cred_${rotationRequest.service_token_id.replaceAll('-', '')}`;
  const secretVersion = (current?.secret_version || 0) + 1;
  let encrypted: { ciphertext: string; iv: string };
  try {
    encrypted = await encryptApiCredentialSecret(
      env,
      credentialId,
      secretVersion,
      rotated.client_secret,
      localDemo
    );
  } catch {
    return error(503, 'api_credential_encryption_unavailable', 'API 凭证加密配置不可用');
  }

  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE partner_api_credential_rotation_requests
       SET status='approved',reviewed_by=?,review_note=?,
         reviewed_at=?,updated_at=?
       WHERE id=? AND partner_key=? AND status='pending'`
    ).bind(reviewer, reviewNote, now, now, id, PARTNER_KEY),
    env.DB.prepare(
      `INSERT INTO partner_api_credentials
        (id,partner_key,provider,service_token_id,client_id,
         client_secret_ciphertext,client_secret_iv,secret_version,duration,
         expires_at,previous_secret_expires_at,status,reveal_status,
         source_request_id,created_at,updated_at,revealed_at)
       SELECT ?,?,'cloudflare_access',?,?,?,?,?,?,?,?,'active','available',
         ?,?,?,NULL
       WHERE changes()=1
       ON CONFLICT(partner_key) DO UPDATE SET
         service_token_id=excluded.service_token_id,
         client_id=excluded.client_id,
         client_secret_ciphertext=excluded.client_secret_ciphertext,
         client_secret_iv=excluded.client_secret_iv,
         secret_version=excluded.secret_version,
         duration=excluded.duration,
         expires_at=excluded.expires_at,
         previous_secret_expires_at=excluded.previous_secret_expires_at,
         status='active',
         reveal_status='available',
         source_request_id=excluded.source_request_id,
         updated_at=excluded.updated_at,
         revealed_at=NULL`
    ).bind(
      credentialId,
      PARTNER_KEY,
      rotated.id,
      rotated.client_id,
      encrypted.ciphertext,
      encrypted.iv,
      secretVersion,
      rotated.duration,
      rotated.expires_at,
      previousSecretExpiresAt,
      id,
      current?.created_at || now,
      now
    ),
    reviewedIntegrationAuditStatement(
      env,
      'api_integration.credential_rotation_approved',
      {
        request_id: id,
        credential_id: credentialId,
        secret_version: secretVersion,
        previous_secret_expires_at: previousSecretExpiresAt,
        reviewed_by: reviewer,
      },
      'partner_api_credential_rotation_requests',
      id,
      'approved',
      now
    ),
  ]);
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
    return error(
      409,
      'credential_rotation_state_changed',
      '凭证已在 Cloudflare 轮换，但本地申请状态已变化；请立即联系管理员重新轮换'
    );
  }
  const [updatedRequest, credential] = await Promise.all([
    env.DB.prepare(`SELECT * FROM partner_api_credential_rotation_requests WHERE id=?`)
      .bind(id)
      .first<CredentialRotationRequestRow>(),
    env.DB.prepare(`SELECT * FROM partner_api_credentials WHERE id=?`)
      .bind(credentialId)
      .first<ApiCredentialRow>(),
  ]);
  return json({
    data: {
      request: normalizeCredentialRotationRequest(
        updatedRequest as CredentialRotationRequestRow,
        true
      ),
      credential: normalizeApiCredential(credential as ApiCredentialRow),
    },
  });
}

async function reviewCredentialRotationRequest(
  env: WebhookEnv,
  id: string,
  decision: 'approve' | 'reject',
  request: Request
) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const unknownFields = rejectUnknownFields(body, ['review_note']);
  if (unknownFields) return unknownFields;
  const reviewNote = normalizeOptionalText(body.review_note, 'review_note', 1000);
  if (reviewNote instanceof Response) return reviewNote;
  if (decision === 'reject' && !reviewNote) {
    return error(422, 'validation_error', '拒绝申请时必须填写 review_note');
  }
  const reviewer = trustedAccessReviewer(request);
  return decision === 'approve'
    ? approveCredentialRotationRequest(env, id, reviewNote, reviewer, request)
    : rejectCredentialRotationRequest(env, id, reviewNote as string, reviewer);
}

async function revealApiCredential(
  env: WebhookEnv,
  id: string,
  request: Request,
  principal: AuthPrincipal
) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const unknownFields = rejectUnknownFields(body, ['totp_code']);
  if (unknownFields) return unknownFields;
  const credential = await env.DB.prepare(
    `SELECT * FROM partner_api_credentials
     WHERE id=? AND partner_key=? AND status='active'`
  )
    .bind(id, PARTNER_KEY)
    .first<ApiCredentialRow>();
  if (!credential) return error(404, 'not_found', 'API 凭证不存在');
  if (
    credential.reveal_status !== 'available' ||
    !credential.client_secret_ciphertext ||
    !credential.client_secret_iv
  ) {
    return error(
      409,
      'credential_secret_already_revealed',
      '该 Client Secret 已领取；如已遗失，请申请轮换'
    );
  }

  const stepUpError = await verifyAuthenticatedTotpStepUp(
    request,
    env,
    principal,
    body.totp_code,
    'api_credential_reveal'
  );
  if (stepUpError) return stepUpError;

  let clientSecret: string;
  try {
    clientSecret = await decryptApiCredentialSecret(
      env,
      credential,
      localCredentialDemoEnabled(request, env) && credential.client_id.startsWith('local_')
    );
  } catch {
    return error(503, 'api_credential_encryption_unavailable', 'API 凭证暂时无法解密');
  }
  const now = new Date().toISOString();
  const [updated] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE partner_api_credentials
       SET client_secret_ciphertext=NULL,client_secret_iv=NULL,
         reveal_status='revealed',revealed_at=?,updated_at=?
       WHERE id=? AND partner_key=? AND reveal_status='available'
         AND client_secret_ciphertext=?`
    ).bind(now, now, credential.id, PARTNER_KEY, credential.client_secret_ciphertext),
    env.DB.prepare(
      `INSERT INTO audit_logs
        (id,application_id,action,actor_type,metadata_json,created_at)
       SELECT ?,NULL,'api_integration.credential_secret_revealed','partner',?,?
       WHERE changes()=1`
    ).bind(
      crypto.randomUUID(),
      JSON.stringify({
        credential_id: credential.id,
        secret_version: credential.secret_version,
      }),
      now
    ),
  ]);
  if (updated.meta.changes !== 1) {
    return error(409, 'credential_secret_already_revealed', '该 Client Secret 已被另一会话领取');
  }
  return json({
    data: {
      credential_id: credential.id,
      client_id: credential.client_id,
      client_secret: clientSecret,
      expires_at: credential.expires_at,
      previous_secret_expires_at: credential.previous_secret_expires_at,
      headers: {
        'CF-Access-Client-Id': credential.client_id,
        'CF-Access-Client-Secret': clientSecret,
      },
      one_time_display: true,
    },
  });
}

async function getIntegrationRequest(env: Env, id: string, includeInternalFields = false) {
  if (id.startsWith('ipr_')) {
    const row = await env.DB.prepare(
      `SELECT * FROM api_ip_allowlist_requests
       WHERE id=? AND partner_key=?`
    )
      .bind(id, PARTNER_KEY)
      .first<IpAllowlistRequestRow>();
    return row
      ? json({ data: normalizeIpAllowlistRequest(row, includeInternalFields) })
      : error(404, 'not_found', 'API 接入申请不存在');
  }
  if (id.startsWith('whr_')) {
    const row = await env.DB.prepare(
      `SELECT * FROM partner_webhook_requests
       WHERE id=? AND partner_key=?`
    )
      .bind(id, PARTNER_KEY)
      .first<WebhookRequestRow>();
    return row
      ? json({ data: normalizeWebhookRequest(row, includeInternalFields) })
      : error(404, 'not_found', 'API 接入申请不存在');
  }
  return error(404, 'not_found', 'API 接入申请不存在');
}

async function cancelIntegrationRequest(env: Env, id: string) {
  const now = new Date().toISOString();
  if (id.startsWith('ipr_')) {
    const current = await env.DB.prepare(
      `SELECT * FROM api_ip_allowlist_requests WHERE id=? AND partner_key=?`
    )
      .bind(id, PARTNER_KEY)
      .first<IpAllowlistRequestRow>();
    if (!current) return error(404, 'not_found', 'API 接入申请不存在');
    if (current.status !== 'pending') {
      return error(409, 'invalid_status', '只有待审批申请可以撤回');
    }
    const [result] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE api_ip_allowlist_requests
         SET status='cancelled',updated_at=?
         WHERE id=? AND partner_key=? AND status='pending'`
      ).bind(now, id, PARTNER_KEY),
      integrationStateAuditStatement(
        env,
        'api_integration.ip_allowlist_cancelled',
        { request_id: id },
        'partner',
        'api_ip_allowlist_requests',
        id,
        'cancelled',
        now
      ),
    ]);
    if (result.meta.changes === 0) {
      return error(409, 'invalid_status', '申请已被其他操作处理');
    }
    const updated = await env.DB.prepare(`SELECT * FROM api_ip_allowlist_requests WHERE id=?`)
      .bind(id)
      .first<IpAllowlistRequestRow>();
    return json({
      data: normalizeIpAllowlistRequest(updated as IpAllowlistRequestRow, false),
    });
  }
  if (id.startsWith('whr_')) {
    const current = await env.DB.prepare(
      `SELECT * FROM partner_webhook_requests WHERE id=? AND partner_key=?`
    )
      .bind(id, PARTNER_KEY)
      .first<WebhookRequestRow>();
    if (!current) return error(404, 'not_found', 'API 接入申请不存在');
    if (current.status !== 'pending') {
      return error(409, 'invalid_status', '只有待审批申请可以撤回');
    }
    const [result] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE partner_webhook_requests
         SET status='cancelled',updated_at=?
         WHERE id=? AND partner_key=? AND status='pending'`
      ).bind(now, id, PARTNER_KEY),
      integrationStateAuditStatement(
        env,
        'api_integration.webhook_cancelled',
        { request_id: id },
        'partner',
        'partner_webhook_requests',
        id,
        'cancelled',
        now
      ),
    ]);
    if (result.meta.changes === 0) {
      return error(409, 'invalid_status', '申请已被其他操作处理');
    }
    const updated = await env.DB.prepare(`SELECT * FROM partner_webhook_requests WHERE id=?`)
      .bind(id)
      .first<WebhookRequestRow>();
    return json({
      data: normalizeWebhookRequest(updated as WebhookRequestRow, false),
    });
  }
  return error(404, 'not_found', 'API 接入申请不存在');
}

async function rejectIntegrationRequest(
  env: Env,
  id: string,
  reviewNote: string,
  reviewer: string
) {
  const now = new Date().toISOString();
  const table = id.startsWith('ipr_')
    ? 'api_ip_allowlist_requests'
    : id.startsWith('whr_')
    ? 'partner_webhook_requests'
    : null;
  if (!table) return error(404, 'not_found', 'API 接入申请不存在');
  const [result] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE ${table}
       SET status='rejected',reviewed_by=?,review_note=?,
         reviewed_at=?,updated_at=?
       WHERE id=? AND partner_key=? AND status='pending'`
    ).bind(reviewer, reviewNote, now, now, id, PARTNER_KEY),
    reviewedIntegrationAuditStatement(
      env,
      id.startsWith('ipr_')
        ? 'api_integration.ip_allowlist_rejected'
        : 'api_integration.webhook_rejected',
      { request_id: id, review_note: reviewNote, reviewed_by: reviewer },
      table,
      id,
      'rejected',
      now
    ),
  ]);
  if (result.meta.changes === 0) {
    const exists = await env.DB.prepare(`SELECT status FROM ${table} WHERE id=? AND partner_key=?`)
      .bind(id, PARTNER_KEY)
      .first<{ status: string }>();
    return exists
      ? error(409, 'invalid_status', '申请已被其他操作处理')
      : error(404, 'not_found', 'API 接入申请不存在');
  }
  if (table === 'api_ip_allowlist_requests') {
    const updated = await env.DB.prepare(`SELECT * FROM api_ip_allowlist_requests WHERE id=?`)
      .bind(id)
      .first<IpAllowlistRequestRow>();
    return json({
      data: normalizeIpAllowlistRequest(updated as IpAllowlistRequestRow, true),
    });
  }
  const updated = await env.DB.prepare(`SELECT * FROM partner_webhook_requests WHERE id=?`)
    .bind(id)
    .first<WebhookRequestRow>();
  return json({
    data: normalizeWebhookRequest(updated as WebhookRequestRow, true),
  });
}

async function approveIpAllowlistRequest(
  env: Env,
  id: string,
  reviewNote: string | null,
  reviewer: string
) {
  const request = await env.DB.prepare(
    `SELECT * FROM api_ip_allowlist_requests WHERE id=? AND partner_key=?`
  )
    .bind(id, PARTNER_KEY)
    .first<IpAllowlistRequestRow>();
  if (!request) return error(404, 'not_found', 'IP 白名单申请不存在');
  if (request.status !== 'pending') {
    return error(409, 'invalid_status', '申请已被其他操作处理');
  }

  const now = new Date().toISOString();
  if (request.action === 'add') {
    const parsedCidr = parsePublicApiAllowlistCidr(request.cidr);
    if (!parsedCidr) {
      return error(409, 'invalid_request_data', '申请中的 CIDR 已失效');
    }
    const entryId = `ip_${crypto.randomUUID().replaceAll('-', '')}`;
    try {
      const results = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO api_ip_allowlist
            (id,cidr,label,enabled,environment,source_request_id,created_at,updated_at)
           SELECT ?,?,?,1,?,?,?,?
           WHERE EXISTS (
             SELECT 1 FROM api_ip_allowlist_requests
             WHERE id=? AND partner_key=? AND status='pending'
           )`
        ).bind(
          entryId,
          parsedCidr.canonical,
          request.label,
          request.environment,
          id,
          now,
          now,
          id,
          PARTNER_KEY
        ),
        env.DB.prepare(
          `UPDATE api_ip_allowlist_requests
           SET status='approved',reviewed_by=?,review_note=?,
             reviewed_at=?,updated_at=?
           WHERE id=? AND partner_key=? AND status='pending' AND changes()=1`
        ).bind(reviewer, reviewNote, now, now, id, PARTNER_KEY),
        reviewedIntegrationAuditStatement(
          env,
          'api_integration.ip_allowlist_approved',
          {
            request_id: id,
            action: request.action,
            allowlist_id: entryId,
            cidr: parsedCidr.canonical,
            environment: request.environment,
            review_note: reviewNote,
            reviewed_by: reviewer,
          },
          'api_ip_allowlist_requests',
          id,
          'approved',
          now
        ),
      ]);
      if (results[1].meta.changes === 0) {
        return error(409, 'invalid_status', '申请已被其他操作处理');
      }
    } catch (caught) {
      if ((caught instanceof Error ? caught.message : '').includes('UNIQUE')) {
        return error(409, 'duplicate_ip_allowlist_entry', '该 IP 或 CIDR 已在白名单中');
      }
      throw caught;
    }
  } else {
    const current = request.target_entry_id
      ? await getApiIpAllowlistRow(env, request.target_entry_id)
      : null;
    if (!current) {
      return error(409, 'stale_integration_request', '目标白名单规则已不存在');
    }
    if (current.updated_at !== request.target_updated_at) {
      return error(409, 'stale_integration_request', '目标白名单规则已发生变化');
    }
    const deletesValidEntry = Boolean(
      current.enabled === 1 && parsePublicApiAllowlistCidr(current.cidr)
    );
    let otherValidEntryIds: string[] = [];
    if (deletesValidEntry) {
      const [settings, rows] = await Promise.all([
        getApiSecuritySettings(env),
        listApiIpAllowlistRows(env),
      ]);
      otherValidEntryIds = publicAllowlistIds(rows, current.id);
      if (settings?.ip_allowlist_enabled === 1 && otherValidEntryIds.length === 0) {
        return error(
          409,
          'api_ip_allowlist_would_lock_out',
          '全局白名单已启用，不能批准删除最后一条有效规则'
        );
      }
    }
    const deleteStatement = deletesValidEntry
      ? env.DB.prepare(
          `DELETE FROM api_ip_allowlist
           WHERE id=? AND updated_at=?
             AND EXISTS (
               SELECT 1 FROM api_ip_allowlist_requests
               WHERE id=? AND partner_key=? AND status='pending'
             )
             AND (
               NOT EXISTS (
                 SELECT 1 FROM api_security_settings
                 WHERE id=1 AND ip_allowlist_enabled=1
               )
               OR EXISTS (
                 SELECT 1 FROM api_ip_allowlist
                 WHERE enabled=1
                   AND id IN (SELECT value FROM json_each(?))
               )
             )`
        ).bind(current.id, current.updated_at, id, PARTNER_KEY, JSON.stringify(otherValidEntryIds))
      : env.DB.prepare(
          `DELETE FROM api_ip_allowlist
           WHERE id=? AND updated_at=?
             AND EXISTS (
               SELECT 1 FROM api_ip_allowlist_requests
               WHERE id=? AND partner_key=? AND status='pending'
             )`
        ).bind(current.id, current.updated_at, id, PARTNER_KEY);
    const results = await env.DB.batch([
      deleteStatement,
      env.DB.prepare(
        `UPDATE api_ip_allowlist_requests
         SET status='approved',reviewed_by=?,review_note=?,
           reviewed_at=?,updated_at=?
         WHERE id=? AND partner_key=? AND status='pending' AND changes()=1`
      ).bind(reviewer, reviewNote, now, now, id, PARTNER_KEY),
      reviewedIntegrationAuditStatement(
        env,
        'api_integration.ip_allowlist_approved',
        {
          request_id: id,
          action: request.action,
          allowlist_id: current.id,
          cidr: current.cidr,
          environment: current.environment,
          review_note: reviewNote,
          reviewed_by: reviewer,
        },
        'api_ip_allowlist_requests',
        id,
        'approved',
        now
      ),
    ]);
    if (results[1].meta.changes === 0) {
      if (deletesValidEntry) {
        const [latestTarget, settings, rows] = await Promise.all([
          getApiIpAllowlistRow(env, current.id),
          getApiSecuritySettings(env),
          listApiIpAllowlistRows(env),
        ]);
        if (
          latestTarget &&
          latestTarget.updated_at === current.updated_at &&
          settings?.ip_allowlist_enabled === 1 &&
          publicAllowlistIds(rows, current.id).length === 0
        ) {
          return error(
            409,
            'api_ip_allowlist_would_lock_out',
            '全局白名单已启用，不能批准删除最后一条有效规则'
          );
        }
      }
      return error(409, 'stale_integration_request', '目标白名单规则已发生变化');
    }
  }

  const updated = await env.DB.prepare(`SELECT * FROM api_ip_allowlist_requests WHERE id=?`)
    .bind(id)
    .first<IpAllowlistRequestRow>();
  return json({
    data: normalizeIpAllowlistRequest(updated as IpAllowlistRequestRow, true),
  });
}

async function approveWebhookRequest(
  env: WebhookEnv,
  id: string,
  reviewNote: string | null,
  reviewer: string
) {
  const request = await env.DB.prepare(
    `SELECT * FROM partner_webhook_requests WHERE id=? AND partner_key=?`
  )
    .bind(id, PARTNER_KEY)
    .first<WebhookRequestRow>();
  if (!request) return error(404, 'not_found', 'Webhook 申请不存在');
  if (request.status !== 'pending') {
    return error(409, 'invalid_status', '申请已被其他操作处理');
  }
  const current = await getWebhookSettings(env);
  if (!current) {
    return error(500, 'webhook_configuration_missing', 'Webhook 配置不存在');
  }
  if (current.updated_at !== request.target_updated_at) {
    return error(409, 'stale_integration_request', 'Webhook 配置已发生变化');
  }

  let endpointUrl: string | null = null;
  let events: WebhookEventType[] = [];
  let status: WebhookSettingsRow['status'] = 'disabled';
  if (request.action === 'upsert') {
    if (!(await hasWebhookSigningSecret(env))) {
      return error(503, 'webhook_secret_unavailable', 'Webhook 签名 Secret 尚未配置');
    }
    const parsedEndpoint = validateWebhookEndpoint(request.endpoint_url);
    if (parsedEndpoint instanceof Response) return parsedEndpoint;
    const parsedEvents = validateWebhookEvents(parseWebhookEventsJson(request.events_json));
    if (parsedEvents instanceof Response) return parsedEvents;
    endpointUrl = parsedEndpoint;
    events = parsedEvents;
    status = 'active';
  }

  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE partner_webhook_settings
       SET endpoint_url=?,events_json=?,status=?,source_request_id=?,updated_at=?
       WHERE partner_key=? AND updated_at=?
       AND EXISTS (
         SELECT 1 FROM partner_webhook_requests
         WHERE id=? AND partner_key=? AND status='pending'
       )`
    ).bind(
      endpointUrl,
      JSON.stringify(events),
      status,
      id,
      now,
      PARTNER_KEY,
      current.updated_at,
      id,
      PARTNER_KEY
    ),
    env.DB.prepare(
      `UPDATE partner_webhook_requests
       SET status='approved',reviewed_by=?,review_note=?,
         reviewed_at=?,updated_at=?
       WHERE id=? AND partner_key=? AND status='pending' AND changes()=1`
    ).bind(reviewer, reviewNote, now, now, id, PARTNER_KEY),
    env.DB.prepare(
      `UPDATE webhook_deliveries
       SET status='suppressed',next_attempt_at=NULL,
         last_error='configuration_changed',updated_at=?
       WHERE partner_key=?
         AND status IN ('pending','retry_scheduled','dead_letter')
         AND EXISTS (
           SELECT 1 FROM partner_webhook_requests
           WHERE id=? AND partner_key=? AND status='approved' AND updated_at=?
         )
         AND NOT EXISTS (
           SELECT 1 FROM partner_webhook_settings s
           WHERE s.partner_key=webhook_deliveries.partner_key
             AND s.status='active'
             AND s.endpoint_url=webhook_deliveries.endpoint_url
             AND s.signing_secret_version=webhook_deliveries.signing_secret_version
             AND (
               webhook_deliveries.event_type='webhook.test'
               OR EXISTS (
                 SELECT 1 FROM json_each(s.events_json)
                 WHERE value=webhook_deliveries.event_type
               )
             )
         )`
    ).bind(now, PARTNER_KEY, id, PARTNER_KEY, now),
    reviewedIntegrationAuditStatement(
      env,
      'api_integration.webhook_approved',
      {
        request_id: id,
        action: request.action,
        endpoint_url: endpointUrl,
        events,
        review_note: reviewNote,
        reviewed_by: reviewer,
      },
      'partner_webhook_requests',
      id,
      'approved',
      now
    ),
  ]);
  if (results[1].meta.changes === 0) {
    return error(409, 'stale_integration_request', 'Webhook 配置已发生变化');
  }
  const updated = await env.DB.prepare(`SELECT * FROM partner_webhook_requests WHERE id=?`)
    .bind(id)
    .first<WebhookRequestRow>();
  return json({
    data: normalizeWebhookRequest(updated as WebhookRequestRow, true),
  });
}

async function reviewIntegrationRequest(
  env: WebhookEnv,
  id: string,
  decision: 'approve' | 'reject',
  request: Request
) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const reviewNote = normalizeOptionalText(body.review_note, 'review_note', 1000);
  if (reviewNote instanceof Response) return reviewNote;
  if (decision === 'reject' && !reviewNote) {
    return error(422, 'validation_error', '拒绝申请时必须填写 review_note');
  }
  const reviewer = trustedAccessReviewer(request);
  if (decision === 'reject') {
    return rejectIntegrationRequest(env, id, reviewNote as string, reviewer);
  }
  if (id.startsWith('ipr_')) {
    return approveIpAllowlistRequest(env, id, reviewNote, reviewer);
  }
  if (id.startsWith('whr_')) {
    return approveWebhookRequest(env, id, reviewNote, reviewer);
  }
  return error(404, 'not_found', 'API 接入申请不存在');
}

function webhookOutboxStatement(
  env: Env,
  eventType: WebhookEventType,
  resourceType: 'va_application' | 'va_account' | 'fund_transaction' | 'otc_order',
  resourceId: string,
  applicationId: string,
  status: string,
  occurredAt: string,
  source: {
    table: 'va_applications' | 'fund_transactions' | 'otc_orders';
    id: string;
    status: string;
    updatedAt: string;
    currentReviewId?: string;
    resolvedReview?: {
      id: string;
      idempotencyKey: string;
      requestFingerprint: string;
    };
  },
  additionalData: Record<string, unknown> = {}
) {
  const eventId = `evt_${crypto.randomUUID().replaceAll('-', '')}`;
  const payload = JSON.stringify({
    event_id: eventId,
    type: eventType,
    occurred_at: occurredAt,
    data: {
      ...additionalData,
      resource_type: resourceType,
      resource_id: resourceId,
      application_id: applicationId,
      status,
    },
  });
  return env.DB.prepare(
    `INSERT INTO webhook_deliveries
      (id,partner_key,event_type,resource_type,resource_id,application_id,
       resource_status,endpoint_url,payload_json,signing_secret_version,status,
       attempt_count,next_attempt_at,created_at,updated_at)
     SELECT ?,?,?,?,?,?,?,s.endpoint_url,
       json_set(?, '$.data.partner_customer_id',
         (SELECT partner_customer_id FROM va_applications WHERE id=?)),
       s.signing_secret_version,
       'pending',0,?,?,?
     FROM partner_webhook_settings s
     WHERE s.partner_key=? AND s.status='active' AND s.endpoint_url IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM json_each(s.events_json) WHERE value=?
       )
       AND EXISTS (
         SELECT 1 FROM ${source.table}
         WHERE id=? AND status=? AND updated_at=?
         ${source.currentReviewId ? 'AND current_review_id=?' : ''}
         ${
           source.resolvedReview
             ? `AND EXISTS (
                  SELECT 1 FROM va_application_reviews r
                  WHERE r.id=? AND r.application_id=${source.table}.id
                    AND r.idempotency_key=? AND r.request_fingerprint=?
                )`
             : ''
         }
       )`
  ).bind(
    eventId,
    PARTNER_KEY,
    eventType,
    resourceType,
    resourceId,
    applicationId,
    status,
    payload,
    applicationId,
    occurredAt,
    occurredAt,
    occurredAt,
    PARTNER_KEY,
    eventType,
    source.id,
    source.status,
    source.updatedAt,
    ...(source.currentReviewId ? [source.currentReviewId] : []),
    ...(source.resolvedReview
      ? [
          source.resolvedReview.id,
          source.resolvedReview.idempotencyKey,
          source.resolvedReview.requestFingerprint,
        ]
      : [])
  );
}

function customWebhookOutboxStatement(
  env: Env,
  partnerKey: string,
  eventType: WebhookEventType,
  resourceType: 'fund_transaction' | 'usdt_sweep_batch',
  resourceId: string,
  applicationId: string | null,
  status: string,
  occurredAt: string,
  data: Record<string, unknown>,
  source: {
    table: 'fund_transactions' | 'usdt_sweep_batches';
    id: string;
    status: string;
    updatedAt: string;
  }
) {
  const eventId = `evt_${crypto.randomUUID().replaceAll('-', '')}`;
  const payload = JSON.stringify({
    event_id: eventId,
    type: eventType,
    occurred_at: occurredAt,
    data,
  });
  return env.DB.prepare(
    `INSERT INTO webhook_deliveries
      (id,partner_key,event_type,resource_type,resource_id,application_id,
       resource_status,endpoint_url,payload_json,signing_secret_version,status,
       attempt_count,next_attempt_at,created_at,updated_at)
     SELECT ?,?,?,?,?,?,?,s.endpoint_url,
       json_set(?, '$.data.partner_customer_id',
         (SELECT partner_customer_id FROM va_applications WHERE id=?)),
       s.signing_secret_version,
       'pending',0,?,?,?
     FROM partner_webhook_settings s
     WHERE s.partner_key=? AND s.status='active' AND s.endpoint_url IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM json_each(s.events_json) WHERE value=?
       )
       AND EXISTS (
         SELECT 1 FROM ${source.table}
         WHERE id=? AND status=? AND updated_at=?
       )`
  ).bind(
    eventId,
    partnerKey,
    eventType,
    resourceType,
    resourceId,
    applicationId,
    status,
    payload,
    applicationId,
    occurredAt,
    occurredAt,
    occurredAt,
    partnerKey,
    eventType,
    source.id,
    source.status,
    source.updatedAt
  );
}

async function createWebhookTest(env: WebhookEnv) {
  if (!(await hasWebhookSigningSecret(env))) {
    return error(503, 'webhook_secret_unavailable', 'Webhook 签名 Secret 尚未配置');
  }
  const settings = await getWebhookSettings(env);
  if (!settings?.endpoint_url || settings.status !== 'active') {
    return error(409, 'webhook_not_active', '请先批准并启用 Webhook 地址');
  }
  const localDemoEndpoint =
    env.AUTH_LOCAL_BYPASS === 'true' &&
    (() => {
      try {
        return new URL(settings.endpoint_url as string).hostname.endsWith('.example');
      } catch {
        return false;
      }
    })();
  const validatedEndpoint = localDemoEndpoint
    ? settings.endpoint_url
    : validateWebhookEndpoint(settings.endpoint_url);
  if (validatedEndpoint instanceof Response) return validatedEndpoint;
  const endpoint = validatedEndpoint as string;
  const id = `evt_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date().toISOString();
  const payload = JSON.stringify({
    event_id: id,
    type: 'webhook.test',
    occurred_at: now,
    data: {
      resource_type: 'webhook',
      resource_id: PARTNER_KEY,
      application_id: null,
      status: 'test',
    },
  });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO webhook_deliveries
        (id,partner_key,event_type,resource_type,resource_id,application_id,
         resource_status,endpoint_url,payload_json,signing_secret_version,status,
         attempt_count,next_attempt_at,created_at,updated_at)
       VALUES (?,?,?,'webhook',?,NULL,'test',?,?,?,'pending',0,?,?,?)`
    ).bind(
      id,
      PARTNER_KEY,
      'webhook.test',
      PARTNER_KEY,
      endpoint,
      payload,
      settings.signing_secret_version,
      now,
      now,
      now
    ),
    integrationAuditStatement(
      env,
      'api_integration.webhook_test_requested',
      { delivery_id: id },
      'partner',
      now
    ),
  ]);
  const row = await env.DB.prepare(`SELECT * FROM webhook_deliveries WHERE id=?`)
    .bind(id)
    .first<WebhookDeliveryRow>();
  return json({ data: normalizeWebhookDelivery(row as WebhookDeliveryRow, false) }, 202);
}

function bytesToHex(value: ArrayBuffer) {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function webhookSignature(secret: string, timestamp: string, rawBody: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}.${rawBody}`)
  );
  return bytesToHex(signature);
}

async function getWebhookSigningSecret(env: WebhookEnv, keyId: string) {
  if (keyId === 'v1') return env.PARTNER_WEBHOOK_SIGNING_SECRET || null;
  const key = await env.DB.prepare(
    `SELECT * FROM partner_webhook_signing_keys
     WHERE id=? AND partner_key=?
       AND (status='active' OR (status='retiring' AND expires_at>?))`
  )
    .bind(keyId, PARTNER_KEY, new Date().toISOString())
    .first<WebhookSigningKeyRow>();
  if (!key) return null;
  try {
    return await decryptWebhookSigningSecret(
      env,
      key,
      !env.API_CREDENTIAL_ENCRYPTION_KEY && env.API_CREDENTIAL_LOCAL_DEMO === 'true'
    );
  } catch {
    return null;
  }
}

async function hasWebhookSigningSecret(env: WebhookEnv) {
  if (env.PARTNER_WEBHOOK_SIGNING_SECRET) return true;
  const key = await env.DB.prepare(
    `SELECT id FROM partner_webhook_signing_keys
     WHERE partner_key=? AND status='active' LIMIT 1`
  )
    .bind(PARTNER_KEY)
    .first<{ id: string }>();
  return Boolean(key);
}

function safeDeliveryError(caught: unknown) {
  return caught instanceof DOMException && caught.name === 'TimeoutError'
    ? 'webhook_timeout'
    : 'webhook_network_error';
}

async function recordWebhookFailure(
  env: Env,
  row: WebhookDeliveryRow,
  lastError: string,
  responseStatus: number | null
) {
  const now = new Date();
  const terminal = row.attempt_count >= WEBHOOK_MAX_ATTEMPTS;
  const delaySeconds = Math.min(3600, 60 * 2 ** Math.max(0, row.attempt_count - 1));
  const nextAttemptAt = terminal
    ? null
    : new Date(now.getTime() + delaySeconds * 1000).toISOString();
  await env.DB.prepare(
    `UPDATE webhook_deliveries
     SET status=?,next_attempt_at=?,response_status=?,last_error=?,updated_at=?
     WHERE id=? AND status='delivering' AND attempt_count=?`
  )
    .bind(
      terminal ? 'dead_letter' : 'retry_scheduled',
      nextAttemptAt,
      responseStatus,
      lastError,
      now.toISOString(),
      row.id,
      row.attempt_count
    )
    .run();
  console.warn(
    JSON.stringify({
      event: 'webhook_delivery_failed',
      delivery_id: row.id,
      event_type: row.event_type,
      attempt: row.attempt_count,
      terminal,
      response_status: responseStatus,
    })
  );
}

async function deliverWebhookById(env: WebhookEnv, id: string) {
  const now = new Date().toISOString();
  const [, claim] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE webhook_deliveries
       SET status='suppressed',next_attempt_at=NULL,
         last_error='configuration_changed',updated_at=?
       WHERE id=? AND partner_key=?
         AND status IN ('pending','retry_scheduled')
         AND NOT EXISTS (
           SELECT 1 FROM partner_webhook_settings s
           WHERE s.partner_key=webhook_deliveries.partner_key
             AND s.status='active'
             AND s.endpoint_url=webhook_deliveries.endpoint_url
             AND s.signing_secret_version=webhook_deliveries.signing_secret_version
             AND (
               webhook_deliveries.event_type='webhook.test'
               OR EXISTS (
                 SELECT 1 FROM json_each(s.events_json)
                 WHERE value=webhook_deliveries.event_type
               )
             )
         )`
    ).bind(now, id, PARTNER_KEY),
    env.DB.prepare(
      `UPDATE webhook_deliveries
       SET status='delivering',attempt_count=attempt_count+1,
         last_attempt_at=?,updated_at=?
       WHERE id=? AND partner_key=?
         AND status IN ('pending','retry_scheduled')
         AND attempt_count < ?
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         AND EXISTS (
           SELECT 1 FROM partner_webhook_settings s
           WHERE s.partner_key=webhook_deliveries.partner_key
             AND s.status='active'
             AND s.endpoint_url=webhook_deliveries.endpoint_url
             AND s.signing_secret_version=webhook_deliveries.signing_secret_version
             AND (
               webhook_deliveries.event_type='webhook.test'
               OR EXISTS (
                 SELECT 1 FROM json_each(s.events_json)
                 WHERE value=webhook_deliveries.event_type
               )
             )
         )`
    ).bind(now, now, id, PARTNER_KEY, WEBHOOK_MAX_ATTEMPTS, now),
  ]);
  if (claim.meta.changes === 0) return;
  const row = await env.DB.prepare(`SELECT * FROM webhook_deliveries WHERE id=?`)
    .bind(id)
    .first<WebhookDeliveryRow>();
  if (!row) return;

  const secret = await getWebhookSigningSecret(env, row.signing_secret_version);
  if (!secret) {
    await recordWebhookFailure(env, row, 'webhook_signing_secret_unavailable', null);
    return;
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await webhookSignature(secret, timestamp, row.payload_json);
    const response = await fetch(row.endpoint_url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_DELIVERY_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'VA-BaaS-Webhook/1.0',
        'X-VA-Webhook-Id': row.id,
        'X-VA-Webhook-Timestamp': timestamp,
        'X-VA-Webhook-Signature': `v1=${signature}`,
        'X-VA-Webhook-Key-Id': row.signing_secret_version,
        'X-VA-Webhook-Attempt': String(row.attempt_count),
      },
      body: row.payload_json,
    });
    if (response.ok) {
      const completedAt = new Date().toISOString();
      await env.DB.prepare(
        `UPDATE webhook_deliveries
         SET status='delivered',next_attempt_at=NULL,response_status=?,
           last_error=NULL,delivered_at=?,updated_at=?
         WHERE id=? AND status='delivering' AND attempt_count=?`
      )
        .bind(response.status, completedAt, completedAt, row.id, row.attempt_count)
        .run();
      console.log(
        JSON.stringify({
          event: 'webhook_delivered',
          delivery_id: row.id,
          event_type: row.event_type,
          attempt: row.attempt_count,
          response_status: response.status,
        })
      );
      return;
    }
    await recordWebhookFailure(env, row, `webhook_http_${response.status}`, response.status);
  } catch (caught) {
    await recordWebhookFailure(env, row, safeDeliveryError(caught), null);
  }
}

async function processWebhookDeliveries(env: WebhookEnv, limit: number) {
  const now = new Date();
  const nowIso = now.toISOString();
  const staleCutoff = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
  const expiredKeys = await env.DB.prepare(
    `UPDATE partner_webhook_signing_keys
     SET status='revoked',updated_at=?
     WHERE partner_key=? AND status='retiring' AND expires_at<=?`
  )
    .bind(nowIso, PARTNER_KEY, nowIso)
    .run();
  if (expiredKeys.meta.changes > 0) {
    await integrationAuditStatement(
      env,
      'api_integration.webhook_signing_keys_expired',
      { count: expiredKeys.meta.changes, automated: true },
      'operator',
      nowIso
    ).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE webhook_deliveries
       SET status='retry_scheduled',next_attempt_at=?,updated_at=?,
         last_error='delivery_claim_timeout'
       WHERE status='delivering' AND attempt_count < ?
         AND last_attempt_at <= ?`
    ).bind(nowIso, nowIso, WEBHOOK_MAX_ATTEMPTS, staleCutoff),
    env.DB.prepare(
      `UPDATE webhook_deliveries
       SET status='dead_letter',next_attempt_at=NULL,updated_at=?,
         last_error='delivery_claim_timeout'
       WHERE status='delivering' AND attempt_count >= ?
         AND last_attempt_at <= ?`
    ).bind(nowIso, WEBHOOK_MAX_ATTEMPTS, staleCutoff),
  ]);
  if (!(await hasWebhookSigningSecret(env))) {
    console.warn(
      JSON.stringify({
        event: 'webhook_retry_schedule_skipped',
        reason: 'webhook_signing_secret_unavailable',
      })
    );
    return;
  }
  const due = await env.DB.prepare(
    `SELECT id FROM webhook_deliveries
     WHERE partner_key=?
       AND status IN ('pending','retry_scheduled')
       AND attempt_count < ?
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY COALESCE(next_attempt_at,created_at),created_at
     LIMIT ?`
  )
    .bind(PARTNER_KEY, WEBHOOK_MAX_ATTEMPTS, nowIso, limit)
    .all<{ id: string }>();
  await Promise.all(due.results.map((row) => deliverWebhookById(env, row.id)));
}

function webhookDeliveryMatchesSettings(
  row: WebhookDeliveryRow,
  settings: WebhookSettingsRow | null
) {
  return Boolean(
    settings?.status === 'active' &&
      settings.endpoint_url === row.endpoint_url &&
      settings.signing_secret_version === row.signing_secret_version &&
      (row.event_type === 'webhook.test' ||
        parseWebhookEventsJson(settings.events_json).includes(row.event_type as WebhookEventType))
  );
}

type WebhookReplaySnapshot = {
  eventType: WebhookEventType;
  resourceType: Exclude<WebhookDeliveryRow['resource_type'], 'webhook'>;
  resourceId: string;
  applicationId: string | null;
  resourceStatus: string;
  data: Record<string, unknown>;
};

function webhookReplayStateMismatch(message: string) {
  return error(409, 'webhook_replay_state_mismatch', message);
}

function hasDisallowedReplayField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasDisallowedReplayField);
  if (!isRecord(value)) return false;
  const disallowed = new Set([
    'operator_note',
    'reviewed_by',
    'last_error',
    'signing_secret',
    'signing_secret_version',
  ]);
  return Object.entries(value).some(
    ([key, nested]) => disallowed.has(key) || hasDisallowedReplayField(nested)
  );
}

async function buildWebhookReplaySnapshot(
  env: WebhookEnv,
  eventType: WebhookEventType,
  resourceId: string
): Promise<WebhookReplaySnapshot | Response> {
  if (eventType === 'application.status_changed' || eventType === 'va_account.activated') {
    const application = await env.DB.prepare(
      `${APPLICATION_SELECT} WHERE a.id=? AND a.partner_key=?`
    )
      .bind(resourceId, PARTNER_KEY)
      .first<ApplicationRow>();
    if (!application) return error(404, 'not_found', '开户申请不存在');
    if (eventType === 'application.status_changed') {
      const normalized = normalizeApplication(application);
      if (application.status === 'kyc_link_ready' && !application.kyc_url) {
        return error(409, 'webhook_replay_source_incomplete', '开户申请缺少 Sumsub 链接');
      }
      return {
        eventType,
        resourceType: 'va_application',
        resourceId: application.id,
        applicationId: application.id,
        resourceStatus: normalized.status,
        data: {
          ...(application.status === 'kyc_link_ready' ? { kyc_url: application.kyc_url } : {}),
          resource_type: 'va_application',
          resource_id: application.id,
          application_id: application.id,
          partner_customer_id: application.partner_customer_id,
          status: normalized.status,
          ...applicationActionRequiredData(application),
        },
      };
    }
    if (
      application.status !== 'active' ||
      !application.account_name ||
      !application.account_number ||
      !application.currency ||
      !application.swift_bic ||
      !application.bank_name ||
      !application.bank_address
    ) {
      return webhookReplayStateMismatch('只有已开通且账户信息完整的 VA 账户可以补发');
    }
    return {
      eventType,
      resourceType: 'va_account',
      resourceId: application.id,
      applicationId: application.id,
      resourceStatus: 'active',
      data: {
        va_account: {
          account_name: application.account_name,
          account_number: application.account_number,
          iban: application.iban,
          currency: application.currency,
          swift_bic: application.swift_bic,
          bank_name: application.bank_name,
          bank_address: application.bank_address,
        },
        resource_type: 'va_account',
        resource_id: application.id,
        application_id: application.id,
        partner_customer_id: application.partner_customer_id,
        status: 'active',
      },
    };
  }

  if (
    eventType === 'fund_transaction.status_changed' ||
    eventType === 'fiat_deposit.cleared_and_converted'
  ) {
    const fund = await env.DB.prepare(
      `SELECT f.*,a.partner_customer_id
       FROM fund_transactions f
       JOIN va_applications a ON a.id=f.application_id
       WHERE f.id=? AND a.partner_key=?`
    )
      .bind(resourceId, PARTNER_KEY)
      .first<FundRow>();
    if (!fund) return error(404, 'not_found', '资金交易不存在');
    if (eventType === 'fund_transaction.status_changed') {
      return {
        eventType,
        resourceType: 'fund_transaction',
        resourceId: fund.id,
        applicationId: fund.application_id,
        resourceStatus: fund.status,
        data: {
          ...fundTransactionWebhookData(fund),
          resource_type: 'fund_transaction',
          resource_id: fund.id,
          application_id: fund.application_id,
          partner_customer_id: fund.partner_customer_id ?? null,
          status: fund.status,
        },
      };
    }
    if (
      fund.type !== 'fiat_deposit' ||
      fund.status !== 'completed' ||
      fund.settlement_status !== 'cleared' ||
      !fund.conversion_otc_id
    ) {
      return webhookReplayStateMismatch('该资金交易尚未完成法币清算兑换');
    }
    const otc = await env.DB.prepare(
      `SELECT o.* FROM otc_orders o
       JOIN va_applications a ON a.id=o.application_id
       WHERE o.id=? AND o.source_fund_transaction_id=? AND a.partner_key=?`
    )
      .bind(fund.conversion_otc_id, fund.id, PARTNER_KEY)
      .first<OtcRow>();
    if (!otc || otc.status !== 'completed') {
      return error(409, 'webhook_replay_source_incomplete', '清算关联的 OTC 订单不完整');
    }
    const rateVersion = await env.DB.prepare(
      `SELECT version FROM conversion_setting_versions
       WHERE setting_id='usd_usdt_tron' AND exchange_rate=? AND created_at<=?
       ORDER BY version DESC LIMIT 1`
    )
      .bind(otc.exchange_rate, fund.completed_at || fund.updated_at)
      .first<{ version: number }>();
    if (!rateVersion) {
      return error(409, 'webhook_replay_source_incomplete', '无法确认该笔清算使用的汇率版本');
    }
    return {
      eventType,
      resourceType: 'fund_transaction',
      resourceId: fund.id,
      applicationId: fund.application_id,
      resourceStatus: 'completed',
      data: {
        resource_type: 'fund_transaction',
        resource_id: fund.id,
        application_id: fund.application_id,
        partner_customer_id: fund.partner_customer_id ?? null,
        status: 'completed',
        transaction_type: 'fiat_deposit',
        direction: 'deposit',
        external_reference: fund.external_reference,
        transaction_reference: fund.external_reference,
        settlement_status: 'cleared',
        cleared_at: fund.completed_at || fund.updated_at,
        fiat_asset: 'USD',
        fiat_amount: minorToAmount(fund.amount_minor, fund.asset_decimals),
        exchange_rate: otc.exchange_rate,
        exchange_rate_version: rateVersion.version,
        usdt_amount: minorToAmount(otc.buy_amount_minor, otc.buy_decimals),
        usdt_net_amount: minorToAmount(otc.buy_amount_minor, otc.buy_decimals),
        usdt_network: 'TRON',
        otc_order_id: otc.id,
        otc_status: 'completed',
      },
    };
  }

  if (eventType === 'otc_order.status_changed') {
    const otc = await env.DB.prepare(
      `SELECT o.*,a.partner_customer_id FROM otc_orders o
       JOIN va_applications a ON a.id=o.application_id
       WHERE o.id=? AND a.partner_key=?`
    )
      .bind(resourceId, PARTNER_KEY)
      .first<OtcRow>();
    if (!otc) return error(404, 'not_found', 'OTC 订单不存在');
    return {
      eventType,
      resourceType: 'otc_order',
      resourceId: otc.id,
      applicationId: otc.application_id,
      resourceStatus: otc.status,
      data: {
        resource_type: 'otc_order',
        resource_id: otc.id,
        application_id: otc.application_id,
        partner_customer_id: otc.partner_customer_id ?? null,
        status: otc.status,
      },
    };
  }

  const expectedSweepStatus = {
    'usdt_sweep.locked': 'locked',
    'usdt_sweep.completed': 'completed',
    'usdt_sweep.cancelled': 'cancelled',
  }[eventType] as SweepBatchRow['status'] | undefined;
  if (!expectedSweepStatus) {
    return error(422, 'validation_error', '不支持该 Webhook 事件');
  }
  const batch = await env.DB.prepare(
    `SELECT * FROM usdt_sweep_batches WHERE id=? AND partner_key=?`
  )
    .bind(resourceId, PARTNER_KEY)
    .first<SweepBatchRow>();
  if (!batch) return error(404, 'not_found', '归集批次不存在');
  if (batch.status !== expectedSweepStatus) {
    return webhookReplayStateMismatch('归集批次当前状态与事件不一致；历史状态请从已有投递记录补发');
  }
  const itemRows = await env.DB.prepare(
    `SELECT i.*,a.customer_name,a.partner_customer_id
     FROM usdt_sweep_items i
     JOIN va_applications a ON a.id=i.application_id
     WHERE i.batch_id=? AND a.partner_key=? ORDER BY i.created_at`
  )
    .bind(batch.id, PARTNER_KEY)
    .all<SweepItemRow>();
  const includeCustomerName = eventType === 'usdt_sweep.completed';
  return {
    eventType,
    resourceType: 'usdt_sweep_batch',
    resourceId: batch.id,
    applicationId: null,
    resourceStatus: batch.status,
    data: {
      resource_type: 'usdt_sweep_batch',
      batch_id: batch.id,
      partner_customer_id: null,
      status: batch.status,
      ...(eventType !== 'usdt_sweep.cancelled' ? { network: batch.network } : {}),
      destination_address: batch.destination_address,
      total_amount: minorToAmount(batch.total_amount_minor, batch.asset_decimals),
      ...(eventType !== 'usdt_sweep.locked' ? { tx_hash: batch.tx_hash } : {}),
      ...(eventType === 'usdt_sweep.cancelled'
        ? {}
        : {
            items: itemRows.results.map((item) => ({
              application_id: item.application_id,
              partner_customer_id: item.partner_customer_id,
              ...(includeCustomerName ? { customer_name: item.customer_name } : {}),
              amount: minorToAmount(item.amount_minor, item.asset_decimals),
            })),
          }),
    },
  };
}

async function createWebhookReplay(env: WebhookEnv, request: Request) {
  if (!(await hasWebhookSigningSecret(env))) {
    return error(503, 'webhook_secret_unavailable', 'Webhook 签名 Secret 尚未配置');
  }
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const unknown = rejectUnknownFields(body, [
    'source_delivery_id',
    'event_type',
    'resource_id',
    'reason',
  ]);
  if (unknown) return unknown;
  const sourceDeliveryId = normalizeOptionalText(
    body.source_delivery_id,
    'source_delivery_id',
    128
  );
  if (sourceDeliveryId instanceof Response) return sourceDeliveryId;
  const eventTypeValue = normalizeOptionalText(body.event_type, 'event_type', 128);
  if (eventTypeValue instanceof Response) return eventTypeValue;
  const resourceId = normalizeOptionalText(body.resource_id, 'resource_id', 128);
  if (resourceId instanceof Response) return resourceId;
  const reason = normalizeOptionalText(body.reason, 'reason', 500);
  if (reason instanceof Response) return reason;
  const usesSource = Boolean(sourceDeliveryId);
  const usesResource = Boolean(eventTypeValue || resourceId);
  if (!reason) return error(422, 'validation_error', '补发原因不能为空');
  if (usesSource === usesResource || (usesResource && (!eventTypeValue || !resourceId))) {
    return error(422, 'validation_error', '请仅选择历史投递，或同时提供 event_type 与 resource_id');
  }
  if (eventTypeValue && !WEBHOOK_EVENTS.includes(eventTypeValue as WebhookEventType)) {
    return error(422, 'validation_error', '不支持该 Webhook 事件');
  }
  const settings = await getWebhookSettings(env);
  if (!settings || settings.status !== 'active' || !settings.endpoint_url) {
    return error(409, 'webhook_not_active', '当前 Webhook 配置未启用');
  }

  let snapshot: WebhookReplaySnapshot;
  if (sourceDeliveryId) {
    const source = await env.DB.prepare(
      `SELECT * FROM webhook_deliveries WHERE id=? AND partner_key=?`
    )
      .bind(sourceDeliveryId, PARTNER_KEY)
      .first<WebhookDeliveryRow>();
    if (!source) return error(404, 'not_found', 'Webhook 投递不存在');
    if (source.event_type === 'webhook.test') {
      return error(422, 'validation_error', 'Webhook 测试事件不能作为业务补发来源');
    }
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(source.payload_json);
    } catch {
      return error(409, 'webhook_replay_source_invalid', '历史投递内容无法解析');
    }
    if (
      !isRecord(parsedPayload) ||
      parsedPayload.type !== source.event_type ||
      !isRecord(parsedPayload.data) ||
      hasDisallowedReplayField(parsedPayload.data)
    ) {
      return error(409, 'webhook_replay_source_invalid', '历史投递内容不适合补发');
    }
    snapshot = {
      eventType: source.event_type,
      resourceType: source.resource_type as WebhookReplaySnapshot['resourceType'],
      resourceId: source.resource_id,
      applicationId: source.application_id,
      resourceStatus: source.resource_status,
      data: parsedPayload.data,
    };
  } else {
    const built = await buildWebhookReplaySnapshot(
      env,
      eventTypeValue as WebhookEventType,
      resourceId as string
    );
    if (built instanceof Response) return built;
    snapshot = built;
  }
  if (!parseWebhookEventsJson(settings.events_json).includes(snapshot.eventType)) {
    return error(409, 'webhook_event_not_subscribed', '当前 Webhook 配置未订阅该事件');
  }

  const eventId = `evt_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date().toISOString();
  const payload = JSON.stringify({
    event_id: eventId,
    type: snapshot.eventType,
    occurred_at: now,
    data: snapshot.data,
  });
  const [insert] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO webhook_deliveries
        (id,partner_key,event_type,resource_type,resource_id,application_id,
         resource_status,endpoint_url,payload_json,signing_secret_version,status,
         attempt_count,next_attempt_at,created_at,updated_at)
       SELECT ?,s.partner_key,?,?,?,?,?,s.endpoint_url,?,s.signing_secret_version,
         'pending',0,?,?,?
       FROM partner_webhook_settings s
       WHERE s.partner_key=? AND s.status='active' AND s.endpoint_url IS NOT NULL
         AND s.updated_at=?
         AND EXISTS (
           SELECT 1 FROM json_each(s.events_json) WHERE value=?
         )`
    ).bind(
      eventId,
      snapshot.eventType,
      snapshot.resourceType,
      snapshot.resourceId,
      snapshot.applicationId,
      snapshot.resourceStatus,
      payload,
      now,
      now,
      now,
      PARTNER_KEY,
      settings.updated_at,
      snapshot.eventType
    ),
    integrationStateAuditStatement(
      env,
      'api_integration.webhook_delivery_replayed',
      auditMetadata(request, 'operator', {
        replay_delivery_id: eventId,
        source_delivery_id: sourceDeliveryId || null,
        mode: sourceDeliveryId ? 'source_delivery' : 'resource_snapshot',
        event_type: snapshot.eventType,
        resource_type: snapshot.resourceType,
        resource_id: snapshot.resourceId,
        reason,
      }),
      'operator',
      'webhook_deliveries',
      eventId,
      'pending',
      now
    ),
  ]);
  if (insert.meta.changes === 0) {
    return error(409, 'webhook_configuration_changed', 'Webhook 配置已变化，请刷新后重试');
  }
  const created = await env.DB.prepare(
    `SELECT * FROM webhook_deliveries WHERE id=? AND partner_key=?`
  )
    .bind(eventId, PARTNER_KEY)
    .first<WebhookDeliveryRow>();
  return json({ data: normalizeWebhookDelivery(created as WebhookDeliveryRow, true) }, 202);
}

async function retryWebhookDelivery(env: WebhookEnv, id: string) {
  if (!(await hasWebhookSigningSecret(env))) {
    return error(503, 'webhook_secret_unavailable', 'Webhook 签名 Secret 尚未配置');
  }
  const [current, settings] = await Promise.all([
    env.DB.prepare(`SELECT * FROM webhook_deliveries WHERE id=? AND partner_key=?`)
      .bind(id, PARTNER_KEY)
      .first<WebhookDeliveryRow>(),
    getWebhookSettings(env),
  ]);
  if (!current) return error(404, 'not_found', 'Webhook 投递不存在');
  if (!['retry_scheduled', 'dead_letter'].includes(current.status)) {
    return error(409, 'invalid_status', '只有失败或待重试的投递可以手动重试');
  }
  if (!webhookDeliveryMatchesSettings(current, settings)) {
    return error(409, 'webhook_configuration_changed', '当前 Webhook 配置已变化，不能重试该投递');
  }

  const now = new Date().toISOString();
  const [result] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE webhook_deliveries
       SET status='pending',attempt_count=0,next_attempt_at=?,
         last_attempt_at=NULL,response_status=NULL,last_error=NULL,
         delivered_at=NULL,updated_at=?
       WHERE id=? AND partner_key=?
         AND status IN ('retry_scheduled','dead_letter')
         AND EXISTS (
           SELECT 1 FROM partner_webhook_settings s
           WHERE s.partner_key=webhook_deliveries.partner_key
             AND s.status='active'
             AND s.endpoint_url=webhook_deliveries.endpoint_url
             AND s.signing_secret_version=webhook_deliveries.signing_secret_version
             AND (
               webhook_deliveries.event_type='webhook.test'
               OR EXISTS (
                 SELECT 1 FROM json_each(s.events_json)
                 WHERE value=webhook_deliveries.event_type
               )
             )
         )`
    ).bind(now, now, id, PARTNER_KEY),
    integrationStateAuditStatement(
      env,
      'api_integration.webhook_delivery_retried',
      { delivery_id: id },
      'operator',
      'webhook_deliveries',
      id,
      'pending',
      now
    ),
  ]);
  if (result.meta.changes === 0) {
    const [latest, latestSettings] = await Promise.all([
      env.DB.prepare(`SELECT * FROM webhook_deliveries WHERE id=? AND partner_key=?`)
        .bind(id, PARTNER_KEY)
        .first<WebhookDeliveryRow>(),
      getWebhookSettings(env),
    ]);
    if (!latest) return error(404, 'not_found', 'Webhook 投递不存在');
    if (!webhookDeliveryMatchesSettings(latest, latestSettings)) {
      return error(409, 'webhook_configuration_changed', '当前 Webhook 配置已变化，不能重试该投递');
    }
    return error(409, 'invalid_status', '投递已被其他操作处理');
  }
  const row = await env.DB.prepare(`SELECT * FROM webhook_deliveries WHERE id=?`)
    .bind(id)
    .first<WebhookDeliveryRow>();
  return json({
    data: normalizeWebhookDelivery(row as WebhookDeliveryRow, true),
  });
}

async function getApplication(env: Env, id: string, partnerScoped = false) {
  return env.DB.prepare(
    `${APPLICATION_SELECT} WHERE (a.id = ? OR a.partner_customer_id = ?)${
      partnerScoped ? ' AND a.partner_key = ?' : ''
    }`
  )
    .bind(...(partnerScoped ? [id, id, PARTNER_KEY] : [id, id]))
    .first<ApplicationRow>();
}

async function resolveApplicationQuery(
  env: Env,
  url: URL,
  partnerScoped = false
): Promise<string | null | Response> {
  const applicationId = url.searchParams.get('application_id')?.trim() || '';
  const partnerCustomerId = url.searchParams.get('partner_customer_id')?.trim() || '';
  if (applicationId && partnerCustomerId) {
    return error(422, 'validation_error', 'application_id 与 partner_customer_id 只能提交一个');
  }
  if (!partnerCustomerId) return applicationId || null;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(partnerCustomerId)
  ) {
    return error(422, 'invalid_partner_customer_id', '客户方客户 ID 必须是小写 UUID v4 字符串');
  }
  const row = await env.DB.prepare(
    `SELECT id FROM va_applications
     WHERE partner_customer_id=?${partnerScoped ? ' AND partner_key=?' : ''}`
  )
    .bind(...(partnerScoped ? [partnerCustomerId, PARTNER_KEY] : [partnerCustomerId]))
    .first<{ id: string }>();
  return row?.id || error(404, 'not_found', '客户方客户 ID 不存在');
}

async function resolveApplicationBody(
  env: Env,
  body: Record<string, unknown>,
  partnerScoped = false
) {
  if (body.application_id !== undefined && typeof body.application_id !== 'string') {
    return error(422, 'validation_error', 'application_id 必须是字符串');
  }
  if (body.partner_customer_id !== undefined && typeof body.partner_customer_id !== 'string') {
    return error(
      422,
      'invalid_partner_customer_id',
      'partner_customer_id 必须是小写 UUID v4 字符串'
    );
  }
  const selectorUrl = new URL('https://internal.invalid/');
  if (body.application_id) {
    selectorUrl.searchParams.set('application_id', String(body.application_id));
  }
  if (body.partner_customer_id) {
    selectorUrl.searchParams.set('partner_customer_id', String(body.partner_customer_id));
  }
  return resolveApplicationQuery(env, selectorUrl, partnerScoped);
}

async function listApplications(env: Env, url: URL, includeInactiveKycUrl = false) {
  const status = url.searchParams.get('status');
  const search = url.searchParams.get('search')?.trim();
  const partnerCustomerId = url.searchParams.get('partner_customer_id')?.trim();
  const conditions: string[] = [];
  const values: string[] = [];

  if (!includeInactiveKycUrl) {
    conditions.push('a.partner_key = ?');
    values.push(PARTNER_KEY);
  }

  if (status) {
    if (status === 'changes_requested') {
      conditions.push('a.current_review_id IS NOT NULL');
    } else {
      conditions.push('a.status = ? AND a.current_review_id IS NULL');
      values.push(status);
    }
  }
  if (partnerCustomerId) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        partnerCustomerId
      )
    ) {
      return error(422, 'invalid_partner_customer_id', '客户方客户 ID 必须是小写 UUID v4 字符串');
    }
    conditions.push('a.partner_customer_id = ?');
    values.push(partnerCustomerId);
  }
  if (search) {
    conditions.push(
      '(lower(a.customer_name) LIKE ? OR lower(a.email) LIKE ? OR lower(a.id) LIKE ? OR a.partner_customer_id LIKE ?)'
    );
    const pattern = `%${search.toLowerCase()}%`;
    values.push(pattern, pattern, pattern, pattern);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const statement = env.DB.prepare(
    `${APPLICATION_SELECT} ${where} ORDER BY a.created_at DESC LIMIT 100`
  );
  const result = await (values.length
    ? statement.bind(...values)
    : statement
  ).all<ApplicationRow>();

  return json({
    data: result.results.map((application) =>
      normalizeApplication(application, includeInactiveKycUrl)
    ),
    meta: { count: result.results.length },
  });
}

function listCountryCallingCodes() {
  return json({
    data: SUPPORTED_COUNTRY_CALLING_CODES.map((option) => ({
      iso2: option.iso2,
      country: option.country,
      country_zh: option.countryZh,
      calling_code: option.callingCode,
    })),
    meta: {
      count: SUPPORTED_COUNTRY_CALLING_CODES.length,
      unique_calling_code_count: SUPPORTED_CALLING_CODE_VALUES.length,
      policy: COUNTRY_CALLING_CODE_POLICY,
    },
  });
}

async function createApplication(
  env: Env,
  request: Request,
  actorType: 'operator' | 'partner' = 'partner'
) {
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const unknownFields = rejectUnknownFields(parsed, [
    'partner_customer_id',
    'phone_country_code',
    'phone_number',
    'email',
    'customer_name',
  ]);
  if (unknownFields) return unknownFields;
  const validation = validateCreate(parsed);
  if (validation) return validation;

  const body = parsed as CreateApplicationBody;
  const id = `va_app_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date().toISOString();

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO va_applications
          (id, partner_customer_id, phone_country_code, phone_number, email, customer_name,
           status, last_submitted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?)`
      ).bind(
        id,
        body.partner_customer_id,
        body.phone_country_code.trim(),
        body.phone_number.replaceAll(/[^\d]/g, ''),
        body.email.trim().toLowerCase(),
        body.customer_name.trim(),
        now,
        now,
        now
      ),
      webhookOutboxStatement(
        env,
        'application.status_changed',
        'va_application',
        id,
        id,
        'submitted',
        now,
        {
          table: 'va_applications',
          id,
          status: 'submitted',
          updatedAt: now,
        },
        {
          onboarding_stage: 'submitted',
          submission_round: 1,
          application_version: 1,
          action_required: null,
        }
      ),
      businessAuditStatement(
        env,
        id,
        'application.created',
        auditMetadata(request, actorType, {}),
        actorType,
        {
          table: 'va_applications',
          id,
          status: 'submitted',
          updatedAt: now,
        }
      ),
    ]);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : '';
    if (message.includes('UNIQUE constraint failed')) {
      if (message.includes('partner_customer_id')) {
        return error(409, 'partner_customer_id_conflict', '该客户方客户 ID 已存在');
      }
      return error(409, 'duplicate_application', '该邮箱已有未完成的开户申请');
    }
    throw caught;
  }

  const application = await getApplication(env, id);
  return json(normalizeApplication(application as ApplicationRow), 201, {
    location: `/api/v1/va-applications/${id}`,
  });
}

async function requestApplicationChanges(env: Env, id: string, request: Request) {
  const current = await getApplication(env, id);
  if (!current) return error(404, 'not_found', '开户申请不存在');
  if (current.status === 'active') {
    return error(409, 'application_already_active', '已开通的 VA 账户不能退回补正状态');
  }
  if (current.current_review_id) {
    return error(409, 'changes_already_requested', '该开户申请已在等待合作伙伴补正');
  }

  const body = await readJson(request);
  if (body instanceof Response) return body;
  const unknown = rejectUnknownFields(body, [
    'reason_code',
    'reason_text',
    'required_fields',
    'internal_note',
    'expected_version',
  ]);
  if (unknown) return unknown;
  if (
    typeof body.reason_code !== 'string' ||
    !APPLICATION_CHANGE_REASON_CODES.includes(
      body.reason_code as (typeof APPLICATION_CHANGE_REASON_CODES)[number]
    )
  ) {
    return error(422, 'validation_error', '请选择有效的驳回原因分类');
  }
  const reasonText = normalizeOptionalText(body.reason_text, 'reason_text', 500);
  if (reasonText instanceof Response) return reasonText;
  if (!reasonText || reasonText.length < 10) {
    return error(422, 'validation_error', '用户可见的驳回原因至少需要 10 个字符');
  }
  if (!Array.isArray(body.required_fields) || body.required_fields.length === 0) {
    return error(422, 'validation_error', '至少选择一个需要补正的字段');
  }
  const requiredFields = [...new Set(body.required_fields)];
  if (
    requiredFields.some(
      (field) =>
        typeof field !== 'string' ||
        !APPLICATION_CORRECTABLE_FIELDS.includes(
          field as (typeof APPLICATION_CORRECTABLE_FIELDS)[number]
        )
    )
  ) {
    return error(422, 'validation_error', '需要补正的字段无效');
  }
  const internalNote = normalizeOptionalText(body.internal_note, 'internal_note', 1000);
  if (internalNote instanceof Response) return internalNote;
  if (!Number.isSafeInteger(body.expected_version) || Number(body.expected_version) < 1) {
    return error(422, 'validation_error', 'expected_version 必须是正整数');
  }
  if (Number(body.expected_version) !== current.application_version) {
    return error(409, 'application_version_conflict', '开户申请已被更新，请刷新后重试', {
      current_version: current.application_version,
    });
  }

  const reviewId = `var_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date().toISOString();
  const nextVersion = current.application_version + 1;
  const publicActionRequired = {
    type: 'resubmit',
    reason_code: body.reason_code,
    reason_message: reasonText,
    required_fields: requiredFields,
    requested_at: now,
  };
  const [updated] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE va_applications
       SET current_review_id=?,application_version=?,updated_at=?
       WHERE id=? AND status=? AND current_review_id IS NULL
         AND application_version=? AND updated_at=?`
    ).bind(
      reviewId,
      nextVersion,
      now,
      id,
      current.status,
      current.application_version,
      current.updated_at
    ),
    env.DB.prepare(
      `INSERT INTO va_application_reviews
        (id,application_id,submission_round,decision,review_stage,
         public_reason_code,public_reason_text,required_fields_json,internal_note,
         reviewed_by,reviewed_at,created_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
       WHERE EXISTS (
         SELECT 1 FROM va_applications
         WHERE id=? AND current_review_id=? AND application_version=? AND updated_at=?
       )`
    ).bind(
      reviewId,
      id,
      current.submission_round,
      'changes_requested',
      current.status,
      body.reason_code,
      reasonText,
      JSON.stringify(requiredFields),
      internalNote,
      auditActor(request, 'operator'),
      now,
      now,
      id,
      reviewId,
      nextVersion,
      now
    ),
    webhookOutboxStatement(
      env,
      'application.status_changed',
      'va_application',
      id,
      id,
      'changes_requested',
      now,
      {
        table: 'va_applications',
        id,
        status: current.status,
        updatedAt: now,
        currentReviewId: reviewId,
      },
      {
        onboarding_stage: current.status,
        submission_round: current.submission_round,
        application_version: nextVersion,
        action_required: publicActionRequired,
      }
    ),
    businessAuditStatement(
      env,
      id,
      'application.changes_requested',
      auditMetadata(request, 'operator', {
        previous_status: current.status,
        status: 'changes_requested',
        submission_round: current.submission_round,
        application_version: nextVersion,
        reason_code: body.reason_code,
        reason_message: reasonText,
        required_fields: requiredFields,
      }),
      'operator',
      {
        table: 'va_applications',
        id,
        status: current.status,
        updatedAt: now,
        currentReviewId: reviewId,
      }
    ),
  ]);
  if (updated.meta.changes === 0) {
    return error(409, 'application_version_conflict', '开户申请已被更新，请刷新后重试');
  }
  const result = await getApplication(env, id);
  return json(normalizeApplication(result as ApplicationRow, true));
}

async function resubmitApplication(env: Env, id: string, request: Request) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const unknown = rejectUnknownFields(body, [
    'phone_country_code',
    'phone_number',
    'email',
    'customer_name',
    'expected_version',
    'response_note',
  ]);
  if (unknown) return unknown;
  const validation = validateCreate(body, true);
  if (validation) return validation;
  if (!Number.isSafeInteger(body.expected_version) || Number(body.expected_version) < 1) {
    return error(422, 'validation_error', 'expected_version 必须是正整数');
  }
  const responseNote = normalizeOptionalText(body.response_note, 'response_note', 500);
  if (responseNote instanceof Response) return responseNote;
  const idempotencyKey = resolveIdempotencyKey(request, true);
  if (idempotencyKey instanceof Response) return idempotencyKey;
  const normalizedRequest = {
    application_id: id,
    phone_country_code: String(body.phone_country_code).trim(),
    phone_number: String(body.phone_number).replaceAll(/[^\d]/g, ''),
    email: String(body.email).trim().toLowerCase(),
    customer_name: String(body.customer_name).trim(),
    expected_version: Number(body.expected_version),
    response_note: responseNote,
  };
  const fingerprint = await requestFingerprint(normalizedRequest);

  const existing = await env.DB.prepare(
    `SELECT r.application_id,r.request_fingerprint
     FROM va_application_reviews r
     JOIN va_applications a ON a.id=r.application_id
     WHERE r.idempotency_key=? AND a.partner_key=?`
  )
    .bind(idempotencyKey, PARTNER_KEY)
    .first<{
      application_id: string;
      request_fingerprint: string;
    }>();
  if (existing) {
    if (existing.application_id !== id || existing.request_fingerprint !== fingerprint) {
      return idempotencyConflict(existing.application_id);
    }
    const repeated = await getApplication(env, id, true);
    return repeated
      ? json(normalizeApplication(repeated))
      : error(404, 'not_found', '开户申请不存在');
  }
  const financialOwner = await findIdempotencyOwner(env, idempotencyKey);
  if (financialOwner) return idempotencyConflict(financialOwner.resourceId);

  const current = await getApplication(env, id, true);
  if (!current) return error(404, 'not_found', '开户申请不存在');
  if (!current.current_review_id) {
    return error(409, 'resubmission_not_allowed', '该开户申请当前不需要重新提交');
  }
  if (Number(body.expected_version) !== current.application_version) {
    return error(409, 'application_version_conflict', '开户申请已被更新，请刷新后重试', {
      current_version: current.application_version,
    });
  }

  const now = new Date().toISOString();
  const nextVersion = current.application_version + 1;
  const nextRound = current.submission_round + 1;
  try {
    const [updated] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE va_applications
         SET phone_country_code=?,phone_number=?,email=?,customer_name=?,
           status='submitted',current_review_id=NULL,submission_round=?,
           application_version=?,last_submitted_at=?,updated_at=?
         WHERE id=? AND partner_key=? AND current_review_id=?
           AND application_version=? AND updated_at=?`
      ).bind(
        normalizedRequest.phone_country_code,
        normalizedRequest.phone_number,
        normalizedRequest.email,
        normalizedRequest.customer_name,
        nextRound,
        nextVersion,
        now,
        now,
        id,
        PARTNER_KEY,
        current.current_review_id,
        current.application_version,
        current.updated_at
      ),
      env.DB.prepare(
        `UPDATE va_application_reviews
         SET resolved_at=?,resubmitted_at=?,resubmission_note=?,
           idempotency_key=?,request_fingerprint=?
         WHERE id=? AND application_id=? AND resolved_at IS NULL
           AND EXISTS (
             SELECT 1 FROM va_applications
             WHERE id=? AND partner_key=? AND current_review_id IS NULL
               AND status='submitted' AND application_version=? AND updated_at=?
           )`
      ).bind(
        now,
        now,
        responseNote,
        idempotencyKey,
        fingerprint,
        current.current_review_id,
        id,
        id,
        PARTNER_KEY,
        nextVersion,
        now
      ),
      env.DB.prepare(
        `INSERT INTO api_request_keys
          (idempotency_key,request_path,response_status,response_json,created_at)
         SELECT ?,?,200,?,?
         WHERE EXISTS (
           SELECT 1 FROM va_application_reviews
           WHERE id=? AND application_id=? AND idempotency_key=?
             AND request_fingerprint=? AND resolved_at=?
         )`
      ).bind(
        idempotencyKey,
        `/va-applications/${id}/resubmit`,
        JSON.stringify({
          resource_type: 'va_application',
          resource_id: id,
          request_fingerprint: fingerprint,
        }),
        now,
        current.current_review_id,
        id,
        idempotencyKey,
        fingerprint,
        now
      ),
      webhookOutboxStatement(
        env,
        'application.status_changed',
        'va_application',
        id,
        id,
        'submitted',
        now,
        {
          table: 'va_applications',
          id,
          status: 'submitted',
          updatedAt: now,
          resolvedReview: {
            id: current.current_review_id,
            idempotencyKey,
            requestFingerprint: fingerprint,
          },
        },
        {
          onboarding_stage: 'submitted',
          submission_round: nextRound,
          application_version: nextVersion,
          action_required: null,
        }
      ),
      businessAuditStatement(
        env,
        id,
        'application.resubmitted',
        auditMetadata(request, 'partner', {
          previous_review_id: current.current_review_id,
          previous_stage: current.status,
          status: 'submitted',
          submission_round: nextRound,
          application_version: nextVersion,
          fields: ['customer_name', 'phone_country_code', 'phone_number', 'email'],
        }),
        'partner',
        {
          table: 'va_applications',
          id,
          status: 'submitted',
          updatedAt: now,
          resolvedReview: {
            id: current.current_review_id,
            idempotencyKey,
            requestFingerprint: fingerprint,
          },
        }
      ),
    ]);
    if (updated.meta.changes === 0) {
      return error(409, 'application_version_conflict', '开户申请已被更新，请刷新后重试');
    }
  } catch (caught) {
    if ((caught instanceof Error ? caught.message : '').includes('UNIQUE')) {
      const concurrent = await env.DB.prepare(
        `SELECT application_id,request_fingerprint FROM va_application_reviews
         WHERE idempotency_key=?`
      )
        .bind(idempotencyKey)
        .first<{
          application_id: string;
          request_fingerprint: string;
        }>();
      if (concurrent?.application_id === id && concurrent.request_fingerprint === fingerprint) {
        const repeated = await getApplication(env, id, true);
        return json(normalizeApplication(repeated as ApplicationRow));
      }
      return idempotencyConflict(concurrent?.application_id || 'unknown');
    }
    throw caught;
  }
  const updated = await getApplication(env, id, true);
  return json(normalizeApplication(updated as ApplicationRow));
}

async function updateApplication(env: Env, id: string, request: Request) {
  const current = await getApplication(env, id);
  if (!current) return error(404, 'not_found', '开户申请不存在');

  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const unknownFields = rejectUnknownFields(parsed, ['profile', 'kyc_url', 'va_account', 'status']);
  if (unknownFields) return unknownFields;
  const body = parsed as UpdateApplicationBody;
  if (current.current_review_id) {
    return error(
      409,
      'changes_requested_pending',
      '该开户申请正在等待合作伙伴补正，不能继续推进状态'
    );
  }
  const now = new Date().toISOString();
  const requestedOperations = [body.profile, body.kyc_url, body.va_account, body.status].filter(
    (value) => value !== undefined
  );
  if (requestedOperations.length !== 1) {
    return error(422, 'validation_error', '每次只能提交一种客户资料或开户状态变更');
  }

  if (body.profile !== undefined) {
    if (!isRecord(body.profile)) {
      return error(422, 'validation_error', '客户基本资料格式无效');
    }
    const profileUnknownFields = rejectUnknownFields(body.profile, [
      'partner_customer_id',
      'phone_country_code',
      'phone_number',
      'email',
      'customer_name',
    ]);
    if (profileUnknownFields) return profileUnknownFields;
    const profileValidation = validateCreate(body.profile, true);
    if (profileValidation) return profileValidation;
    let result: D1Result;
    try {
      [result] = await env.DB.batch([
        env.DB.prepare(
          `UPDATE va_applications
          SET partner_customer_id=?,phone_country_code=?,phone_number=?,email=?,customer_name=?,
            application_version=application_version+1,updated_at=?
          WHERE id=? AND status=? AND updated_at=?`
        ).bind(
          body.profile.partner_customer_id ?? current.partner_customer_id,
          body.profile.phone_country_code.trim(),
          body.profile.phone_number.replaceAll(/[^\d]/g, ''),
          body.profile.email.trim().toLowerCase(),
          body.profile.customer_name.trim(),
          now,
          id,
          current.status,
          current.updated_at
        ),
        businessAuditStatement(
          env,
          id,
          'application.profile_updated',
          auditMetadata(request, 'operator', {
            fields: [
              'partner_customer_id',
              'customer_name',
              'phone_country_code',
              'phone_number',
              'email',
            ],
          }),
          'operator',
          {
            table: 'va_applications',
            id,
            status: current.status,
            updatedAt: now,
          }
        ),
      ]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '';
      if (message.includes('UNIQUE constraint failed')) {
        if (message.includes('partner_customer_id')) {
          return error(409, 'partner_customer_id_conflict', '该客户方客户 ID 已存在');
        }
        return error(409, 'duplicate_application', '该邮箱已有未完成的开户申请');
      }
      throw caught;
    }
    if (result.meta.changes === 0) {
      return error(409, 'invalid_status', '客户资料已被其他操作更新，请刷新后重试');
    }
  } else if (body.kyc_url !== undefined) {
    if (typeof body.kyc_url !== 'string') {
      return error(422, 'validation_error', 'KYC 链接必须是字符串');
    }
    const kycUrl = body.kyc_url.trim();
    try {
      const url = new URL(kycUrl);
      if (url.protocol !== 'https:') throw new Error('invalid protocol');
    } catch {
      return error(422, 'validation_error', 'KYC 链接必须是有效的 HTTPS 地址');
    }
    const nextStatus = current.status === 'submitted' ? 'kyc_link_ready' : current.status;
    const [result] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE va_applications
         SET kyc_url = ?, status = ?, application_version=application_version+1, updated_at = ?
         WHERE id = ? AND status = ? AND updated_at = ?`
      ).bind(kycUrl, nextStatus, now, id, current.status, current.updated_at),
      ...(nextStatus !== current.status
        ? [
            webhookOutboxStatement(
              env,
              'application.status_changed',
              'va_application',
              id,
              id,
              nextStatus,
              now,
              {
                table: 'va_applications',
                id,
                status: nextStatus,
                updatedAt: now,
              },
              {
                kyc_url: kycUrl,
                onboarding_stage: nextStatus,
                submission_round: current.submission_round,
                application_version: current.application_version + 1,
                action_required: null,
              }
            ),
          ]
        : []),
      businessAuditStatement(
        env,
        id,
        current.kyc_url ? 'kyc.link_updated' : 'kyc.link_added',
        auditMetadata(request, 'operator', {
          status_preserved: current.status !== 'submitted',
        }),
        'operator',
        {
          table: 'va_applications',
          id,
          status: nextStatus,
          updatedAt: now,
        }
      ),
    ]);
    if (result.meta.changes === 0) {
      return error(409, 'invalid_status', '开户申请已被其他操作处理，请刷新后重试');
    }
  } else if (body.va_account !== undefined) {
    if (!['kyc_approved', 'va_processing', 'active'].includes(current.status)) {
      return error(409, 'invalid_status', 'KYC 通过后才能录入或更新 VA 账户');
    }
    if (isRecord(body.va_account)) {
      const accountUnknownFields = rejectUnknownFields(body.va_account, [
        'account_name',
        'account_number',
        'iban',
        'currency',
        'swift_bic',
        'bank_name',
        'bank_address',
      ]);
      if (accountUnknownFields) return accountUnknownFields;
    }
    if (!validateAccount(body.va_account)) {
      return error(422, 'validation_error', 'VA 账户字段不完整');
    }
    const account = body.va_account;
    if (account.currency.trim().toUpperCase() !== 'USD') {
      return error(422, 'validation_error', 'V1 VA 账户币种仅支持 USD');
    }
    const normalizedAccount = {
      account_name: account.account_name.trim(),
      account_number: account.account_number.trim(),
      iban: account.iban?.trim() || null,
      currency: account.currency.trim().toUpperCase(),
      swift_bic: account.swift_bic.trim().toUpperCase(),
      bank_name: account.bank_name.trim(),
      bank_address: account.bank_address.trim(),
    };
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE va_applications
         SET status = 'active', application_version=application_version+1, updated_at = ?
         WHERE id = ? AND status = ? AND updated_at = ?`
      ).bind(now, id, current.status, current.updated_at),
      env.DB.prepare(
        `INSERT INTO va_accounts
          (id, application_id, account_name, account_number, iban, currency, swift_bic,
           bank_name, bank_address, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE changes() = 1
         ON CONFLICT(application_id) DO UPDATE SET
           account_name = excluded.account_name,
           account_number = excluded.account_number,
           iban = excluded.iban,
           currency = excluded.currency,
           swift_bic = excluded.swift_bic,
           bank_name = excluded.bank_name,
           bank_address = excluded.bank_address,
           updated_at = excluded.updated_at`
      ).bind(
        crypto.randomUUID(),
        id,
        normalizedAccount.account_name,
        normalizedAccount.account_number,
        normalizedAccount.iban,
        normalizedAccount.currency,
        normalizedAccount.swift_bic,
        normalizedAccount.bank_name,
        normalizedAccount.bank_address,
        now,
        now
      ),
      ...(current.status !== 'active'
        ? [
            webhookOutboxStatement(
              env,
              'application.status_changed',
              'va_application',
              id,
              id,
              'active',
              now,
              {
                table: 'va_applications',
                id,
                status: 'active',
                updatedAt: now,
              },
              {
                onboarding_stage: 'active',
                submission_round: current.submission_round,
                application_version: current.application_version + 1,
                action_required: null,
              }
            ),
            webhookOutboxStatement(
              env,
              'va_account.activated',
              'va_account',
              id,
              id,
              'active',
              now,
              {
                table: 'va_applications',
                id,
                status: 'active',
                updatedAt: now,
              },
              {
                va_account: normalizedAccount,
                onboarding_stage: 'active',
                submission_round: current.submission_round,
                application_version: current.application_version + 1,
                action_required: null,
              }
            ),
          ]
        : []),
      businessAuditStatement(
        env,
        id,
        current.status === 'active' ? 'va_account.updated' : 'va_account.activated',
        auditMetadata(request, 'operator', {
          fields: [
            'account_name',
            'account_number',
            'iban',
            'currency',
            'swift_bic',
            'bank_name',
            'bank_address',
          ],
        }),
        'operator',
        {
          table: 'va_applications',
          id,
          status: 'active',
          updatedAt: now,
        }
      ),
    ]);
    if (results[0].meta.changes === 0) {
      return error(409, 'invalid_status', '开户申请已被其他操作处理，请刷新后重试');
    }
  } else if (body.status !== undefined) {
    if (!STATUS_TRANSITIONS[current.status].includes(body.status)) {
      return error(409, 'invalid_status_transition', '不允许执行该状态变更', {
        current_status: current.status,
        requested_status: body.status,
      });
    }
    if (body.status === 'active') {
      return error(422, 'account_required', '必须同时提交完整 VA 账户资料');
    }
    const [result] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE va_applications
         SET status = ?, application_version=application_version+1, updated_at = ?
         WHERE id = ? AND status = ? AND updated_at = ?`
      ).bind(body.status, now, id, current.status, current.updated_at),
      webhookOutboxStatement(
        env,
        'application.status_changed',
        'va_application',
        id,
        id,
        body.status,
        now,
        {
          table: 'va_applications',
          id,
          status: body.status,
          updatedAt: now,
        },
        {
          onboarding_stage: body.status,
          submission_round: current.submission_round,
          application_version: current.application_version + 1,
          action_required: null,
        }
      ),
      businessAuditStatement(
        env,
        id,
        `status.changed_to_${body.status}`,
        auditMetadata(request, 'operator', {}),
        'operator',
        {
          table: 'va_applications',
          id,
          status: body.status,
          updatedAt: now,
        }
      ),
    ]);
    if (result.meta.changes === 0) {
      return error(409, 'invalid_status_transition', '开户申请已被其他操作处理，请刷新后重试');
    }
  } else {
    return error(422, 'validation_error', '没有可更新的字段');
  }

  const updated = await getApplication(env, id);
  return json(normalizeApplication(updated as ApplicationRow, true));
}

function amountToMinor(value: unknown, decimals: number, allowZero = false): number | Response {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) {
    return error(422, 'validation_error', '金额必须是正数字符串');
  }
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) {
    return error(422, 'validation_error', `金额最多支持 ${decimals} 位小数`);
  }
  const minor =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals));
  if ((!allowZero && minor <= 0n) || minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    return error(422, 'validation_error', '金额超出允许范围');
  }
  return Number(minor);
}

function minorToAmount(value: number, decimals: number) {
  const negative = value < 0;
  const digits = String(Math.abs(value)).padStart(decimals + 1, '0');
  const whole = digits.slice(0, -decimals) || '0';
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, '') : '';
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function defaultDecimals(asset: string) {
  return asset.toUpperCase() === 'USDT' ? 6 : 2;
}

const WITHDRAWAL_FEE_TYPES = ['fiat_withdrawal', 'usdt_withdrawal'] as const;

type WithdrawalFeeType = (typeof WITHDRAWAL_FEE_TYPES)[number];

type WithdrawalFeeRow = {
  type: WithdrawalFeeType;
  asset: string;
  amount_minor: number;
  asset_decimals: number;
  updated_at: string;
};

function isWithdrawalFeeType(value: string): value is WithdrawalFeeType {
  return WITHDRAWAL_FEE_TYPES.includes(value as WithdrawalFeeType);
}

function normalizeWithdrawalFee(row: WithdrawalFeeRow) {
  return {
    type: row.type,
    asset: row.asset,
    amount: minorToAmount(row.amount_minor, row.asset_decimals),
    asset_decimals: row.asset_decimals,
    updated_at: row.updated_at,
  };
}

async function getWithdrawalFee(env: Env, type: WithdrawalFeeType) {
  return env.DB.prepare(
    `SELECT type,asset,amount_minor,asset_decimals,updated_at
     FROM withdrawal_fee_settings WHERE type=?`
  )
    .bind(type)
    .first<WithdrawalFeeRow>();
}

async function listWithdrawalFees(env: Env) {
  const result = await env.DB.prepare(
    `SELECT type,asset,amount_minor,asset_decimals,updated_at
     FROM withdrawal_fee_settings
     ORDER BY CASE type WHEN 'fiat_withdrawal' THEN 1 ELSE 2 END`
  ).all<WithdrawalFeeRow>();
  return json({
    data: result.results.map(normalizeWithdrawalFee),
    meta: { count: result.results.length },
  });
}

async function updateWithdrawalFee(
  env: Env,
  typeValue: string,
  request: Request,
  requestId: string
) {
  if (!isWithdrawalFeeType(typeValue)) {
    return error(422, 'validation_error', '手续费类型仅支持 fiat_withdrawal 或 usdt_withdrawal');
  }
  const current = await getWithdrawalFee(env, typeValue);
  if (!current) return error(404, 'not_found', '转出手续费配置不存在');

  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const amountMinor = amountToMinor(parsed.amount, current.asset_decimals, true);
  if (amountMinor instanceof Response) return amountMinor;

  const now = new Date().toISOString();
  const [result] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE withdrawal_fee_settings
       SET amount_minor=?,updated_at=?
       WHERE type=? AND amount_minor=? AND updated_at=?`
    ).bind(amountMinor, now, typeValue, current.amount_minor, current.updated_at),
    env.DB.prepare(
      `INSERT INTO audit_logs
        (id,application_id,action,actor_type,metadata_json,created_at)
       SELECT ?,NULL,'withdrawal_fee.updated','operator',?,?
       WHERE changes() = 1`
    ).bind(
      crypto.randomUUID(),
      JSON.stringify({
        type: typeValue,
        asset: current.asset,
        old_amount: minorToAmount(current.amount_minor, current.asset_decimals),
        new_amount: minorToAmount(amountMinor, current.asset_decimals),
        old_amount_minor: current.amount_minor,
        new_amount_minor: amountMinor,
      }),
      now
    ),
  ]);
  if (result.meta.changes === 0) {
    return error(409, 'withdrawal_fee_changed', '手续费配置已被其他管理员更新，请刷新后重试');
  }
  console.log(
    JSON.stringify({
      event: 'withdrawal_fee_updated',
      request_id: requestId,
      type: typeValue,
      asset: current.asset,
      old_amount_minor: current.amount_minor,
      new_amount_minor: amountMinor,
    })
  );
  const updated = await getWithdrawalFee(env, typeValue);
  return json(normalizeWithdrawalFee(updated as WithdrawalFeeRow));
}

function ledgerNetwork(asset: string, network?: string | null) {
  return asset.toUpperCase() === 'USDT'
    ? String(network || '')
        .trim()
        .toUpperCase()
    : '';
}

function isSupportedCryptoNetwork(network: string) {
  return SUPPORTED_CRYPTO_NETWORKS.includes(network as (typeof SUPPORTED_CRYPTO_NETWORKS)[number]);
}

function validCryptoAddress(network: string, destination: string) {
  if (network === 'TRON') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(destination);
  if (network === 'ETHEREUM' || network === 'BSC') {
    return /^0x[a-fA-F0-9]{40}$/.test(destination);
  }
  if (network === 'SOLANA') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(destination);
  return false;
}

type FundRow = {
  id: string;
  application_id: string;
  external_reference: string | null;
  request_fingerprint: string | null;
  type: string;
  asset: string;
  amount_minor: number;
  fee_amount_minor: number;
  asset_decimals: number;
  network: string | null;
  destination: string | null;
  transaction_reference: string | null;
  beneficiary_name: string | null;
  beneficiary_address: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  swift_bic: string | null;
  bank_address: string | null;
  status: string;
  note: string | null;
  operator_note: string | null;
  settlement_status: 'pending' | 'cleared' | 'exception';
  conversion_otc_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  customer_name?: string;
  partner_customer_id?: string | null;
};

function normalizeFund(row: FundRow, includeOperatorFields = false) {
  const feeMinor = row.fee_amount_minor || 0;
  const isWithdrawal = isWithdrawalFeeType(row.type);
  return {
    id: row.id,
    application_id: row.application_id,
    ...(row.partner_customer_id !== undefined
      ? { partner_customer_id: row.partner_customer_id }
      : {}),
    ...(row.customer_name !== undefined ? { customer_name: row.customer_name } : {}),
    external_reference: row.external_reference,
    type: row.type,
    asset: row.asset,
    amount: minorToAmount(row.amount_minor, row.asset_decimals),
    fee_amount: minorToAmount(feeMinor, row.asset_decimals),
    net_amount: minorToAmount(
      isWithdrawal ? row.amount_minor - feeMinor : row.amount_minor,
      row.asset_decimals
    ),
    network: row.network,
    destination: row.destination,
    transaction_reference: row.transaction_reference,
    beneficiary_name: row.beneficiary_name,
    beneficiary_address: row.beneficiary_address,
    bank_name: row.bank_name,
    bank_account_number: row.bank_account_number,
    swift_bic: row.swift_bic,
    bank_address: row.bank_address,
    status: row.status,
    settlement_status: row.settlement_status,
    conversion_otc_id: row.conversion_otc_id,
    note: row.note,
    ...(includeOperatorFields ? { operator_note: row.operator_note } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
  };
}

type FundWebhookSnapshotInput = Pick<
  FundRow,
  | 'type'
  | 'asset'
  | 'amount_minor'
  | 'fee_amount_minor'
  | 'asset_decimals'
  | 'network'
  | 'external_reference'
  | 'transaction_reference'
  | 'settlement_status'
>;

function fundTransactionWebhookData(
  input: FundWebhookSnapshotInput,
  overrides: Partial<FundWebhookSnapshotInput> = {}
) {
  const snapshot = { ...input, ...overrides };
  const feeMinor = snapshot.fee_amount_minor || 0;
  const isWithdrawal = isWithdrawalFeeType(snapshot.type);
  return {
    transaction_type: snapshot.type,
    direction: isWithdrawal ? 'withdrawal' : 'deposit',
    asset: snapshot.asset,
    amount: minorToAmount(snapshot.amount_minor, snapshot.asset_decimals),
    fee_amount: minorToAmount(feeMinor, snapshot.asset_decimals),
    net_amount: minorToAmount(
      isWithdrawal ? snapshot.amount_minor - feeMinor : snapshot.amount_minor,
      snapshot.asset_decimals
    ),
    network: snapshot.network || null,
    external_reference: snapshot.external_reference,
    transaction_reference: snapshot.transaction_reference,
    settlement_status: snapshot.settlement_status,
  };
}

async function listFunds(env: Env, url: URL, includeOperatorFields = false) {
  const applicationSelector = await resolveApplicationQuery(env, url, !includeOperatorFields);
  if (applicationSelector instanceof Response) return applicationSelector;
  const applicationId = applicationSelector || '';
  const status = url.searchParams.get('status')?.trim() || '';
  const direction = url.searchParams.get('direction')?.trim() || '';
  const type = url.searchParams.get('type')?.trim() || '';
  const network = url.searchParams.get('network')?.trim().toUpperCase() || '';
  const allowedStatuses = ['submitted', 'processing', 'completed', 'rejected', 'cancelled'];
  const allowedTypes = ['fiat_deposit', 'usdt_deposit', 'usdt_withdrawal', 'fiat_withdrawal'];
  if (status && status !== 'all' && !allowedStatuses.includes(status)) {
    return error(422, 'validation_error', '资金状态无效');
  }
  if (direction && direction !== 'all' && !['deposit', 'withdrawal'].includes(direction)) {
    return error(422, 'validation_error', 'direction 仅支持 deposit 或 withdrawal');
  }
  if (type && type !== 'all' && !allowedTypes.includes(type)) {
    return error(422, 'validation_error', '资金类型无效');
  }
  if (network && network !== 'ALL' && !isSupportedCryptoNetwork(network)) {
    return error(422, 'validation_error', 'network 仅支持 TRON、ETHEREUM、SOLANA 或 BSC');
  }

  const conditions: string[] = [];
  const values: string[] = [];
  if (!includeOperatorFields) {
    conditions.push('a.partner_key=?');
    values.push(PARTNER_KEY);
  }
  if (applicationId) {
    conditions.push('f.application_id=?');
    values.push(applicationId);
  }
  if (status && status !== 'all') {
    conditions.push('f.status=?');
    values.push(status);
  }
  if (direction === 'deposit') {
    conditions.push(`f.type IN ('fiat_deposit','usdt_deposit')`);
  } else if (direction === 'withdrawal') {
    conditions.push(`f.type IN ('fiat_withdrawal','usdt_withdrawal')`);
  }
  if (type && type !== 'all') {
    conditions.push('f.type=?');
    values.push(type);
  }
  if (network && network !== 'ALL') {
    conditions.push(`f.asset='USDT' AND f.network=?`);
    values.push(network);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const statement = env.DB.prepare(`SELECT f.*, a.customer_name, a.partner_customer_id
    FROM fund_transactions f
    JOIN va_applications a ON a.id=f.application_id
    ${where}
    ORDER BY f.created_at DESC
    LIMIT 100`);
  const result = await (values.length ? statement.bind(...values) : statement).all<FundRow>();
  return json({
    data: result.results.map((row) => normalizeFund(row, includeOperatorFields)),
    meta: { count: result.results.length },
  });
}

async function getFundById(env: Env, id: string, includeOperatorFields = false) {
  const row = await env.DB.prepare(
    `SELECT f.*,a.customer_name,a.partner_customer_id
     FROM fund_transactions f
     JOIN va_applications a ON a.id=f.application_id
     WHERE f.id=?${includeOperatorFields ? '' : ' AND a.partner_key=?'}`
  )
    .bind(...(includeOperatorFields ? [id] : [id, PARTNER_KEY]))
    .first<FundRow>();
  return row
    ? json(normalizeFund(row, includeOperatorFields))
    : error(404, 'not_found', '资金记录不存在');
}

type NormalizedFundRequest = {
  application_id: string;
  type: string;
  asset: 'USD' | 'USDT';
  amount_minor: number;
  network: string;
  destination: string | null;
  beneficiary_name: string | null;
  beneficiary_address: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  swift_bic: string | null;
  bank_address: string | null;
  external_reference: string | null;
  note: string | null;
};

function normalizedStoredText(value: string | null | undefined) {
  const normalized = value?.trim() || '';
  return normalized || null;
}

function fundRequestMatches(row: FundRow, normalized: NormalizedFundRequest, fingerprint: string) {
  if (row.request_fingerprint) return row.request_fingerprint === fingerprint;
  return (
    row.application_id === normalized.application_id &&
    row.type === normalized.type &&
    row.asset === normalized.asset &&
    row.amount_minor === normalized.amount_minor &&
    (normalized.asset !== 'USDT' || ledgerNetwork(row.asset, row.network) === normalized.network) &&
    normalizedStoredText(row.destination) === normalized.destination &&
    normalizedStoredText(row.beneficiary_name) === normalized.beneficiary_name &&
    normalizedStoredText(row.beneficiary_address) === normalized.beneficiary_address &&
    normalizedStoredText(row.bank_name) === normalized.bank_name &&
    normalizedStoredText(row.bank_account_number) === normalized.bank_account_number &&
    normalizedStoredText(row.swift_bic)?.toUpperCase() === normalized.swift_bic &&
    normalizedStoredText(row.bank_address) === normalized.bank_address &&
    normalizedStoredText(row.external_reference) === normalized.external_reference &&
    normalizedStoredText(row.note) === normalized.note
  );
}

function idempotencyConflict(existingResourceId: string) {
  return error(409, 'idempotency_conflict', '该 Idempotency-Key 已用于不同的业务请求', {
    existing_resource_id: existingResourceId,
  });
}

async function createFund(env: Env, request: Request, customerInitiated = false) {
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const unknownFields = rejectUnknownFields(parsed, [
    'application_id',
    'type',
    'asset',
    'amount',
    'expected_fee_amount',
    'network',
    'destination',
    'beneficiary_name',
    'beneficiary_address',
    'bank_name',
    'bank_account_number',
    'swift_bic',
    'bank_address',
    'external_reference',
    'note',
  ]);
  if (unknownFields) return unknownFields;
  const applicationId =
    typeof parsed.application_id === 'string' ? parsed.application_id.trim() : '';
  const type = typeof parsed.type === 'string' ? parsed.type.trim() : '';
  const asset = typeof parsed.asset === 'string' ? parsed.asset.trim().toUpperCase() : '';
  const allowed = ['fiat_deposit'];
  if (!applicationId || !allowed.includes(type)) {
    return error(403, 'fund_operation_disabled', '当前业务仅允许管理员录入实际到账的法币转入');
  }
  if (customerInitiated) {
    return error(
      403,
      'operator_only',
      '法币转入只能由管理员按实际到账结果录入；客户资金写操作已关闭'
    );
  }
  const expectedAsset = type.startsWith('fiat_') ? 'USD' : 'USDT';
  if (asset !== expectedAsset) {
    return error(
      422,
      'validation_error',
      type.startsWith('fiat_') ? 'V1 法币交易仅支持 USD' : '数字货币交易仅支持 USDT'
    );
  }
  const network =
    type.startsWith('usdt_') && typeof parsed.network === 'string'
      ? parsed.network.trim().toUpperCase()
      : '';
  if (type.startsWith('usdt_') && !isSupportedCryptoNetwork(network)) {
    return error(422, 'validation_error', 'USDT 交易网络仅支持 TRON、ETHEREUM、SOLANA 或 BSC');
  }
  const destination = normalizeOptionalText(parsed.destination, 'destination', 256);
  if (destination instanceof Response) return destination;
  const beneficiaryName = normalizeOptionalText(parsed.beneficiary_name, 'beneficiary_name', 160);
  if (beneficiaryName instanceof Response) return beneficiaryName;
  const beneficiaryAddress = normalizeOptionalText(
    parsed.beneficiary_address,
    'beneficiary_address',
    500
  );
  if (beneficiaryAddress instanceof Response) return beneficiaryAddress;
  const bankName = normalizeOptionalText(parsed.bank_name, 'bank_name', 200);
  if (bankName instanceof Response) return bankName;
  const bankAccountNumber = normalizeOptionalText(
    parsed.bank_account_number,
    'bank_account_number',
    128
  );
  if (bankAccountNumber instanceof Response) return bankAccountNumber;
  const swiftBicValue = normalizeOptionalText(parsed.swift_bic, 'swift_bic', 32);
  if (swiftBicValue instanceof Response) return swiftBicValue;
  const swiftBic = swiftBicValue?.toUpperCase() || null;
  const bankAddress = normalizeOptionalText(parsed.bank_address, 'bank_address', 500);
  if (bankAddress instanceof Response) return bankAddress;
  const externalReference = normalizeOptionalText(
    parsed.external_reference,
    'external_reference',
    200
  );
  if (externalReference instanceof Response) return externalReference;
  if (['fiat_deposit', 'usdt_deposit'].includes(type) && !externalReference) {
    return error(
      422,
      'external_reference_required',
      type === 'fiat_deposit' ? '法币入账必须录入银行入账参考号' : 'USDT 入账必须录入链上交易哈希'
    );
  }
  const note = normalizeOptionalText(parsed.note, 'note', 1000);
  if (note instanceof Response) return note;

  if (
    type === 'fiat_withdrawal' &&
    (!beneficiaryName || !beneficiaryAddress || !bankName || !bankAccountNumber || !swiftBic)
  ) {
    return error(
      422,
      'validation_error',
      '法币转出需要收款人名称、收款人地址、银行、账号和 SWIFT/BIC'
    );
  }
  if (type === 'usdt_withdrawal' && (!destination || !validCryptoAddress(network, destination))) {
    return error(422, 'validation_error', '数字货币转出需要与所选网络匹配的有效钱包地址');
  }
  const exists = await env.DB.prepare(
    `SELECT id FROM va_applications WHERE id=? AND status='active'`
  )
    .bind(applicationId)
    .first();
  if (!exists) return error(422, 'account_not_active', '客户 VA 账户尚未开通');
  const decimals = defaultDecimals(asset);
  const amountMinor = amountToMinor(parsed.amount, decimals);
  if (amountMinor instanceof Response) return amountMinor;
  const normalizedRequest: NormalizedFundRequest = {
    application_id: applicationId,
    type,
    asset: asset as 'USD' | 'USDT',
    amount_minor: amountMinor,
    network: ledgerNetwork(asset, network),
    destination,
    beneficiary_name: beneficiaryName,
    beneficiary_address: beneficiaryAddress,
    bank_name: bankName,
    bank_account_number: bankAccountNumber,
    swift_bic: swiftBic,
    bank_address: bankAddress,
    external_reference: externalReference,
    note,
  };
  const fingerprint = await requestFingerprint(normalizedRequest);
  const idempotencyKey = resolveIdempotencyKey(request, true);
  if (idempotencyKey instanceof Response) return idempotencyKey;
  const owner = await findIdempotencyOwner(env, idempotencyKey);
  if (owner) {
    return owner.resourceType === 'fund_transaction' &&
      owner.fund &&
      owner.requestFingerprint === fingerprint &&
      fundRequestMatches(owner.fund, normalizedRequest, fingerprint)
      ? json(normalizeFund(owner.fund, !customerInitiated))
      : idempotencyConflict(owner.resourceId);
  }
  if (!customerInitiated && externalReference) {
    const duplicateReference = await env.DB.prepare(
      `SELECT id FROM fund_transactions
       WHERE type=? AND COALESCE(network,'')=?
         AND (
           CASE
             WHEN type='usdt_deposit' AND network='SOLANA'
               THEN trim(external_reference)
             ELSE lower(trim(external_reference))
           END
         ) = (
           CASE
             WHEN ?='usdt_deposit' AND ?='SOLANA'
               THEN trim(?)
             ELSE lower(trim(?))
           END
         )
       LIMIT 1`
    )
      .bind(
        type,
        normalizedRequest.network,
        type,
        normalizedRequest.network,
        externalReference,
        externalReference
      )
      .first<{ id: string }>();
    if (duplicateReference) {
      return error(409, 'duplicate_deposit_reference', '该资产网络和入账参考号已存在资金记录', {
        existing_resource_id: duplicateReference.id,
      });
    }
  }
  let feeMinor = 0;
  if (isWithdrawalFeeType(type)) {
    const feeSetting = await getWithdrawalFee(env, type);
    if (!feeSetting) {
      return error(500, 'fee_configuration_missing', '转出手续费尚未配置');
    }
    if (asset !== feeSetting.asset) {
      return error(
        422,
        'validation_error',
        `${type === 'fiat_withdrawal' ? '法币' : '数字货币'}转出当前仅支持 ${feeSetting.asset}`
      );
    }
    feeMinor = feeSetting.amount_minor;
    if (parsed.expected_fee_amount !== undefined) {
      const expectedFeeMinor = amountToMinor(
        parsed.expected_fee_amount,
        feeSetting.asset_decimals,
        true
      );
      if (expectedFeeMinor instanceof Response) return expectedFeeMinor;
      if (expectedFeeMinor !== feeMinor) {
        return error(409, 'withdrawal_fee_changed', '转出手续费已更新，请刷新手续费后重试', {
          current_fee_amount: minorToAmount(feeMinor, feeSetting.asset_decimals),
          current_fee_updated_at: feeSetting.updated_at,
        });
      }
    }
    if (amountMinor <= feeMinor) {
      return error(422, 'withdrawal_amount_too_low', '转出总扣账金额必须大于手续费', {
        fee_amount: minorToAmount(feeMinor, decimals),
        asset,
      });
    }
  }
  const isWithdrawal = isWithdrawalFeeType(type);
  if (
    isWithdrawal &&
    (await availableBalanceMinor(env, applicationId, asset, normalizedRequest.network)) <
      amountMinor
  ) {
    return error(409, 'insufficient_available_balance', '账本可用余额不足');
  }
  const id = `txn_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date().toISOString();
  try {
    const values = [
      id,
      applicationId,
      externalReference,
      idempotencyKey,
      fingerprint,
      type,
      asset,
      amountMinor,
      feeMinor,
      decimals,
      normalizedRequest.network || null,
      destination,
      beneficiaryName,
      beneficiaryAddress,
      bankName,
      bankAccountNumber,
      swiftBic,
      bankAddress,
      note,
      now,
      now,
    ];
    const insertStatement = isWithdrawal
      ? env.DB.prepare(
          `INSERT INTO fund_transactions
          (id,application_id,external_reference,idempotency_key,request_fingerprint,type,asset,amount_minor,
           fee_amount_minor,asset_decimals,network,destination,beneficiary_name,beneficiary_address,
           bank_name,bank_account_number,
           swift_bic,bank_address,status,note,created_at,updated_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'submitted',?,?,?
          WHERE (
            COALESCE((SELECT SUM(amount_minor) FROM ledger_entries
              WHERE application_id=? AND asset=? AND network=?),0)
            - COALESCE((SELECT SUM(amount_minor) FROM fund_transactions
              WHERE application_id=? AND asset=? AND COALESCE(network,'')=?
                AND type IN ('usdt_withdrawal','fiat_withdrawal')
                AND status IN ('submitted','processing')),0)
            - COALESCE((SELECT SUM(sell_amount_minor) FROM otc_orders
              WHERE application_id=? AND sell_asset=? AND sell_network=?
                AND status IN ('submitted','processing')),0)
          ) >= ?
          AND EXISTS (
            SELECT 1 FROM withdrawal_fee_settings
            WHERE type=? AND amount_minor=? AND asset=?
          )`
        ).bind(
          ...values,
          applicationId,
          asset,
          ledgerNetwork(asset, network),
          applicationId,
          asset,
          ledgerNetwork(asset, network),
          applicationId,
          asset,
          ledgerNetwork(asset, network),
          amountMinor,
          type,
          feeMinor,
          asset
        )
      : env.DB.prepare(
          `INSERT INTO fund_transactions
          (id,application_id,external_reference,idempotency_key,request_fingerprint,type,asset,amount_minor,
           fee_amount_minor,asset_decimals,network,destination,beneficiary_name,beneficiary_address,
           bank_name,bank_account_number,
           swift_bic,bank_address,status,note,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'submitted',?,?,?)`
        ).bind(...values);
    const [result] = await env.DB.batch([
      insertStatement,
      apiRequestKeyStatement(
        env,
        idempotencyKey,
        '/fund-transactions',
        'fund_transaction',
        id,
        fingerprint,
        now
      ),
      webhookOutboxStatement(
        env,
        'fund_transaction.status_changed',
        'fund_transaction',
        id,
        applicationId,
        'submitted',
        now,
        {
          table: 'fund_transactions',
          id,
          status: 'submitted',
          updatedAt: now,
        },
        fundTransactionWebhookData({
          type,
          asset,
          amount_minor: amountMinor,
          fee_amount_minor: feeMinor,
          asset_decimals: decimals,
          network: normalizedRequest.network || null,
          external_reference: externalReference,
          transaction_reference: null,
          settlement_status: 'pending',
        })
      ),
      businessAuditStatement(
        env,
        applicationId,
        'fund_transaction.created',
        auditMetadata(request, customerInitiated ? 'partner' : 'operator', {
          transaction_id: id,
          type,
        }),
        customerInitiated ? 'partner' : 'operator',
        {
          table: 'fund_transactions',
          id,
          status: 'submitted',
          updatedAt: now,
        }
      ),
    ]);
    if (isWithdrawal && result.meta.changes === 0) {
      const concurrent = await findIdempotencyOwner(env, idempotencyKey);
      if (concurrent) {
        return concurrent.resourceType === 'fund_transaction' &&
          concurrent.fund &&
          concurrent.requestFingerprint === fingerprint &&
          fundRequestMatches(concurrent.fund, normalizedRequest, fingerprint)
          ? json(normalizeFund(concurrent.fund, !customerInitiated))
          : idempotencyConflict(concurrent.resourceId);
      }
      const currentFee = await getWithdrawalFee(env, type as WithdrawalFeeType);
      if (!currentFee || currentFee.amount_minor !== feeMinor || currentFee.asset !== asset) {
        return error(
          409,
          'withdrawal_fee_changed',
          '转出手续费已更新，请刷新手续费后重试',
          currentFee
            ? {
                current_fee_amount: minorToAmount(
                  currentFee.amount_minor,
                  currentFee.asset_decimals
                ),
                current_fee_updated_at: currentFee.updated_at,
              }
            : undefined
        );
      }
      return error(409, 'insufficient_available_balance', '账本可用余额不足');
    }
  } catch (caught) {
    const caughtMessage = caught instanceof Error ? caught.message : '';
    if (caughtMessage.includes('duplicate_deposit_reference')) {
      const duplicateReference = await env.DB.prepare(
        `SELECT id FROM fund_transactions
         WHERE type=? AND COALESCE(network,'')=?
           AND (
             CASE
               WHEN type='usdt_deposit' AND network='SOLANA'
                 THEN trim(external_reference)
               ELSE lower(trim(external_reference))
             END
           ) = (
             CASE
               WHEN ?='usdt_deposit' AND ?='SOLANA'
                 THEN trim(?)
               ELSE lower(trim(?))
             END
           )
         LIMIT 1`
      )
        .bind(
          type,
          normalizedRequest.network,
          type,
          normalizedRequest.network,
          externalReference,
          externalReference
        )
        .first<{ id: string }>();
      return error(
        409,
        'duplicate_deposit_reference',
        '该资产网络和入账参考号已存在资金记录',
        duplicateReference ? { existing_resource_id: duplicateReference.id } : undefined
      );
    }
    if (caughtMessage.includes('UNIQUE')) {
      const concurrent = await findIdempotencyOwner(env, idempotencyKey);
      if (!concurrent) throw caught;
      return concurrent.resourceType === 'fund_transaction' &&
        concurrent.fund &&
        concurrent.requestFingerprint === fingerprint &&
        fundRequestMatches(concurrent.fund, normalizedRequest, fingerprint)
        ? json(normalizeFund(concurrent.fund, !customerInitiated), 200)
        : idempotencyConflict(concurrent.resourceId);
    }
    throw caught;
  }
  const row = await env.DB.prepare(`SELECT * FROM fund_transactions WHERE id=?`)
    .bind(id)
    .first<FundRow>();
  return json(normalizeFund(row as FundRow, !customerInitiated), 201);
}

async function balanceMinor(env: Env, applicationId: string, asset: string, network = '') {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount_minor),0) total
    FROM ledger_entries WHERE application_id=? AND asset=? AND network=?`
  )
    .bind(applicationId, asset, ledgerNetwork(asset, network))
    .first<{ total: number }>();
  return row?.total || 0;
}

async function availableBalanceMinor(env: Env, applicationId: string, asset: string, network = '') {
  const bucketNetwork = ledgerNetwork(asset, network);
  const ledger = await balanceMinor(env, applicationId, asset, bucketNetwork);
  const reservedFunds = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount_minor),0) total
    FROM fund_transactions
    WHERE application_id=? AND asset=? AND COALESCE(network,'')=?
      AND type IN ('usdt_withdrawal','fiat_withdrawal')
      AND status IN ('submitted','processing')`
  )
    .bind(applicationId, asset, bucketNetwork)
    .first<{ total: number }>();
  const reservedOtc = await env.DB.prepare(
    `SELECT COALESCE(SUM(sell_amount_minor),0) total
    FROM otc_orders
    WHERE application_id=? AND sell_asset=? AND sell_network=?
      AND status IN ('submitted','processing')`
  )
    .bind(applicationId, asset, bucketNetwork)
    .first<{ total: number }>();
  const reservedSweeps =
    asset === 'USDT' && bucketNetwork === 'TRON'
      ? await env.DB.prepare(
          `SELECT COALESCE(SUM(i.amount_minor),0) total
         FROM usdt_sweep_items i
         JOIN usdt_sweep_batches b ON b.id=i.batch_id
         WHERE i.application_id=? AND b.status IN ('locked','submitted')`
        )
          .bind(applicationId)
          .first<{ total: number }>()
      : null;
  return (
    ledger - (reservedFunds?.total || 0) - (reservedOtc?.total || 0) - (reservedSweeps?.total || 0)
  );
}

type ConversionSettingRow = {
  id: 'usd_usdt_tron';
  exchange_rate: string;
  version: number;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

async function getConversionSetting(env: Env) {
  return env.DB.prepare(
    `SELECT * FROM conversion_settings WHERE id='usd_usdt_tron'`
  ).first<ConversionSettingRow>();
}

async function conversionSettingResponse(env: Env) {
  const [setting, versions] = await Promise.all([
    getConversionSetting(env),
    env.DB.prepare(
      `SELECT exchange_rate,version,changed_by,created_at
       FROM conversion_setting_versions
       WHERE setting_id='usd_usdt_tron'
       ORDER BY version DESC LIMIT 20`
    ).all(),
  ]);
  return json({ data: setting, versions: versions.results });
}

async function updateConversionSetting(env: Env, request: Request) {
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const unknown = rejectUnknownFields(parsed, ['exchange_rate']);
  if (unknown) return unknown;
  const rate = parsePositiveDecimalParts(parsed.exchange_rate);
  if (!rate) {
    return error(422, 'validation_error', 'exchange_rate 必须是正数字符串');
  }
  const current = await getConversionSetting(env);
  if (!current) return error(500, 'conversion_setting_missing', '固定汇率配置不存在');
  if (current.exchange_rate === rate.canonical) {
    return conversionSettingResponse(env);
  }
  const actor = trustedAccessReviewer(request);
  const now = new Date().toISOString();
  const nextVersion = current.version + 1;
  const [updated] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE conversion_settings
       SET exchange_rate=?,version=?,updated_by=?,updated_at=?
       WHERE id='usd_usdt_tron' AND version=?`
    ).bind(rate.canonical, nextVersion, actor, now, current.version),
    env.DB.prepare(
      `INSERT INTO conversion_setting_versions
        (id,setting_id,exchange_rate,version,changed_by,created_at)
       SELECT ?,'usd_usdt_tron',?,?,?,?
       WHERE EXISTS (
         SELECT 1 FROM conversion_settings
         WHERE id='usd_usdt_tron' AND version=? AND exchange_rate=?
       )`
    ).bind(
      `rate_${crypto.randomUUID().replaceAll('-', '')}`,
      rate.canonical,
      nextVersion,
      actor,
      now,
      nextVersion,
      rate.canonical
    ),
    auditInsertStatement(
      env,
      null,
      'conversion_setting.updated',
      {
        setting_id: 'usd_usdt_tron',
        previous_rate: current.exchange_rate,
        exchange_rate: rate.canonical,
        version: nextVersion,
        actor,
      },
      'operator',
      now
    ),
  ]);
  if (updated.meta.changes === 0) {
    return error(409, 'setting_changed', '固定汇率已被其他管理员更新，请刷新后重试');
  }
  return conversionSettingResponse(env);
}

async function settleFiatDeposit(
  env: Env,
  row: FundRow,
  request: Request,
  operatorNote: string | null
) {
  if (row.type !== 'fiat_deposit') {
    return error(422, 'validation_error', '只有法币转入可以执行清算兑换');
  }
  if (row.settlement_status === 'cleared' || row.conversion_otc_id) {
    return error(409, 'already_cleared', '该法币转入已经清算并完成兑换');
  }
  if (!['submitted', 'processing'].includes(row.status)) {
    return error(409, 'invalid_status', '该法币转入当前不能清算');
  }
  const setting = await getConversionSetting(env);
  const rate = setting && parsePositiveDecimalParts(setting.exchange_rate);
  if (!setting || !rate) {
    return error(500, 'conversion_setting_missing', '固定汇率配置无效');
  }
  const buyMinorBig = expectedBuyMinorFromRate(row.amount_minor, row.asset_decimals, 6, rate);
  if (buyMinorBig <= 0n || buyMinorBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    return error(422, 'conversion_amount_out_of_range', '兑换结果超出允许范围');
  }
  const buyMinor = Number(buyMinorBig);
  const now = new Date().toISOString();
  const otcId = `otc_${crypto.randomUUID().replaceAll('-', '')}`;
  const fingerprint = await requestFingerprint({
    source_fund_transaction_id: row.id,
    application_id: row.application_id,
    sell_amount_minor: row.amount_minor,
    exchange_rate: rate.canonical,
    rate_version: setting.version,
    buy_amount_minor: buyMinor,
    buy_network: 'TRON',
  });
  const actor = trustedAccessReviewer(request);
  const idempotencyKey = `auto-fiat-conversion:${row.id}`;
  const eventData = {
    resource_type: 'fund_transaction',
    resource_id: row.id,
    application_id: row.application_id,
    status: 'completed',
    transaction_type: 'fiat_deposit',
    direction: 'deposit',
    external_reference: row.external_reference,
    transaction_reference: row.external_reference,
    settlement_status: 'cleared',
    cleared_at: now,
    fiat_asset: 'USD',
    fiat_amount: minorToAmount(row.amount_minor, 2),
    exchange_rate: rate.canonical,
    exchange_rate_version: setting.version,
    usdt_amount: minorToAmount(buyMinor, 6),
    usdt_net_amount: minorToAmount(buyMinor, 6),
    usdt_network: 'TRON',
    otc_order_id: otcId,
    otc_status: 'completed',
  };
  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO otc_orders
          (id,application_id,idempotency_key,request_fingerprint,
           sell_asset,sell_amount_minor,sell_decimals,sell_network,
           buy_asset,buy_amount_minor,buy_decimals,buy_network,
           exchange_rate,fee_bps,fee_amount_minor,status,note,
           operator_note,settlement_reference,created_at,updated_at,completed_at,
           pricing_model,source_fund_transaction_id,applied_fee_bps)
         SELECT ?,?,?,?,?,?,2,'',?,?,6,'TRON',?,50,0,'completed',
           '法币清算自动兑换',?,?, ?,?,?, 'net_rate',?,0
         WHERE EXISTS (
           SELECT 1 FROM fund_transactions
           WHERE id=? AND type='fiat_deposit'
             AND status IN ('submitted','processing')
             AND settlement_status<>'cleared'
             AND conversion_otc_id IS NULL
         )`
      ).bind(
        otcId,
        row.application_id,
        idempotencyKey,
        fingerprint,
        'USD',
        row.amount_minor,
        'USDT',
        buyMinor,
        rate.canonical,
        operatorNote,
        row.external_reference,
        now,
        now,
        now,
        row.id,
        row.id
      ),
      env.DB.prepare(
        `INSERT INTO ledger_entries
          (id,application_id,source_type,source_id,asset,network,
           amount_minor,asset_decimals,entry_type,created_at)
         SELECT ?,?,'fund_transaction',?,'USD','',?,2,'fiat_deposit',?
         WHERE EXISTS (SELECT 1 FROM otc_orders WHERE id=?)`
      ).bind(crypto.randomUUID(), row.application_id, row.id, row.amount_minor, now, otcId),
      env.DB.prepare(
        `INSERT INTO ledger_entries
          (id,application_id,source_type,source_id,asset,network,
           amount_minor,asset_decimals,entry_type,created_at)
         SELECT ?,?,'adjustment',?,'USD','',?,2,'adjustment_debit',?
         WHERE EXISTS (SELECT 1 FROM otc_orders WHERE id=?)`
      ).bind(crypto.randomUUID(), row.application_id, otcId, -row.amount_minor, now, otcId),
      env.DB.prepare(
        `INSERT INTO ledger_entries
          (id,application_id,source_type,source_id,asset,network,
           amount_minor,asset_decimals,entry_type,created_at)
         SELECT ?,?,'adjustment',?,'USDT','TRON',?,6,'adjustment_credit',?
         WHERE EXISTS (SELECT 1 FROM otc_orders WHERE id=?)`
      ).bind(crypto.randomUUID(), row.application_id, otcId, buyMinor, now, otcId),
      env.DB.prepare(
        `UPDATE fund_transactions
         SET status='completed',settlement_status='cleared',
           conversion_otc_id=?,operator_note=?,transaction_reference=?,
           updated_at=?,completed_at=?
         WHERE id=? AND status IN ('submitted','processing')
           AND settlement_status<>'cleared' AND conversion_otc_id IS NULL
           AND EXISTS (SELECT 1 FROM otc_orders WHERE id=?)`
      ).bind(otcId, operatorNote, row.external_reference, now, now, row.id, otcId),
      customWebhookOutboxStatement(
        env,
        PARTNER_KEY,
        'fiat_deposit.cleared_and_converted',
        'fund_transaction',
        row.id,
        row.application_id,
        'cleared',
        now,
        eventData,
        {
          table: 'fund_transactions',
          id: row.id,
          status: 'completed',
          updatedAt: now,
        }
      ),
      guardedAuditStatement(
        env,
        row.application_id,
        'fiat_deposit.cleared_and_converted',
        {
          ...eventData,
          actor,
        },
        'operator',
        now,
        {
          table: 'fund_transactions',
          id: row.id,
          status: 'completed',
          updatedAt: now,
        }
      ),
    ]);
    if (results[0].meta.changes === 0 || results[4].meta.changes === 0) {
      return error(409, 'already_cleared', '该法币转入已被其他操作清算');
    }
  } catch (caught) {
    const existing = await env.DB.prepare(`SELECT * FROM fund_transactions WHERE id=?`)
      .bind(row.id)
      .first<FundRow>();
    if (existing?.settlement_status === 'cleared' || existing?.conversion_otc_id) {
      return json(normalizeFund(existing, true));
    }
    throw caught;
  }
  const updated = await env.DB.prepare(`SELECT * FROM fund_transactions WHERE id=?`)
    .bind(row.id)
    .first<FundRow>();
  return json({
    ...normalizeFund(updated as FundRow, true),
    conversion: {
      otc_order_id: otcId,
      exchange_rate: rate.canonical,
      exchange_rate_version: setting.version,
      usdt_amount: minorToAmount(buyMinor, 6),
      network: 'TRON',
      fee_rate: '0%',
    },
  });
}

async function updateFund(env: Env, id: string, request: Request) {
  const row = await env.DB.prepare(`SELECT * FROM fund_transactions WHERE id=?`)
    .bind(id)
    .first<FundRow>();
  if (!row) return error(404, 'not_found', '资金申请不存在');
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const unknownFields = rejectUnknownFields(parsed, [
    'status',
    'settlement_status',
    'operator_note',
    'transaction_reference',
  ]);
  if (unknownFields) return unknownFields;
  const hasTransactionReference = Object.prototype.hasOwnProperty.call(
    parsed,
    'transaction_reference'
  );
  const requestedTransactionReference = normalizeOptionalText(
    parsed.transaction_reference,
    'transaction_reference',
    200
  );
  if (requestedTransactionReference instanceof Response) {
    return requestedTransactionReference;
  }
  const hasOperatorNote = Object.prototype.hasOwnProperty.call(parsed, 'operator_note');
  const requestedOperatorNote = normalizeOptionalText(parsed.operator_note, 'operator_note', 1000);
  if (requestedOperatorNote instanceof Response) return requestedOperatorNote;
  const transactionReference = hasTransactionReference
    ? requestedTransactionReference
    : normalizedStoredText(row.transaction_reference);
  const operatorNote = hasOperatorNote
    ? requestedOperatorNote
    : normalizedStoredText(row.operator_note);
  if (Object.prototype.hasOwnProperty.call(parsed, 'settlement_status')) {
    const settlementStatus = String(parsed.settlement_status || '');
    if (!['pending', 'cleared', 'exception'].includes(settlementStatus)) {
      return error(422, 'validation_error', '清算状态仅支持 pending、cleared 或 exception');
    }
    if (row.type !== 'fiat_deposit') {
      return error(422, 'validation_error', '清算状态只适用于法币转入');
    }
    if (settlementStatus === 'cleared') {
      return settleFiatDeposit(env, row, request, operatorNote);
    }
    if (row.settlement_status === 'cleared' || row.conversion_otc_id) {
      return error(409, 'already_cleared', '已清算记录不能改回待清算或调单');
    }
    const now = new Date().toISOString();
    const actor = trustedAccessReviewer(request);
    const [result] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE fund_transactions
         SET settlement_status=?,operator_note=?,updated_at=?
         WHERE id=? AND type='fiat_deposit'
           AND settlement_status<>'cleared' AND conversion_otc_id IS NULL`
      ).bind(settlementStatus, operatorNote, now, id),
      auditInsertStatement(
        env,
        row.application_id,
        `fiat_deposit.settlement_${settlementStatus}`,
        {
          transaction_id: id,
          previous_status: row.settlement_status,
          settlement_status: settlementStatus,
          actor,
        },
        'operator',
        now
      ),
    ]);
    if (result.meta.changes === 0) {
      return error(409, 'invalid_status', '该法币转入已被其他操作处理');
    }
    const updated = await env.DB.prepare(`SELECT * FROM fund_transactions WHERE id=?`)
      .bind(id)
      .first<FundRow>();
    return json(normalizeFund(updated as FundRow, true));
  }
  const next = String(parsed.status || '');
  if (!['processing', 'completed', 'rejected', 'cancelled'].includes(next)) {
    return error(422, 'validation_error', '无效的处理状态');
  }
  if (row.type === 'fiat_deposit' && next === 'completed') {
    return error(
      409,
      'fiat_settlement_required',
      '法币转入必须通过清算状态标记为已清算，不能直接完成'
    );
  }
  if (!['submitted', 'processing'].includes(row.status)) {
    return error(409, 'invalid_status', '该资金申请不能再次处理');
  }
  if (next === row.status) {
    return error(409, 'no_status_change', '资金申请状态没有变化');
  }
  const rowNetwork = ledgerNetwork(row.asset, row.network);
  const validAssetBucket =
    (['fiat_deposit', 'fiat_withdrawal'].includes(row.type) &&
      row.asset === 'USD' &&
      row.asset_decimals === 2 &&
      rowNetwork === '') ||
    (['usdt_deposit', 'usdt_withdrawal'].includes(row.type) &&
      row.asset === 'USDT' &&
      row.asset_decimals === 6 &&
      isSupportedCryptoNetwork(rowNetwork));
  const validWithdrawalDetails =
    row.type !== 'fiat_withdrawal'
      ? row.type !== 'usdt_withdrawal' ||
        Boolean(row.destination && validCryptoAddress(rowNetwork, row.destination))
      : Boolean(
          row.beneficiary_name?.trim() &&
            row.beneficiary_address?.trim() &&
            row.bank_name?.trim() &&
            row.bank_account_number?.trim() &&
            row.swift_bic?.trim()
        );
  const validFeeSnapshot = ['fiat_deposit', 'usdt_deposit'].includes(row.type)
    ? row.fee_amount_minor === 0
    : row.fee_amount_minor >= 0 && row.fee_amount_minor < row.amount_minor;
  const isWithdrawal = isWithdrawalFeeType(row.type);
  const effectiveReference = transactionReference || normalizedStoredText(row.external_reference);
  if (
    next === 'completed' &&
    ((isWithdrawal && !transactionReference) || (!isWithdrawal && !effectiveReference))
  ) {
    return error(
      422,
      'transaction_reference_required',
      isWithdrawal
        ? '完成转出前必须录入银行流水号或链上交易哈希'
        : '完成入账前必须录入银行参考号或链上交易哈希'
    );
  }
  if (
    ['processing', 'completed'].includes(next) &&
    (!row.request_fingerprint ||
      !/^[0-9a-f]{64}$/.test(row.request_fingerprint) ||
      !validAssetBucket ||
      !validWithdrawalDetails ||
      !validFeeSnapshot)
  ) {
    return error(
      409,
      'legacy_integrity_review_required',
      '该历史资金记录不符合当前账务规则，请取消后核对并重新创建'
    );
  }
  const now = new Date().toISOString();
  if (next === 'completed') {
    const isCredit = ['fiat_deposit', 'usdt_deposit'].includes(row.type);
    if (
      !isCredit &&
      (await balanceMinor(
        env,
        row.application_id,
        row.asset,
        ledgerNetwork(row.asset, row.network)
      )) < row.amount_minor
    ) {
      return error(409, 'insufficient_balance', '客户余额不足');
    }
    const signed = isCredit ? row.amount_minor : -row.amount_minor;
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO ledger_entries
        (id,application_id,source_type,source_id,asset,network,amount_minor,asset_decimals,entry_type,created_at)
        SELECT ?,?,'fund_transaction',?,?,?,?,?,?,?
        WHERE EXISTS (
          SELECT 1 FROM fund_transactions
          WHERE id=? AND status IN ('submitted','processing')
        )
        AND (
          ?=1 OR COALESCE((
            SELECT SUM(amount_minor) FROM ledger_entries
            WHERE application_id=? AND asset=? AND network=?
          ),0) >= ?
        )`
      ).bind(
        crypto.randomUUID(),
        row.application_id,
        row.id,
        row.asset,
        rowNetwork,
        signed,
        row.asset_decimals,
        row.type,
        now,
        id,
        isCredit ? 1 : 0,
        row.application_id,
        row.asset,
        rowNetwork,
        row.amount_minor
      ),
      env.DB.prepare(
        `UPDATE fund_transactions SET status='completed',
        transaction_reference=?,operator_note=?,updated_at=?,completed_at=?
        WHERE id=? AND status IN ('submitted','processing')
          AND EXISTS (
            SELECT 1 FROM ledger_entries
            WHERE source_type='fund_transaction' AND source_id=?
              AND asset=? AND entry_type=?
          )`
      ).bind(transactionReference, operatorNote, now, now, id, id, row.asset, row.type),
      webhookOutboxStatement(
        env,
        'fund_transaction.status_changed',
        'fund_transaction',
        id,
        row.application_id,
        next,
        now,
        {
          table: 'fund_transactions',
          id,
          status: next,
          updatedAt: now,
        },
        fundTransactionWebhookData(row, {
          transaction_reference: transactionReference,
        })
      ),
      businessAuditStatement(
        env,
        row.application_id,
        `fund_transaction.${next}`,
        auditMetadata(request, 'operator', { transaction_id: id }),
        'operator',
        {
          table: 'fund_transactions',
          id,
          status: next,
          updatedAt: now,
        }
      ),
    ]);
    if (results[1].meta.changes === 0) {
      if (
        !isCredit &&
        (await balanceMinor(env, row.application_id, row.asset, rowNetwork)) < row.amount_minor
      ) {
        return error(409, 'insufficient_balance', '客户余额不足');
      }
      return error(409, 'invalid_status', '该资金申请已被其他操作处理');
    }
  } else {
    const [result] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE fund_transactions
        SET status=?,transaction_reference=?,operator_note=?,updated_at=?
        WHERE id=? AND status IN ('submitted','processing')`
      ).bind(next, transactionReference, operatorNote, now, id),
      webhookOutboxStatement(
        env,
        'fund_transaction.status_changed',
        'fund_transaction',
        id,
        row.application_id,
        next,
        now,
        {
          table: 'fund_transactions',
          id,
          status: next,
          updatedAt: now,
        },
        fundTransactionWebhookData(row, {
          transaction_reference: transactionReference,
        })
      ),
      businessAuditStatement(
        env,
        row.application_id,
        `fund_transaction.${next}`,
        auditMetadata(request, 'operator', { transaction_id: id }),
        'operator',
        {
          table: 'fund_transactions',
          id,
          status: next,
          updatedAt: now,
        }
      ),
    ]);
    if (result.meta.changes === 0) {
      return error(409, 'invalid_status', '该资金申请已被其他操作处理');
    }
  }
  const updated = await env.DB.prepare(`SELECT * FROM fund_transactions WHERE id=?`)
    .bind(id)
    .first<FundRow>();
  return json(normalizeFund(updated as FundRow, true));
}

type OtcRow = {
  id: string;
  application_id: string;
  request_fingerprint: string | null;
  sell_asset: string;
  sell_amount_minor: number;
  sell_decimals: number;
  sell_network: string;
  buy_asset: string;
  buy_amount_minor: number;
  buy_decimals: number;
  buy_network: string;
  exchange_rate: string;
  fee_bps: number;
  fee_amount_minor: number;
  status: string;
  note: string | null;
  operator_note: string | null;
  settlement_reference: string | null;
  pricing_model?: 'standard_fee' | 'net_rate';
  source_fund_transaction_id?: string | null;
  applied_fee_bps?: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  customer_name?: string;
  partner_customer_id?: string | null;
};

type IdempotencyResourceType = 'fund_transaction' | 'otc_order';

type IdempotencyOwner = {
  requestPath: string;
  resourceType: IdempotencyResourceType | 'ambiguous' | 'unknown';
  resourceId: string;
  requestFingerprint: string | null;
  fund: FundRow | null;
  otc: OtcRow | null;
};

function parseIdempotencyRegistryPayload(value: string): {
  resourceType: IdempotencyResourceType;
  resourceId: string;
  requestFingerprint: string;
} | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return null;
    const resourceType = parsed.resource_type;
    const resourceId = parsed.resource_id;
    const requestFingerprint = parsed.request_fingerprint;
    if (
      (resourceType !== 'fund_transaction' && resourceType !== 'otc_order') ||
      typeof resourceId !== 'string' ||
      typeof requestFingerprint !== 'string'
    ) {
      return null;
    }
    return {
      resourceType,
      resourceId,
      requestFingerprint,
    };
  } catch {
    return null;
  }
}

async function findIdempotencyOwner(
  env: Env,
  idempotencyKey: string
): Promise<IdempotencyOwner | null> {
  const registry = await env.DB.prepare(
    `SELECT request_path,response_json FROM api_request_keys
     WHERE idempotency_key=?`
  )
    .bind(idempotencyKey)
    .first<{ request_path: string; response_json: string }>();
  if (registry) {
    const payload = parseIdempotencyRegistryPayload(registry.response_json);
    if (!payload) {
      return {
        requestPath: registry.request_path,
        resourceType: 'unknown',
        resourceId: 'unknown',
        requestFingerprint: null,
        fund: null,
        otc: null,
      };
    }
    const [fund, otc] = await Promise.all([
      payload.resourceType === 'fund_transaction'
        ? env.DB.prepare(`SELECT * FROM fund_transactions WHERE id=?`)
            .bind(payload.resourceId)
            .first<FundRow>()
        : Promise.resolve(null),
      payload.resourceType === 'otc_order'
        ? env.DB.prepare(`SELECT * FROM otc_orders WHERE id=?`)
            .bind(payload.resourceId)
            .first<OtcRow>()
        : Promise.resolve(null),
    ]);
    return {
      requestPath: registry.request_path,
      resourceType: payload.resourceType,
      resourceId: payload.resourceId,
      requestFingerprint: payload.requestFingerprint,
      fund,
      otc,
    };
  }

  const [fund, otc] = await Promise.all([
    env.DB.prepare(`SELECT * FROM fund_transactions WHERE idempotency_key=?`)
      .bind(idempotencyKey)
      .first<FundRow>(),
    env.DB.prepare(`SELECT * FROM otc_orders WHERE idempotency_key=?`)
      .bind(idempotencyKey)
      .first<OtcRow>(),
  ]);
  if (!fund && !otc) return null;
  if (fund && otc) {
    return {
      requestPath: '',
      resourceType: 'ambiguous',
      resourceId: fund.id,
      requestFingerprint: null,
      fund,
      otc,
    };
  }
  return fund
    ? {
        requestPath: '/fund-transactions',
        resourceType: 'fund_transaction',
        resourceId: fund.id,
        requestFingerprint: fund.request_fingerprint,
        fund,
        otc: null,
      }
    : {
        requestPath: '/otc-orders',
        resourceType: 'otc_order',
        resourceId: (otc as OtcRow).id,
        requestFingerprint: (otc as OtcRow).request_fingerprint,
        fund: null,
        otc: otc as OtcRow,
      };
}

function apiRequestKeyStatement(
  env: Env,
  idempotencyKey: string,
  requestPath: '/fund-transactions' | '/otc-orders',
  resourceType: IdempotencyResourceType,
  resourceId: string,
  requestFingerprint: string,
  createdAt: string
) {
  const table = resourceType === 'fund_transaction' ? 'fund_transactions' : 'otc_orders';
  return env.DB.prepare(
    `INSERT INTO api_request_keys
      (idempotency_key,request_path,response_status,response_json,created_at)
     SELECT ?,?,201,?,?
     WHERE EXISTS (
       SELECT 1 FROM ${table}
       WHERE id=? AND request_fingerprint=?
     )`
  ).bind(
    idempotencyKey,
    requestPath,
    JSON.stringify({
      resource_type: resourceType,
      resource_id: resourceId,
      request_fingerprint: requestFingerprint,
    }),
    createdAt,
    resourceId,
    requestFingerprint
  );
}

function normalizeOtc(row: OtcRow, includeOperatorFields = false) {
  const isNetRate = row.pricing_model === 'net_rate';
  return {
    id: row.id,
    application_id: row.application_id,
    ...(row.partner_customer_id !== undefined
      ? { partner_customer_id: row.partner_customer_id }
      : {}),
    ...(row.customer_name !== undefined ? { customer_name: row.customer_name } : {}),
    sell_asset: row.sell_asset,
    sell_network: row.sell_network || null,
    sell_amount: minorToAmount(row.sell_amount_minor, row.sell_decimals),
    buy_asset: row.buy_asset,
    buy_network: row.buy_network || null,
    buy_amount: minorToAmount(row.buy_amount_minor, row.buy_decimals),
    exchange_rate: row.exchange_rate,
    fee_amount: minorToAmount(isNetRate ? 0 : row.fee_amount_minor, row.buy_decimals),
    net_buy_amount: minorToAmount(
      row.buy_amount_minor - (isNetRate ? 0 : row.fee_amount_minor),
      row.buy_decimals
    ),
    fee_rate: isNetRate ? '0%' : '0.5%',
    fee_bps: row.applied_fee_bps ?? (isNetRate ? 0 : 50),
    pricing_model: row.pricing_model || 'standard_fee',
    source_fund_transaction_id: row.source_fund_transaction_id || null,
    status: row.status,
    note: row.note,
    ...(includeOperatorFields
      ? {
          operator_note: row.operator_note,
          settlement_reference: row.settlement_reference,
        }
      : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
  };
}

type PositiveDecimal = {
  canonical: string;
  numerator: bigint;
  scale: number;
};

function parsePositiveDecimalParts(value: unknown): PositiveDecimal | null {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!input || input.length > 64 || !/^\d+(\.\d+)?$/.test(input)) return null;
  let [whole, fraction = ''] = input.split('.');
  whole = whole.replace(/^0+(?=\d)/, '');
  fraction = fraction.replace(/0+$/, '');
  const canonical = fraction ? `${whole}.${fraction}` : whole;
  const numerator = BigInt(`${whole}${fraction}` || '0');
  if (numerator <= 0n) return null;
  return { canonical, numerator, scale: fraction.length };
}

function expectedBuyMinorFromRate(
  sellMinor: number,
  sellDecimals: number,
  buyDecimals: number,
  rate: PositiveDecimal
) {
  const numerator = BigInt(sellMinor) * rate.numerator * 10n ** BigInt(buyDecimals);
  const denominator = 10n ** BigInt(sellDecimals + rate.scale);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  return rounded;
}

function otcFeeMinorFromBuyAmount(buyMinor: number) {
  return Number((BigInt(buyMinor) * 50n + 5000n) / 10000n);
}

type NormalizedOtcRequest = {
  application_id: string;
  sell_asset: 'USD' | 'USDT';
  sell_amount_minor: number;
  sell_network: string;
  buy_asset: 'USD' | 'USDT';
  buy_amount_minor: number;
  buy_network: string;
  exchange_rate: string;
  note: string | null;
};

function otcRequestMatches(row: OtcRow, normalized: NormalizedOtcRequest, fingerprint: string) {
  if (row.request_fingerprint) return row.request_fingerprint === fingerprint;
  const storedRate = parsePositiveDecimalParts(row.exchange_rate);
  return (
    row.application_id === normalized.application_id &&
    row.sell_asset === normalized.sell_asset &&
    row.sell_amount_minor === normalized.sell_amount_minor &&
    ledgerNetwork(row.sell_asset, row.sell_network) === normalized.sell_network &&
    row.buy_asset === normalized.buy_asset &&
    row.buy_amount_minor === normalized.buy_amount_minor &&
    ledgerNetwork(row.buy_asset, row.buy_network) === normalized.buy_network &&
    storedRate?.canonical === normalized.exchange_rate &&
    normalizedStoredText(row.note) === normalized.note
  );
}

async function listOtc(env: Env, url: URL, includeOperatorFields = false) {
  const applicationSelector = await resolveApplicationQuery(env, url, !includeOperatorFields);
  if (applicationSelector instanceof Response) return applicationSelector;
  const applicationId = applicationSelector || '';
  const status = url.searchParams.get('status')?.trim() || '';
  const network = url.searchParams.get('network')?.trim().toUpperCase() || '';
  const allowedStatuses = ['submitted', 'processing', 'completed', 'rejected', 'cancelled'];
  if (status && status !== 'all' && !allowedStatuses.includes(status)) {
    return error(422, 'validation_error', 'OTC 状态无效');
  }
  if (network && network !== 'ALL' && !isSupportedCryptoNetwork(network)) {
    return error(422, 'validation_error', 'network 仅支持 TRON、ETHEREUM、SOLANA 或 BSC');
  }
  const conditions: string[] = [];
  const values: string[] = [];
  if (!includeOperatorFields) {
    conditions.push('a.partner_key=?');
    values.push(PARTNER_KEY);
  }
  if (applicationId) {
    conditions.push('o.application_id=?');
    values.push(applicationId);
  }
  if (status && status !== 'all') {
    conditions.push('o.status=?');
    values.push(status);
  }
  if (network && network !== 'ALL') {
    conditions.push('(o.sell_network=? OR o.buy_network=?)');
    values.push(network, network);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const statement = env.DB.prepare(`SELECT o.*,a.customer_name,a.partner_customer_id
    FROM otc_orders o
    JOIN va_applications a ON a.id=o.application_id
    ${where}
    ORDER BY o.created_at DESC
    LIMIT 100`);
  const result = await (values.length ? statement.bind(...values) : statement).all<OtcRow>();
  return json({
    data: result.results.map((row) => normalizeOtc(row, includeOperatorFields)),
    meta: { count: result.results.length },
  });
}

async function getOtcById(env: Env, id: string, includeOperatorFields = false) {
  const row = await env.DB.prepare(
    `SELECT o.*,a.customer_name,a.partner_customer_id
     FROM otc_orders o
     JOIN va_applications a ON a.id=o.application_id
     WHERE o.id=?${includeOperatorFields ? '' : ' AND a.partner_key=?'}`
  )
    .bind(...(includeOperatorFields ? [id] : [id, PARTNER_KEY]))
    .first<OtcRow>();
  return row
    ? json(normalizeOtc(row, includeOperatorFields))
    : error(404, 'not_found', 'OTC 订单不存在');
}

function validDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

type ReconciliationAmountRow = {
  asset: string;
  network: string;
  asset_decimals: number;
  amount_minor: number;
  count: number;
};

type ReconciliationOtcRow = {
  sell_asset: string;
  sell_network: string;
  sell_decimals: number;
  sell_amount_minor: number;
  buy_asset: string;
  buy_network: string;
  buy_decimals: number;
  buy_amount_minor: number;
  count: number;
};

type ReconciliationLedgerRow = {
  asset: string;
  network: string;
  asset_decimals: number;
  opening_minor: number;
  credit_minor: number;
  debit_minor: number;
  closing_minor: number;
};

type ReconciliationExceptionRow = {
  pending_settlement: number;
  settlement_exception: number;
};

type ReconciliationSweepStateRow = {
  status: string;
  amount_minor: number;
  count: number;
};

type ReconciliationTrendRow = {
  day: string;
  asset: string;
  network: string;
  asset_decimals: number;
  credit_minor: number;
  debit_minor: number;
};

function shanghaiDateToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function reconciliationWindow(date: string) {
  const start = new Date(`${date}T00:00:00+08:00`);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

async function getReconciliationSummary(env: Env, url: URL, includeOperatorFields = false) {
  const date = url.searchParams.get('date') || shanghaiDateToday();
  if (!validDateOnly(date)) {
    return error(422, 'validation_error', 'date 必须是 YYYY-MM-DD 格式的有效日期');
  }
  const { start, end } = reconciliationWindow(date);
  const now = new Date();
  const isCurrentDay = date === shanghaiDateToday();
  const currentEnd = isCurrentDay && now.toISOString() < end ? now.toISOString() : end;
  const startMs = new Date(start).getTime();
  const currentDuration = new Date(currentEnd).getTime() - startMs;
  const comparisonStart = new Date(startMs - 24 * 60 * 60 * 1000).toISOString();
  const comparisonEnd = new Date(
    new Date(comparisonStart).getTime() + currentDuration
  ).toISOString();
  const trendStart = new Date(startMs - 6 * 24 * 60 * 60 * 1000).toISOString();
  const applicationScope = includeOperatorFields ? '' : ' AND a.partner_key=?';
  const applicationBindings = includeOperatorFields ? [] : [PARTNER_KEY];
  const sweepScope = includeOperatorFields ? '' : ' AND b.partner_key=?';
  const sweepBindings = includeOperatorFields ? [] : [PARTNER_KEY];

  const [
    depositResult,
    otcResult,
    sweepResult,
    sweepStateResult,
    exceptionRow,
    ledgerResult,
    balanceRows,
    comparisonDepositResult,
    comparisonOtcResult,
    comparisonSweepResult,
    trendResult,
  ] = await Promise.all([
    env.DB.prepare(
      `SELECT f.asset,COALESCE(f.network,'') network,f.asset_decimals,
          COALESCE(SUM(f.amount_minor),0) amount_minor,COUNT(*) count
         FROM fund_transactions f
         JOIN va_applications a ON a.id=f.application_id
         WHERE f.type IN ('fiat_deposit','usdt_deposit')
           AND f.status='completed'
           AND (f.type!='fiat_deposit' OR f.settlement_status='cleared')
           AND f.completed_at>=? AND f.completed_at<?${applicationScope}
         GROUP BY f.asset,COALESCE(f.network,''),f.asset_decimals
         ORDER BY f.asset,network`
    )
      .bind(start, currentEnd, ...applicationBindings)
      .all<ReconciliationAmountRow>(),
    env.DB.prepare(
      `SELECT o.sell_asset,COALESCE(o.sell_network,'') sell_network,o.sell_decimals,
          COALESCE(SUM(o.sell_amount_minor),0) sell_amount_minor,
          o.buy_asset,COALESCE(o.buy_network,'') buy_network,o.buy_decimals,
          COALESCE(SUM(o.buy_amount_minor),0) buy_amount_minor,COUNT(*) count
         FROM otc_orders o
         JOIN va_applications a ON a.id=o.application_id
         WHERE o.status='completed' AND o.completed_at>=? AND o.completed_at<?${applicationScope}
         GROUP BY o.sell_asset,COALESCE(o.sell_network,''),o.sell_decimals,
           o.buy_asset,COALESCE(o.buy_network,''),o.buy_decimals
         ORDER BY o.sell_asset,o.buy_asset`
    )
      .bind(start, currentEnd, ...applicationBindings)
      .all<ReconciliationOtcRow>(),
    env.DB.prepare(
      `SELECT 'USDT' asset,COALESCE(b.network,'') network,b.asset_decimals,
          COALESCE(SUM(b.total_amount_minor),0) amount_minor,COUNT(*) count
         FROM usdt_sweep_batches b
         WHERE b.status='completed' AND b.completed_at>=? AND b.completed_at<?${sweepScope}
         GROUP BY COALESCE(b.network,''),b.asset_decimals
         ORDER BY network`
    )
      .bind(start, currentEnd, ...sweepBindings)
      .all<ReconciliationAmountRow>(),
    env.DB.prepare(
      `SELECT b.status,COALESCE(SUM(b.total_amount_minor),0) amount_minor,COUNT(*) count
         FROM usdt_sweep_batches b
         WHERE b.status IN ('locked','submitted')${sweepScope}
         GROUP BY b.status`
    )
      .bind(...sweepBindings)
      .all<ReconciliationSweepStateRow>(),
    env.DB.prepare(
      `SELECT
          COALESCE(SUM(CASE WHEN f.settlement_status='pending' AND f.status IN ('submitted','processing') THEN 1 ELSE 0 END),0) pending_settlement,
          COALESCE(SUM(CASE WHEN f.settlement_status='exception' THEN 1 ELSE 0 END),0) settlement_exception
         FROM fund_transactions f
         JOIN va_applications a ON a.id=f.application_id
         WHERE f.type='fiat_deposit'${applicationScope}`
    )
      .bind(...applicationBindings)
      .first<ReconciliationExceptionRow>(),
    env.DB.prepare(
      `SELECT l.asset,COALESCE(l.network,'') network,l.asset_decimals,
          COALESCE(SUM(CASE WHEN l.created_at<? THEN l.amount_minor ELSE 0 END),0) opening_minor,
          COALESCE(SUM(CASE WHEN l.created_at>=? AND l.created_at<? AND l.amount_minor>0 THEN l.amount_minor ELSE 0 END),0) credit_minor,
          COALESCE(SUM(CASE WHEN l.created_at>=? AND l.created_at<? AND l.amount_minor<0 THEN -l.amount_minor ELSE 0 END),0) debit_minor,
          COALESCE(SUM(CASE WHEN l.created_at<? THEN l.amount_minor ELSE 0 END),0) closing_minor
         FROM ledger_entries l
         JOIN va_applications a ON a.id=l.application_id
         WHERE l.created_at<?${applicationScope}
         GROUP BY l.asset,COALESCE(l.network,''),l.asset_decimals
         ORDER BY l.asset,network`
    )
      .bind(
        start,
        start,
        currentEnd,
        start,
        currentEnd,
        currentEnd,
        currentEnd,
        ...applicationBindings
      )
      .all<ReconciliationLedgerRow>(),
    getBalanceRows(env, undefined, !includeOperatorFields),
    env.DB.prepare(
      `SELECT f.asset,COALESCE(f.network,'') network,f.asset_decimals,
          COALESCE(SUM(f.amount_minor),0) amount_minor,COUNT(*) count
         FROM fund_transactions f
         JOIN va_applications a ON a.id=f.application_id
         WHERE f.type IN ('fiat_deposit','usdt_deposit')
           AND f.status='completed'
           AND (f.type!='fiat_deposit' OR f.settlement_status='cleared')
           AND f.completed_at>=? AND f.completed_at<?${applicationScope}
         GROUP BY f.asset,COALESCE(f.network,''),f.asset_decimals
         ORDER BY f.asset,network`
    )
      .bind(comparisonStart, comparisonEnd, ...applicationBindings)
      .all<ReconciliationAmountRow>(),
    env.DB.prepare(
      `SELECT o.sell_asset,COALESCE(o.sell_network,'') sell_network,o.sell_decimals,
          COALESCE(SUM(o.sell_amount_minor),0) sell_amount_minor,
          o.buy_asset,COALESCE(o.buy_network,'') buy_network,o.buy_decimals,
          COALESCE(SUM(o.buy_amount_minor),0) buy_amount_minor,COUNT(*) count
         FROM otc_orders o
         JOIN va_applications a ON a.id=o.application_id
         WHERE o.status='completed' AND o.completed_at>=? AND o.completed_at<?${applicationScope}
         GROUP BY o.sell_asset,COALESCE(o.sell_network,''),o.sell_decimals,
           o.buy_asset,COALESCE(o.buy_network,''),o.buy_decimals
         ORDER BY o.sell_asset,o.buy_asset`
    )
      .bind(comparisonStart, comparisonEnd, ...applicationBindings)
      .all<ReconciliationOtcRow>(),
    env.DB.prepare(
      `SELECT 'USDT' asset,COALESCE(b.network,'') network,b.asset_decimals,
          COALESCE(SUM(b.total_amount_minor),0) amount_minor,COUNT(*) count
         FROM usdt_sweep_batches b
         WHERE b.status='completed' AND b.completed_at>=? AND b.completed_at<?${sweepScope}
         GROUP BY COALESCE(b.network,''),b.asset_decimals
         ORDER BY network`
    )
      .bind(comparisonStart, comparisonEnd, ...sweepBindings)
      .all<ReconciliationAmountRow>(),
    env.DB.prepare(
      `SELECT date(l.created_at,'+8 hours') day,l.asset,COALESCE(l.network,'') network,
          l.asset_decimals,
          COALESCE(SUM(CASE WHEN l.amount_minor>0 THEN l.amount_minor ELSE 0 END),0) credit_minor,
          COALESCE(SUM(CASE WHEN l.amount_minor<0 THEN -l.amount_minor ELSE 0 END),0) debit_minor
         FROM ledger_entries l
         JOIN va_applications a ON a.id=l.application_id
         WHERE l.created_at>=? AND l.created_at<?${applicationScope}
         GROUP BY date(l.created_at,'+8 hours'),l.asset,COALESCE(l.network,''),l.asset_decimals
         ORDER BY day,l.asset,network`
    )
      .bind(trendStart, currentEnd, ...applicationBindings)
      .all<ReconciliationTrendRow>(),
  ]);

  const balances = new Map<
    string,
    { asset: string; network: string; asset_decimals: number; ledger: number; reserved: number }
  >();
  balanceRows.forEach((row) => {
    const key = `${row.asset}:${row.network}:${row.asset_decimals}`;
    const current = balances.get(key) || {
      asset: row.asset,
      network: row.network,
      asset_decimals: row.asset_decimals,
      ledger: 0,
      reserved: 0,
    };
    current.ledger += row.ledger_minor;
    current.reserved += row.reserved_funds + row.reserved_otc + row.reserved_sweeps;
    balances.set(key, current);
  });

  return json({
    data: {
      date,
      timezone: 'Asia/Shanghai',
      as_of: new Date().toISOString(),
      window: { start, end: currentEnd },
      comparison: {
        type: 'previous_day',
        window: { start: comparisonStart, end: comparisonEnd },
        deposits: comparisonDepositResult.results.map((row) => ({
          ...row,
          network: row.network || null,
          amount: minorToAmount(row.amount_minor, row.asset_decimals),
        })),
        otc: comparisonOtcResult.results.map((row) => ({
          ...row,
          sell_network: row.sell_network || null,
          buy_network: row.buy_network || null,
          sell_amount: minorToAmount(row.sell_amount_minor, row.sell_decimals),
          buy_amount: minorToAmount(row.buy_amount_minor, row.buy_decimals),
        })),
        sweeps: comparisonSweepResult.results.map((row) => ({
          ...row,
          network: row.network || null,
          amount: minorToAmount(row.amount_minor, row.asset_decimals),
        })),
      },
      trend: trendResult.results.map((row) => ({
        day: row.day,
        asset: row.asset,
        network: row.network || null,
        asset_decimals: row.asset_decimals,
        credits: minorToAmount(row.credit_minor, row.asset_decimals),
        debits: minorToAmount(row.debit_minor, row.asset_decimals),
        net: minorToAmount(row.credit_minor - row.debit_minor, row.asset_decimals),
      })),
      deposits: depositResult.results.map((row) => ({
        ...row,
        network: row.network || null,
        amount: minorToAmount(row.amount_minor, row.asset_decimals),
      })),
      otc: otcResult.results.map((row) => ({
        ...row,
        sell_network: row.sell_network || null,
        buy_network: row.buy_network || null,
        sell_amount: minorToAmount(row.sell_amount_minor, row.sell_decimals),
        buy_amount: minorToAmount(row.buy_amount_minor, row.buy_decimals),
      })),
      sweeps: sweepResult.results.map((row) => ({
        ...row,
        network: row.network || null,
        amount: minorToAmount(row.amount_minor, row.asset_decimals),
      })),
      sweep_pending: sweepStateResult.results.map((row) => ({
        status: row.status,
        count: row.count,
        amount: minorToAmount(row.amount_minor, 6),
      })),
      exceptions: {
        pending_settlement: Number(exceptionRow?.pending_settlement || 0),
        settlement_exception: Number(exceptionRow?.settlement_exception || 0),
        sweep_pending: sweepStateResult.results.reduce((sum, row) => sum + Number(row.count), 0),
      },
      balances: Array.from(balances.values()).map((row) => ({
        asset: row.asset,
        network: row.network || null,
        asset_decimals: row.asset_decimals,
        ledger_balance: minorToAmount(row.ledger, row.asset_decimals),
        reserved: minorToAmount(row.reserved, row.asset_decimals),
        available_balance: minorToAmount(row.ledger - row.reserved, row.asset_decimals),
      })),
      reconciliation: ledgerResult.results.map((row) => {
        const expectedMinor = row.opening_minor + row.credit_minor - row.debit_minor;
        return {
          asset: row.asset,
          network: row.network || null,
          asset_decimals: row.asset_decimals,
          opening_balance: minorToAmount(row.opening_minor, row.asset_decimals),
          credits: minorToAmount(row.credit_minor, row.asset_decimals),
          debits: minorToAmount(row.debit_minor, row.asset_decimals),
          expected_closing: minorToAmount(expectedMinor, row.asset_decimals),
          closing_balance: minorToAmount(row.closing_minor, row.asset_decimals),
          delta: minorToAmount(row.closing_minor - expectedMinor, row.asset_decimals),
        };
      }),
    },
  });
}

type ConversionDebitHistoryRow = {
  id: string;
  application_id: string;
  amount_minor: number;
  asset_decimals: number;
  created_at: string;
  otc_order_id: string;
  source_fund_transaction_id: string;
  external_reference: string | null;
  transaction_reference: string | null;
  note: string | null;
  operator_note: string | null;
  updated_at: string;
  completed_at: string | null;
  customer_name: string;
  partner_customer_id: string | null;
};

type ConversionCreditHistoryRow = ConversionDebitHistoryRow & {
  asset: string;
  network: string;
};

type SweepHistoryRow = {
  id: string;
  application_id: string;
  amount_minor: number;
  asset_decimals: number;
  created_at: string;
  sweep_batch_id: string;
  tx_hash: string;
  updated_at: string;
  completed_at: string;
  customer_name: string;
  partner_customer_id: string | null;
};

async function listTransactions(env: Env, url: URL, includeOperatorFields = false) {
  const applicationSelector = await resolveApplicationQuery(env, url, !includeOperatorFields);
  if (applicationSelector instanceof Response) return applicationSelector;
  const applicationId = applicationSelector;
  const category = url.searchParams.get('category') || 'all';
  const transactionType = url.searchParams.get('type') || 'all';
  const status = url.searchParams.get('status') || 'all';
  const wallet = url.searchParams.get('wallet') || 'all';
  const network = (url.searchParams.get('network') || 'all').trim().toUpperCase();
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');
  const datetimeFrom = url.searchParams.get('datetime_from');
  const datetimeTo = url.searchParams.get('datetime_to');
  const pageValue = url.searchParams.get('page') || '1';
  const limitValue = url.searchParams.get('limit') || '200';
  if (!['all', 'fund', 'otc'].includes(category)) {
    return error(422, 'validation_error', 'category 仅支持 all、fund 或 otc');
  }
  const directFundTypes = ['fiat_deposit', 'usdt_deposit', 'fiat_withdrawal', 'usdt_withdrawal'];
  const transactionTypes = [
    'all',
    ...directFundTypes,
    'fiat_conversion_debit',
    'crypto_conversion_credit',
    'usdt_sweep',
    'otc',
  ];
  if (!transactionTypes.includes(transactionType)) {
    return error(422, 'validation_error', '交易类型无效');
  }
  if (!['all', 'submitted', 'processing', 'completed', 'rejected', 'cancelled'].includes(status)) {
    return error(422, 'validation_error', '交易状态无效');
  }
  if (!['all', 'fiat', 'crypto'].includes(wallet)) {
    return error(422, 'validation_error', 'wallet 仅支持 all、fiat 或 crypto');
  }
  if (network !== 'ALL' && !isSupportedCryptoNetwork(network)) {
    return error(422, 'validation_error', 'network 仅支持 all、TRON、ETHEREUM、SOLANA 或 BSC');
  }
  if ((dateFrom && !validDateOnly(dateFrom)) || (dateTo && !validDateOnly(dateTo))) {
    return error(422, 'validation_error', '日期必须是有效的 YYYY-MM-DD 日期');
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return error(422, 'validation_error', 'date_from 不能晚于 date_to');
  }
  if (!/^[1-9]\d*$/.test(pageValue) || !/^[1-9]\d*$/.test(limitValue)) {
    return error(422, 'validation_error', 'page 和 limit 必须是正整数');
  }
  const page = Number(pageValue);
  const limit = Number(limitValue);
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit) || limit > 200) {
    return error(422, 'validation_error', 'page 超出范围，limit 最大为 200');
  }
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) {
    return error(422, 'validation_error', '分页范围过大');
  }

  const fundConditions: string[] = [];
  const fundValues: Array<string | number> = [];
  const otcConditions: string[] = [];
  const otcValues: Array<string | number> = [];
  const conversionDebitConditions = [
    `l.source_type='adjustment'`,
    `l.entry_type='adjustment_debit'`,
    `l.asset='USD'`,
    `l.network=''`,
    `l.amount_minor<0`,
    `o.pricing_model='net_rate'`,
    `o.status='completed'`,
    `o.source_fund_transaction_id IS NOT NULL`,
    `f.conversion_otc_id=o.id`,
    `f.status='completed'`,
    `f.settlement_status='cleared'`,
  ];
  const conversionDebitValues: Array<string | number> = [];
  const conversionCreditConditions = [
    `l.source_type='adjustment'`,
    `l.entry_type='adjustment_credit'`,
    `l.asset='USDT'`,
    `l.amount_minor>0`,
    `o.pricing_model='net_rate'`,
    `o.status='completed'`,
    `o.source_fund_transaction_id IS NOT NULL`,
    `f.conversion_otc_id=o.id`,
    `f.status='completed'`,
    `f.settlement_status='cleared'`,
  ];
  const conversionCreditValues: Array<string | number> = [];
  const sweepConditions = [
    `l.source_type='adjustment'`,
    `l.entry_type='adjustment_debit'`,
    `l.asset='USDT'`,
    `l.network='TRON'`,
    `l.amount_minor<0`,
    `l.source_id=si.id`,
    `b.status='completed'`,
    `b.tx_hash IS NOT NULL`,
    `b.completed_at IS NOT NULL`,
    `si.ledger_entry_id=l.id`,
  ];
  const sweepValues: Array<string | number> = [];
  if (!includeOperatorFields) {
    fundConditions.push(`EXISTS (
      SELECT 1 FROM va_applications fa
      WHERE fa.id=f.application_id AND fa.partner_key=?
    )`);
    fundValues.push(PARTNER_KEY);
    otcConditions.push(`EXISTS (
      SELECT 1 FROM va_applications oa
      WHERE oa.id=o.application_id AND oa.partner_key=?
    )`);
    otcValues.push(PARTNER_KEY);
    conversionDebitConditions.push(`EXISTS (
      SELECT 1 FROM va_applications ca
      WHERE ca.id=l.application_id AND ca.partner_key=?
    )`);
    conversionDebitValues.push(PARTNER_KEY);
    conversionCreditConditions.push(`EXISTS (
      SELECT 1 FROM va_applications ca
      WHERE ca.id=l.application_id AND ca.partner_key=?
    )`);
    conversionCreditValues.push(PARTNER_KEY);
    sweepConditions.push('b.partner_key=?');
    sweepValues.push(PARTNER_KEY);
    sweepConditions.push(`EXISTS (
      SELECT 1 FROM va_applications sa
      WHERE sa.id=l.application_id AND sa.partner_key=?
    )`);
    sweepValues.push(PARTNER_KEY);
  }
  if (applicationId) {
    fundConditions.push('f.application_id=?');
    fundValues.push(applicationId);
    otcConditions.push('o.application_id=?');
    otcValues.push(applicationId);
    conversionDebitConditions.push('l.application_id=?');
    conversionDebitValues.push(applicationId);
    conversionCreditConditions.push('l.application_id=?');
    conversionCreditValues.push(applicationId);
    sweepConditions.push('l.application_id=?');
    sweepValues.push(applicationId);
  }
  if (directFundTypes.includes(transactionType)) {
    fundConditions.push('f.type=?');
    fundValues.push(transactionType);
  }
  if (status !== 'all') {
    fundConditions.push('f.status=?');
    fundValues.push(status);
    otcConditions.push('o.status=?');
    otcValues.push(status);
  }
  if (dateFrom) {
    fundConditions.push('substr(f.created_at,1,10)>=?');
    fundValues.push(dateFrom);
    otcConditions.push('substr(o.created_at,1,10)>=?');
    otcValues.push(dateFrom);
    conversionDebitConditions.push('substr(l.created_at,1,10)>=?');
    conversionDebitValues.push(dateFrom);
    conversionCreditConditions.push('substr(l.created_at,1,10)>=?');
    conversionCreditValues.push(dateFrom);
    sweepConditions.push('substr(l.created_at,1,10)>=?');
    sweepValues.push(dateFrom);
  }
  if (dateTo) {
    fundConditions.push('substr(f.created_at,1,10)<=?');
    fundValues.push(dateTo);
    otcConditions.push('substr(o.created_at,1,10)<=?');
    otcValues.push(dateTo);
    conversionDebitConditions.push('substr(l.created_at,1,10)<=?');
    conversionDebitValues.push(dateTo);
    conversionCreditConditions.push('substr(l.created_at,1,10)<=?');
    conversionCreditValues.push(dateTo);
    sweepConditions.push('substr(l.created_at,1,10)<=?');
    sweepValues.push(dateTo);
  }
  if (datetimeFrom) {
    const parsed = new Date(datetimeFrom);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== datetimeFrom) {
      return error(422, 'validation_error', 'datetime_from 必须是 ISO 8601 UTC 时间');
    }
    fundConditions.push('COALESCE(f.completed_at,f.created_at)>=?');
    fundValues.push(datetimeFrom);
    otcConditions.push('COALESCE(o.completed_at,o.created_at)>=?');
    otcValues.push(datetimeFrom);
    conversionDebitConditions.push('l.created_at>=?');
    conversionDebitValues.push(datetimeFrom);
    conversionCreditConditions.push('l.created_at>=?');
    conversionCreditValues.push(datetimeFrom);
    sweepConditions.push('l.created_at>=?');
    sweepValues.push(datetimeFrom);
  }
  if (datetimeTo) {
    const parsed = new Date(datetimeTo);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== datetimeTo) {
      return error(422, 'validation_error', 'datetime_to 必须是 ISO 8601 UTC 时间');
    }
    fundConditions.push('COALESCE(f.completed_at,f.created_at)<?');
    fundValues.push(datetimeTo);
    otcConditions.push('COALESCE(o.completed_at,o.created_at)<?');
    otcValues.push(datetimeTo);
    conversionDebitConditions.push('l.created_at<?');
    conversionDebitValues.push(datetimeTo);
    conversionCreditConditions.push('l.created_at<?');
    conversionCreditValues.push(datetimeTo);
    sweepConditions.push('l.created_at<?');
    sweepValues.push(datetimeTo);
  }
  if (wallet === 'fiat') {
    fundConditions.push(`f.type IN ('fiat_deposit','fiat_withdrawal')`);
    otcConditions.push(`(o.sell_asset='USD' OR o.buy_asset='USD')`);
  } else if (wallet === 'crypto') {
    fundConditions.push(`f.type IN ('usdt_deposit','usdt_withdrawal')`);
    otcConditions.push(`(o.sell_asset='USDT' OR o.buy_asset='USDT')`);
  }
  if (network !== 'ALL') {
    fundConditions.push(`f.asset='USDT' AND f.network=?`);
    fundValues.push(network);
    otcConditions.push('(o.sell_network=? OR o.buy_network=?)');
    otcValues.push(network, network);
    conversionCreditConditions.push('l.network=?');
    conversionCreditValues.push(network);
  }

  const includeFundCategory = category !== 'otc';
  const includeFunds =
    includeFundCategory && (transactionType === 'all' || directFundTypes.includes(transactionType));
  const includeOtc = category !== 'fund' && ['all', 'otc'].includes(transactionType);
  const includeConversionDebits =
    includeFundCategory &&
    ['all', 'fiat_conversion_debit'].includes(transactionType) &&
    ['all', 'completed'].includes(status) &&
    ['all', 'fiat'].includes(wallet) &&
    network === 'ALL';
  const includeConversionCredits =
    includeFundCategory &&
    ['all', 'crypto_conversion_credit'].includes(transactionType) &&
    ['all', 'completed'].includes(status) &&
    ['all', 'crypto'].includes(wallet);
  const includeSweeps =
    includeFundCategory &&
    ['all', 'usdt_sweep'].includes(transactionType) &&
    ['all', 'completed'].includes(status) &&
    ['all', 'crypto'].includes(wallet) &&
    ['ALL', 'TRON'].includes(network);
  const fundWhere = fundConditions.length ? `WHERE ${fundConditions.join(' AND ')}` : '';
  const otcWhere = otcConditions.length ? `WHERE ${otcConditions.join(' AND ')}` : '';
  const conversionDebitFrom = `FROM ledger_entries l
    JOIN otc_orders o
      ON o.id=l.source_id AND o.application_id=l.application_id
    JOIN fund_transactions f
      ON f.id=o.source_fund_transaction_id AND f.application_id=l.application_id`;
  const conversionDebitWhere = `WHERE ${conversionDebitConditions.join(' AND ')}`;
  const conversionCreditWhere = `WHERE ${conversionCreditConditions.join(' AND ')}`;
  const sweepFrom = `FROM ledger_entries l
    JOIN usdt_sweep_items si
      ON si.ledger_entry_id=l.id AND si.application_id=l.application_id
    JOIN usdt_sweep_batches b ON b.id=si.batch_id`;
  const sweepWhere = `WHERE ${sweepConditions.join(' AND ')}`;
  const pageQueries: string[] = [];
  const pageBindings: Array<string | number> = [];
  if (includeFunds) {
    pageQueries.push(
      `SELECT 'fund' category,f.id,f.created_at,f.created_at sort_at,0 sort_priority
       FROM fund_transactions f ${fundWhere}`
    );
    pageBindings.push(...fundValues);
  }
  if (includeOtc) {
    pageQueries.push(
      `SELECT 'otc' category,o.id,o.created_at,o.created_at sort_at,
         CASE WHEN o.pricing_model='net_rate' AND o.source_fund_transaction_id IS NOT NULL
           THEN 1 ELSE 0 END sort_priority
       FROM otc_orders o ${otcWhere}`
    );
    pageBindings.push(...otcValues);
  }
  if (includeConversionDebits) {
    pageQueries.push(
      `SELECT 'conversion_debit' category,l.id,l.created_at,o.created_at sort_at,2 sort_priority
       ${conversionDebitFrom} ${conversionDebitWhere}`
    );
    pageBindings.push(...conversionDebitValues);
  }
  if (includeConversionCredits) {
    pageQueries.push(
      `SELECT 'conversion_credit' category,l.id,l.created_at,o.created_at sort_at,3 sort_priority
       ${conversionDebitFrom} ${conversionCreditWhere}`
    );
    pageBindings.push(...conversionCreditValues);
  }
  if (includeSweeps) {
    pageQueries.push(
      `SELECT 'sweep' category,l.id,l.created_at,l.created_at sort_at,4 sort_priority
       ${sweepFrom} ${sweepWhere}`
    );
    pageBindings.push(...sweepValues);
  }

  const countPromises: Array<Promise<{ total: number } | null>> = [];
  if (includeFunds) {
    countPromises.push(
      env.DB.prepare(`SELECT COUNT(*) total FROM fund_transactions f ${fundWhere}`)
        .bind(...fundValues)
        .first<{ total: number }>()
    );
  }
  if (includeOtc) {
    countPromises.push(
      env.DB.prepare(`SELECT COUNT(*) total FROM otc_orders o ${otcWhere}`)
        .bind(...otcValues)
        .first<{ total: number }>()
    );
  }
  if (includeConversionDebits) {
    countPromises.push(
      env.DB.prepare(`SELECT COUNT(*) total ${conversionDebitFrom} ${conversionDebitWhere}`)
        .bind(...conversionDebitValues)
        .first<{ total: number }>()
    );
  }
  if (includeConversionCredits) {
    countPromises.push(
      env.DB.prepare(`SELECT COUNT(*) total ${conversionDebitFrom} ${conversionCreditWhere}`)
        .bind(...conversionCreditValues)
        .first<{ total: number }>()
    );
  }
  if (includeSweeps) {
    countPromises.push(
      env.DB.prepare(`SELECT COUNT(*) total ${sweepFrom} ${sweepWhere}`)
        .bind(...sweepValues)
        .first<{ total: number }>()
    );
  }
  const [countRows, pageRowsResult] = await Promise.all([
    Promise.all(countPromises),
    pageQueries.length
      ? env.DB.prepare(
          `SELECT category,id,created_at FROM (${pageQueries.join(' UNION ALL ')})
           ORDER BY sort_at DESC,sort_priority ASC,id DESC LIMIT ? OFFSET ?`
        )
          .bind(...pageBindings, limit, offset)
          .all<{
            category: 'fund' | 'otc' | 'conversion_debit' | 'conversion_credit' | 'sweep';
            id: string;
            created_at: string;
          }>()
      : Promise.resolve({
          results: [] as Array<{
            category: 'fund' | 'otc' | 'conversion_debit' | 'conversion_credit' | 'sweep';
            id: string;
            created_at: string;
          }>,
        }),
  ]);
  const total = countRows.reduce((sum, row) => sum + Number(row?.total || 0), 0);
  const fundIds = pageRowsResult.results
    .filter((row) => row.category === 'fund')
    .map((row) => row.id);
  const otcIds = pageRowsResult.results
    .filter((row) => row.category === 'otc')
    .map((row) => row.id);
  const conversionDebitIds = pageRowsResult.results
    .filter((row) => row.category === 'conversion_debit')
    .map((row) => row.id);
  const conversionCreditIds = pageRowsResult.results
    .filter((row) => row.category === 'conversion_credit')
    .map((row) => row.id);
  const sweepIds = pageRowsResult.results
    .filter((row) => row.category === 'sweep')
    .map((row) => row.id);
  const [fundRows, otcRows, conversionDebitRows, conversionCreditRows, sweepRows] =
    await Promise.all([
      fundIds.length
        ? env.DB.prepare(
            `SELECT f.*,a.customer_name,a.partner_customer_id FROM fund_transactions f
          JOIN va_applications a ON a.id=f.application_id
          WHERE f.id IN (${fundIds.map(() => '?').join(',')})`
          )
            .bind(...fundIds)
            .all<FundRow>()
        : Promise.resolve({ results: [] as FundRow[] }),
      otcIds.length
        ? env.DB.prepare(
            `SELECT o.*,a.customer_name,a.partner_customer_id FROM otc_orders o
          JOIN va_applications a ON a.id=o.application_id
          WHERE o.id IN (${otcIds.map(() => '?').join(',')})`
          )
            .bind(...otcIds)
            .all<OtcRow>()
        : Promise.resolve({ results: [] as OtcRow[] }),
      conversionDebitIds.length
        ? env.DB.prepare(
            `SELECT
             l.id,l.application_id,l.amount_minor,l.asset_decimals,l.created_at,
             o.id otc_order_id,o.source_fund_transaction_id,
             o.updated_at,o.completed_at,
             f.external_reference,f.transaction_reference,f.note,f.operator_note,
             a.customer_name,a.partner_customer_id
           ${conversionDebitFrom}
           JOIN va_applications a ON a.id=l.application_id
           WHERE l.id IN (${conversionDebitIds.map(() => '?').join(',')})`
          )
            .bind(...conversionDebitIds)
            .all<ConversionDebitHistoryRow>()
        : Promise.resolve({ results: [] as ConversionDebitHistoryRow[] }),
      conversionCreditIds.length
        ? env.DB.prepare(
            `SELECT
             l.id,l.application_id,l.asset,l.network,l.amount_minor,l.asset_decimals,l.created_at,
             o.id otc_order_id,o.source_fund_transaction_id,
             o.updated_at,o.completed_at,
             f.external_reference,f.transaction_reference,f.note,f.operator_note,
             a.customer_name,a.partner_customer_id
           ${conversionDebitFrom}
           JOIN va_applications a ON a.id=l.application_id
           WHERE l.id IN (${conversionCreditIds.map(() => '?').join(',')})`
          )
            .bind(...conversionCreditIds)
            .all<ConversionCreditHistoryRow>()
        : Promise.resolve({ results: [] as ConversionCreditHistoryRow[] }),
      sweepIds.length
        ? env.DB.prepare(
            `SELECT
             l.id,l.application_id,l.amount_minor,l.asset_decimals,l.created_at,
             b.id sweep_batch_id,b.tx_hash,b.updated_at,b.completed_at,
             a.customer_name,a.partner_customer_id
           ${sweepFrom}
           JOIN va_applications a ON a.id=l.application_id
           WHERE l.id IN (${sweepIds.map(() => '?').join(',')})
             ${includeOperatorFields ? '' : 'AND b.partner_key=? AND a.partner_key=?'}`
          )
            .bind(...sweepIds, ...(includeOperatorFields ? [] : [PARTNER_KEY, PARTNER_KEY]))
            .all<SweepHistoryRow>()
        : Promise.resolve({ results: [] as SweepHistoryRow[] }),
    ]);

  const items = new Map<string, Record<string, unknown>>();
  fundRows.results.forEach((row) => {
    items.set(`fund:${row.id}`, {
      id: row.id,
      application_id: row.application_id,
      partner_customer_id: row.partner_customer_id,
      customer_name: row.customer_name,
      category: 'fund',
      type: row.type,
      direction: ['fiat_deposit', 'usdt_deposit'].includes(row.type) ? 'credit' : 'debit',
      asset: row.asset,
      amount: minorToAmount(row.amount_minor, row.asset_decimals),
      counter_asset: null,
      counter_amount: null,
      fee_amount: minorToAmount(row.fee_amount_minor || 0, row.asset_decimals),
      net_amount: minorToAmount(
        isWithdrawalFeeType(row.type)
          ? row.amount_minor - (row.fee_amount_minor || 0)
          : row.amount_minor,
        row.asset_decimals
      ),
      status: row.status,
      settlement_status: row.settlement_status,
      conversion_otc_id: row.conversion_otc_id,
      reference: row.transaction_reference || row.external_reference,
      external_reference: row.external_reference,
      transaction_reference: row.transaction_reference,
      destination: row.destination,
      network: row.network,
      beneficiary_name: row.beneficiary_name,
      beneficiary_address: row.beneficiary_address,
      bank_name: row.bank_name,
      bank_account_number: row.bank_account_number,
      swift_bic: row.swift_bic,
      bank_address: row.bank_address,
      note: row.note,
      ...(includeOperatorFields ? { operator_note: row.operator_note } : {}),
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
    });
  });
  otcRows.results.forEach((row) => {
    items.set(`otc:${row.id}`, {
      id: row.id,
      application_id: row.application_id,
      partner_customer_id: row.partner_customer_id,
      customer_name: row.customer_name,
      category: 'otc',
      type: 'otc',
      direction: 'exchange',
      asset: row.sell_asset,
      network: row.sell_network || null,
      amount: minorToAmount(row.sell_amount_minor, row.sell_decimals),
      counter_asset: row.buy_asset,
      counter_network: row.buy_network || null,
      counter_amount: minorToAmount(row.buy_amount_minor - row.fee_amount_minor, row.buy_decimals),
      buy_amount: minorToAmount(row.buy_amount_minor, row.buy_decimals),
      net_buy_amount: minorToAmount(row.buy_amount_minor - row.fee_amount_minor, row.buy_decimals),
      fee_amount: minorToAmount(row.fee_amount_minor, row.buy_decimals),
      fee_rate: row.pricing_model === 'net_rate' ? '0%' : '0.5%',
      exchange_rate: row.exchange_rate,
      status: row.status,
      reference: null,
      note: row.note,
      ...(includeOperatorFields
        ? {
            reference: row.settlement_reference,
            operator_note: row.operator_note,
            settlement_reference: row.settlement_reference,
          }
        : {}),
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
    });
  });
  conversionDebitRows.results.forEach((row) => {
    const amount = minorToAmount(Math.abs(row.amount_minor), row.asset_decimals);
    items.set(`conversion_debit:${row.id}`, {
      id: row.id,
      ledger_entry_id: row.id,
      application_id: row.application_id,
      partner_customer_id: row.partner_customer_id,
      customer_name: row.customer_name,
      category: 'fund',
      type: 'fiat_conversion_debit',
      direction: 'debit',
      asset: 'USD',
      network: null,
      amount,
      counter_asset: null,
      counter_amount: null,
      fee_amount: minorToAmount(0, row.asset_decimals),
      net_amount: amount,
      status: 'completed',
      settlement_status: 'cleared',
      source_fund_transaction_id: row.source_fund_transaction_id,
      otc_order_id: row.otc_order_id,
      conversion_otc_id: row.otc_order_id,
      reference: row.transaction_reference || row.external_reference,
      external_reference: row.external_reference,
      transaction_reference: row.transaction_reference,
      note: row.note,
      ...(includeOperatorFields ? { operator_note: row.operator_note } : {}),
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
    });
  });
  conversionCreditRows.results.forEach((row) => {
    const amount = minorToAmount(row.amount_minor, row.asset_decimals);
    items.set(`conversion_credit:${row.id}`, {
      id: row.id,
      ledger_entry_id: row.id,
      application_id: row.application_id,
      partner_customer_id: row.partner_customer_id,
      customer_name: row.customer_name,
      category: 'fund',
      type: 'crypto_conversion_credit',
      direction: 'credit',
      asset: row.asset,
      network: row.network,
      amount,
      counter_asset: null,
      counter_amount: null,
      fee_amount: minorToAmount(0, row.asset_decimals),
      net_amount: amount,
      status: 'completed',
      settlement_status: 'cleared',
      source_fund_transaction_id: row.source_fund_transaction_id,
      otc_order_id: row.otc_order_id,
      conversion_otc_id: row.otc_order_id,
      reference: row.transaction_reference || row.external_reference,
      external_reference: row.external_reference,
      transaction_reference: row.transaction_reference,
      note: row.note,
      ...(includeOperatorFields ? { operator_note: row.operator_note } : {}),
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
    });
  });
  sweepRows.results.forEach((row) => {
    const amount = minorToAmount(Math.abs(row.amount_minor), row.asset_decimals);
    items.set(`sweep:${row.id}`, {
      id: row.id,
      ledger_entry_id: row.id,
      application_id: row.application_id,
      partner_customer_id: row.partner_customer_id,
      customer_name: row.customer_name,
      category: 'fund',
      type: 'usdt_sweep',
      direction: 'debit',
      asset: 'USDT',
      network: 'TRON',
      amount,
      counter_asset: null,
      counter_amount: null,
      fee_amount: minorToAmount(0, row.asset_decimals),
      net_amount: amount,
      status: 'completed',
      settlement_status: null,
      sweep_batch_id: row.sweep_batch_id,
      reference: row.tx_hash,
      external_reference: null,
      transaction_reference: row.tx_hash,
      note: null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
    });
  });
  const data = pageRowsResult.results
    .map((row) => items.get(`${row.category}:${row.id}`))
    .filter((row): row is Record<string, unknown> => Boolean(row));
  return json({
    data,
    meta: {
      count: data.length,
      total,
      page,
      limit,
      total_pages: total ? Math.ceil(total / limit) : 0,
    },
  });
}

async function createOtc(env: Env, request: Request, customerInitiated = false) {
  if (!customerInitiated) {
    return error(403, 'partner_only', 'OTC 申请必须由合作方通过 Portal 或 Partner API 发起');
  }
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const unknownFields = rejectUnknownFields(parsed, [
    'application_id',
    'partner_customer_id',
    'sell_asset',
    'sell_amount',
    'sell_network',
    'buy_asset',
    'buy_amount',
    'buy_network',
    'exchange_rate',
    'note',
  ]);
  if (unknownFields) return unknownFields;
  const applicationSelector = await resolveApplicationBody(env, parsed, customerInitiated);
  if (applicationSelector instanceof Response) return applicationSelector;
  const applicationId = applicationSelector || '';
  const sellAsset =
    typeof parsed.sell_asset === 'string' ? parsed.sell_asset.trim().toUpperCase() : '';
  const buyAsset =
    typeof parsed.buy_asset === 'string' ? parsed.buy_asset.trim().toUpperCase() : '';
  if (
    (parsed.sell_network !== undefined && typeof parsed.sell_network !== 'string') ||
    (parsed.buy_network !== undefined && typeof parsed.buy_network !== 'string')
  ) {
    return error(422, 'validation_error', 'OTC 网络字段必须是字符串');
  }
  const suppliedSellNetwork =
    typeof parsed.sell_network === 'string' ? parsed.sell_network.trim() : '';
  const suppliedBuyNetwork =
    typeof parsed.buy_network === 'string' ? parsed.buy_network.trim() : '';
  if ((sellAsset === 'USD' && suppliedSellNetwork) || (buyAsset === 'USD' && suppliedBuyNetwork)) {
    return error(422, 'validation_error', 'USD 一侧不得提交网络；网络只属于 USDT 一侧');
  }
  const sellNetwork = ledgerNetwork(sellAsset, suppliedSellNetwork);
  const buyNetwork = ledgerNetwork(buyAsset, suppliedBuyNetwork);
  const sellDecimals = defaultDecimals(sellAsset);
  const buyDecimals = defaultDecimals(buyAsset);
  const sellMinor = amountToMinor(parsed.sell_amount, sellDecimals);
  const buyMinor = amountToMinor(parsed.buy_amount, buyDecimals);
  const isAllowedPair =
    (sellAsset === 'USD' && buyAsset === 'USDT') || (sellAsset === 'USDT' && buyAsset === 'USD');
  if (
    !applicationId ||
    !isAllowedPair ||
    sellMinor instanceof Response ||
    buyMinor instanceof Response
  ) {
    return error(422, 'validation_error', 'OTC 仅支持 USD → USDT 或 USDT → USD');
  }
  if (
    (sellAsset === 'USDT' && !isSupportedCryptoNetwork(sellNetwork)) ||
    (buyAsset === 'USDT' && !isSupportedCryptoNetwork(buyNetwork))
  ) {
    return error(
      422,
      'validation_error',
      'OTC 的 USDT 买入与卖出侧都必须指定 TRON、ETHEREUM、SOLANA 或 BSC'
    );
  }
  const rate = parsePositiveDecimalParts(parsed.exchange_rate);
  if (!rate) {
    return error(422, 'validation_error', 'exchange_rate 必须是正数字符串');
  }
  const expectedBuyMinor = expectedBuyMinorFromRate(sellMinor, sellDecimals, buyDecimals, rate);
  if (expectedBuyMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
    return error(422, 'validation_error', '成交汇率计算结果超出允许范围');
  }
  if (expectedBuyMinor !== BigInt(buyMinor)) {
    return error(
      422,
      'otc_quote_mismatch',
      'buy_amount 必须等于 sell_amount × exchange_rate，并按买入资产最小单位四舍五入',
      {
        expected_buy_amount: minorToAmount(Number(expectedBuyMinor), buyDecimals),
        buy_asset: buyAsset,
      }
    );
  }
  const note = normalizeOptionalText(parsed.note, 'note', 1000);
  if (note instanceof Response) return note;
  const exists = await env.DB.prepare(
    `SELECT id FROM va_applications WHERE id=? AND status='active'`
  )
    .bind(applicationId)
    .first();
  if (!exists) return error(422, 'account_not_active', '客户 VA 账户尚未开通');
  const normalizedRequest: NormalizedOtcRequest = {
    application_id: applicationId,
    sell_asset: sellAsset as 'USD' | 'USDT',
    sell_amount_minor: sellMinor,
    sell_network: sellNetwork,
    buy_asset: buyAsset as 'USD' | 'USDT',
    buy_amount_minor: buyMinor,
    buy_network: buyNetwork,
    exchange_rate: rate.canonical,
    note,
  };
  const fingerprint = await requestFingerprint(normalizedRequest);
  const key = resolveIdempotencyKey(request, customerInitiated);
  if (key instanceof Response) return key;
  const owner = await findIdempotencyOwner(env, key);
  if (owner) {
    return owner.resourceType === 'otc_order' &&
      owner.otc &&
      owner.requestFingerprint === fingerprint &&
      otcRequestMatches(owner.otc, normalizedRequest, fingerprint)
      ? json(normalizeOtc(owner.otc, !customerInitiated))
      : idempotencyConflict(owner.resourceId);
  }
  if ((await availableBalanceMinor(env, applicationId, sellAsset, sellNetwork)) < sellMinor) {
    return error(409, 'insufficient_available_balance', '所选资产与网络的账本可用余额不足');
  }
  const feeMinor = otcFeeMinorFromBuyAmount(buyMinor);
  if (feeMinor >= buyMinor) {
    return error(422, 'otc_amount_too_small', '买入总额必须大于按最小单位四舍五入后的 OTC 手续费');
  }
  const netBuyMinor = buyMinor - feeMinor;
  const id = `otc_${crypto.randomUUID().replaceAll('-', '')}`;
  const now = new Date().toISOString();
  try {
    const values = [
      id,
      applicationId,
      key,
      fingerprint,
      sellAsset,
      sellMinor,
      sellDecimals,
      sellNetwork,
      buyAsset,
      buyMinor,
      buyDecimals,
      buyNetwork,
      rate.canonical,
      feeMinor,
      note,
      now,
      now,
      now,
    ];
    const insertStatement = env.DB.prepare(
      `INSERT INTO otc_orders
        (id,application_id,idempotency_key,request_fingerprint,
         sell_asset,sell_amount_minor,sell_decimals,
         sell_network,buy_asset,buy_amount_minor,buy_decimals,buy_network,
         exchange_rate,fee_bps,fee_amount_minor,
         status,note,created_at,updated_at,completed_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,50,?,'completed',?,?,?,?
        WHERE (
          COALESCE((SELECT SUM(amount_minor) FROM ledger_entries
            WHERE application_id=? AND asset=? AND network=?),0)
          - COALESCE((SELECT SUM(amount_minor) FROM fund_transactions
            WHERE application_id=? AND asset=? AND COALESCE(network,'')=?
              AND type IN ('usdt_withdrawal','fiat_withdrawal')
              AND status IN ('submitted','processing')),0)
          - COALESCE((SELECT SUM(sell_amount_minor) FROM otc_orders
            WHERE application_id=? AND sell_asset=? AND sell_network=?
              AND status IN ('submitted','processing')),0)
        ) >= ?`
    ).bind(
      ...values,
      applicationId,
      sellAsset,
      sellNetwork,
      applicationId,
      sellAsset,
      sellNetwork,
      applicationId,
      sellAsset,
      sellNetwork,
      sellMinor
    );
    const [result] = await env.DB.batch([
      insertStatement,
      env.DB.prepare(
        `INSERT INTO ledger_entries
        (id,application_id,source_type,source_id,asset,network,
         amount_minor,asset_decimals,entry_type,created_at)
        VALUES (?,?,'otc_order',?,?,?,?,?,'otc_sell',?)`
      ).bind(
        crypto.randomUUID(),
        applicationId,
        id,
        sellAsset,
        sellNetwork,
        -sellMinor,
        sellDecimals,
        now
      ),
      env.DB.prepare(
        `INSERT INTO ledger_entries
        (id,application_id,source_type,source_id,asset,network,
         amount_minor,asset_decimals,entry_type,created_at)
        VALUES (?,?,'otc_order',?,?,?,?,?,'otc_buy_net',?)`
      ).bind(
        crypto.randomUUID(),
        applicationId,
        id,
        buyAsset,
        buyNetwork,
        netBuyMinor,
        buyDecimals,
        now
      ),
      apiRequestKeyStatement(env, key, '/otc-orders', 'otc_order', id, fingerprint, now),
      webhookOutboxStatement(
        env,
        'otc_order.status_changed',
        'otc_order',
        id,
        applicationId,
        'completed',
        now,
        {
          table: 'otc_orders',
          id,
          status: 'completed',
          updatedAt: now,
        }
      ),
      businessAuditStatement(
        env,
        applicationId,
        'otc_order.completed',
        auditMetadata(request, customerInitiated ? 'partner' : 'operator', {
          otc_order_id: id,
          sell_asset: sellAsset,
          sell_network: sellNetwork || null,
          sell_amount: minorToAmount(sellMinor, sellDecimals),
          buy_asset: buyAsset,
          buy_network: buyNetwork || null,
          gross_buy_amount: minorToAmount(buyMinor, buyDecimals),
          fee_amount: minorToAmount(feeMinor, buyDecimals),
          net_buy_amount: minorToAmount(netBuyMinor, buyDecimals),
        }),
        customerInitiated ? 'partner' : 'operator',
        {
          table: 'otc_orders',
          id,
          status: 'completed',
          updatedAt: now,
        }
      ),
    ]);
    if (result.meta.changes === 0) {
      const concurrent = await findIdempotencyOwner(env, key);
      if (concurrent) {
        return concurrent.resourceType === 'otc_order' &&
          concurrent.otc &&
          concurrent.requestFingerprint === fingerprint &&
          otcRequestMatches(concurrent.otc, normalizedRequest, fingerprint)
          ? json(normalizeOtc(concurrent.otc, !customerInitiated))
          : idempotencyConflict(concurrent.resourceId);
      }
      return error(409, 'insufficient_available_balance', '账本可用余额不足');
    }
  } catch (caught) {
    const caughtMessage = caught instanceof Error ? caught.message : '';
    if (caughtMessage.includes('UNIQUE')) {
      const concurrent = await findIdempotencyOwner(env, key);
      if (!concurrent) throw caught;
      return concurrent.resourceType === 'otc_order' &&
        concurrent.otc &&
        concurrent.requestFingerprint === fingerprint &&
        otcRequestMatches(concurrent.otc, normalizedRequest, fingerprint)
        ? json(normalizeOtc(concurrent.otc, !customerInitiated))
        : idempotencyConflict(concurrent.resourceId);
    }
    if (
      caughtMessage.includes('ledger_entry_accounting_integrity') &&
      (await availableBalanceMinor(env, applicationId, sellAsset, sellNetwork)) < sellMinor
    ) {
      return error(409, 'insufficient_available_balance', '所选资产与网络的账本可用余额不足');
    }
    throw caught;
  }
  const row = await env.DB.prepare(
    `SELECT o.*,a.customer_name,a.partner_customer_id
     FROM otc_orders o
     JOIN va_applications a ON a.id=o.application_id
     WHERE o.id=?`
  )
    .bind(id)
    .first<OtcRow>();
  return json(normalizeOtc(row as OtcRow, !customerInitiated), 201);
}

async function updateOtc(env: Env, id: string, request: Request) {
  const row = await env.DB.prepare(`SELECT * FROM otc_orders WHERE id=?`).bind(id).first<OtcRow>();
  if (!row) return error(404, 'not_found', 'OTC 订单不存在');
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const unknownFields = rejectUnknownFields(parsed, [
    'status',
    'operator_note',
    'settlement_reference',
  ]);
  if (unknownFields) return unknownFields;
  const hasOperatorNote = Object.prototype.hasOwnProperty.call(parsed, 'operator_note');
  const requestedOperatorNote = normalizeOptionalText(parsed.operator_note, 'operator_note', 1000);
  if (requestedOperatorNote instanceof Response) return requestedOperatorNote;
  const hasSettlementReference = Object.prototype.hasOwnProperty.call(
    parsed,
    'settlement_reference'
  );
  const requestedSettlementReference = normalizeOptionalText(
    parsed.settlement_reference,
    'settlement_reference',
    200
  );
  if (requestedSettlementReference instanceof Response) {
    return requestedSettlementReference;
  }
  const operatorNote = hasOperatorNote
    ? requestedOperatorNote
    : normalizedStoredText(row.operator_note);
  const settlementReference = hasSettlementReference
    ? requestedSettlementReference
    : normalizedStoredText(row.settlement_reference);
  const next = String(parsed.status || '');
  if (!['processing', 'completed', 'rejected', 'cancelled'].includes(next)) {
    return error(422, 'validation_error', '无效的处理状态');
  }
  if (!['submitted', 'processing'].includes(row.status)) {
    return error(409, 'invalid_status', '该 OTC 订单不能再次处理');
  }
  if (next === row.status) {
    return error(409, 'no_status_change', 'OTC 订单状态没有变化');
  }
  const storedRate = parsePositiveDecimalParts(row.exchange_rate);
  const validPair =
    (row.sell_asset === 'USD' &&
      row.sell_decimals === 2 &&
      row.sell_network === '' &&
      row.buy_asset === 'USDT' &&
      row.buy_decimals === 6 &&
      isSupportedCryptoNetwork(row.buy_network)) ||
    (row.sell_asset === 'USDT' &&
      row.sell_decimals === 6 &&
      isSupportedCryptoNetwork(row.sell_network) &&
      row.buy_asset === 'USD' &&
      row.buy_decimals === 2 &&
      row.buy_network === '');
  const validStoredQuote = Boolean(
    storedRate &&
      expectedBuyMinorFromRate(
        row.sell_amount_minor,
        row.sell_decimals,
        row.buy_decimals,
        storedRate
      ) === BigInt(row.buy_amount_minor)
  );
  const validStoredFee =
    row.fee_bps === 50 &&
    row.fee_amount_minor === otcFeeMinorFromBuyAmount(row.buy_amount_minor) &&
    row.fee_amount_minor >= 0 &&
    row.fee_amount_minor < row.buy_amount_minor;
  if (
    ['processing', 'completed'].includes(next) &&
    (!row.request_fingerprint ||
      !/^[0-9a-f]{64}$/.test(row.request_fingerprint) ||
      !validPair ||
      !validStoredQuote ||
      !validStoredFee)
  ) {
    return error(
      409,
      'legacy_integrity_review_required',
      '该历史 OTC 订单不符合当前账务规则，请取消后核对并重新创建'
    );
  }
  const now = new Date().toISOString();
  if (next === 'completed') {
    if (
      (await balanceMinor(env, row.application_id, row.sell_asset, row.sell_network)) <
      row.sell_amount_minor
    ) {
      return error(409, 'insufficient_balance', '卖出币种余额不足');
    }
    const netBuy = row.buy_amount_minor - row.fee_amount_minor;
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO ledger_entries
        (id,application_id,source_type,source_id,asset,network,amount_minor,asset_decimals,entry_type,created_at)
        SELECT ?,?,'otc_order',?,?,?,?,?,'otc_sell',?
        WHERE EXISTS (
          SELECT 1 FROM otc_orders
          WHERE id=? AND status IN ('submitted','processing')
        )
        AND COALESCE((
          SELECT SUM(amount_minor) FROM ledger_entries
          WHERE application_id=? AND asset=? AND network=?
        ),0) >= ?`
      ).bind(
        crypto.randomUUID(),
        row.application_id,
        row.id,
        row.sell_asset,
        row.sell_network,
        -row.sell_amount_minor,
        row.sell_decimals,
        now,
        id,
        row.application_id,
        row.sell_asset,
        row.sell_network,
        row.sell_amount_minor
      ),
      env.DB.prepare(
        `INSERT INTO ledger_entries
        (id,application_id,source_type,source_id,asset,network,amount_minor,asset_decimals,entry_type,created_at)
        SELECT ?,?,'otc_order',?,?,?,?,?,'otc_buy_net',?
        WHERE EXISTS (
          SELECT 1 FROM otc_orders
          WHERE id=? AND status IN ('submitted','processing')
        )
        AND EXISTS (
          SELECT 1 FROM ledger_entries
          WHERE source_type='otc_order' AND source_id=?
            AND asset=? AND entry_type='otc_sell'
        )`
      ).bind(
        crypto.randomUUID(),
        row.application_id,
        row.id,
        row.buy_asset,
        row.buy_network,
        netBuy,
        row.buy_decimals,
        now,
        id,
        id,
        row.sell_asset
      ),
      env.DB.prepare(
        `UPDATE otc_orders
        SET status='completed',operator_note=?,settlement_reference=?,
          updated_at=?,completed_at=?
        WHERE id=? AND status IN ('submitted','processing')
          AND EXISTS (
            SELECT 1 FROM ledger_entries
            WHERE source_type='otc_order' AND source_id=?
              AND asset=? AND entry_type='otc_sell'
          )
          AND EXISTS (
            SELECT 1 FROM ledger_entries
            WHERE source_type='otc_order' AND source_id=?
              AND asset=? AND entry_type='otc_buy_net'
          )`
      ).bind(
        operatorNote,
        settlementReference,
        now,
        now,
        id,
        id,
        row.sell_asset,
        id,
        row.buy_asset
      ),
      webhookOutboxStatement(
        env,
        'otc_order.status_changed',
        'otc_order',
        id,
        row.application_id,
        next,
        now,
        {
          table: 'otc_orders',
          id,
          status: next,
          updatedAt: now,
        }
      ),
      businessAuditStatement(
        env,
        row.application_id,
        `otc_order.${next}`,
        auditMetadata(request, 'operator', { otc_order_id: id }),
        'operator',
        {
          table: 'otc_orders',
          id,
          status: next,
          updatedAt: now,
        }
      ),
    ]);
    if (results[2].meta.changes === 0) {
      if (
        (await balanceMinor(env, row.application_id, row.sell_asset, row.sell_network)) <
        row.sell_amount_minor
      ) {
        return error(409, 'insufficient_balance', '卖出币种余额不足');
      }
      return error(409, 'invalid_status', '该 OTC 订单已被其他操作处理');
    }
  } else {
    const [result] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE otc_orders
        SET status=?,operator_note=?,settlement_reference=?,updated_at=?
        WHERE id=? AND status IN ('submitted','processing')`
      ).bind(next, operatorNote, settlementReference, now, id),
      webhookOutboxStatement(
        env,
        'otc_order.status_changed',
        'otc_order',
        id,
        row.application_id,
        next,
        now,
        {
          table: 'otc_orders',
          id,
          status: next,
          updatedAt: now,
        }
      ),
      businessAuditStatement(
        env,
        row.application_id,
        `otc_order.${next}`,
        auditMetadata(request, 'operator', { otc_order_id: id }),
        'operator',
        {
          table: 'otc_orders',
          id,
          status: next,
          updatedAt: now,
        }
      ),
    ]);
    if (result.meta.changes === 0) {
      return error(409, 'invalid_status', '该 OTC 订单已被其他操作处理');
    }
  }
  const updated = await env.DB.prepare(
    `SELECT o.*,a.customer_name,a.partner_customer_id
     FROM otc_orders o
     JOIN va_applications a ON a.id=o.application_id
     WHERE o.id=?`
  )
    .bind(id)
    .first<OtcRow>();
  return json(normalizeOtc(updated as OtcRow, true));
}

type BalanceRow = {
  application_id: string;
  partner_customer_id: string | null;
  asset: string;
  network: string;
  asset_decimals: number;
  ledger_minor: number;
  reserved_funds: number;
  reserved_otc: number;
  reserved_sweeps: number;
};

function normalizeBalance(row: BalanceRow) {
  const reservedMinor = row.reserved_funds + row.reserved_otc + row.reserved_sweeps;
  const availableMinor = row.ledger_minor - reservedMinor;
  return {
    application_id: row.application_id,
    partner_customer_id: row.partner_customer_id,
    asset: row.asset,
    network: row.network || null,
    ledger_balance: minorToAmount(row.ledger_minor, row.asset_decimals),
    reserved: minorToAmount(reservedMinor, row.asset_decimals),
    available_balance: minorToAmount(availableMinor, row.asset_decimals),
    balance: minorToAmount(availableMinor, row.asset_decimals),
    asset_decimals: row.asset_decimals,
  };
}

async function getBalanceRows(env: Env, applicationId?: string, partnerScoped = false) {
  const conditions: string[] = [];
  const values: string[] = [];
  if (applicationId) {
    conditions.push('application_id=?');
    values.push(applicationId);
  }
  if (partnerScoped) {
    conditions.push(`EXISTS (
      SELECT 1 FROM va_applications pa
      WHERE pa.id=ledger_entries.application_id AND pa.partner_key=?
    )`);
    values.push(PARTNER_KEY);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const statement = env.DB.prepare(`SELECT
      ledger.application_id,
      (SELECT partner_customer_id FROM va_applications
       WHERE id=ledger.application_id) partner_customer_id,
      ledger.asset,
      ledger.network,
      ledger.asset_decimals,
      ledger.ledger_minor,
      COALESCE((
        SELECT SUM(f.amount_minor) FROM fund_transactions f
        WHERE f.application_id=ledger.application_id AND f.asset=ledger.asset
          AND COALESCE(f.network,'')=ledger.network
          AND f.type IN ('usdt_withdrawal','fiat_withdrawal')
          AND f.status IN ('submitted','processing')
      ),0) reserved_funds,
      COALESCE((
        SELECT SUM(o.sell_amount_minor) FROM otc_orders o
        WHERE o.application_id=ledger.application_id AND o.sell_asset=ledger.asset
          AND o.sell_network=ledger.network
          AND o.status IN ('submitted','processing')
      ),0) reserved_otc,
      CASE WHEN ledger.asset='USDT' AND ledger.network='TRON' THEN COALESCE((
        SELECT SUM(i.amount_minor)
        FROM usdt_sweep_items i
        JOIN usdt_sweep_batches b ON b.id=i.batch_id
        WHERE i.application_id=ledger.application_id
          AND b.status IN ('locked','submitted')
      ),0) ELSE 0 END reserved_sweeps
    FROM (
      SELECT application_id,asset,network,asset_decimals,SUM(amount_minor) ledger_minor
      FROM ledger_entries ${where}
      GROUP BY application_id,asset,network,asset_decimals
    ) ledger
    ORDER BY ledger.application_id,ledger.asset,ledger.network`);
  const result = await (values.length ? statement.bind(...values) : statement).all<BalanceRow>();
  return result.results;
}

async function listBalances(env: Env, url: URL, includeOperatorFields = false) {
  const applicationSelector = await resolveApplicationQuery(env, url, !includeOperatorFields);
  if (applicationSelector instanceof Response) return applicationSelector;
  const applicationId = applicationSelector;
  if (!applicationId) {
    return error(422, 'validation_error', '缺少 application_id 或 partner_customer_id');
  }
  const rows = await getBalanceRows(env, applicationId, !includeOperatorFields);
  return json({ data: rows.map(normalizeBalance) });
}

async function listLedger(env: Env, url: URL) {
  const applicationId = url.searchParams.get('application_id');
  const statement = applicationId
    ? env.DB.prepare(
        `SELECT * FROM ledger_entries WHERE application_id=? ORDER BY created_at DESC LIMIT 200`
      ).bind(applicationId)
    : env.DB.prepare(`SELECT * FROM ledger_entries ORDER BY created_at DESC LIMIT 200`);
  const result = await statement.all<Record<string, unknown>>();
  return json({
    data: result.results.map((row) => {
      const { amount_minor: amountMinor, ...publicRow } = row;
      return {
        ...publicRow,
        amount: minorToAmount(Number(amountMinor), Number(row.asset_decimals)),
      };
    }),
  });
}

type SweepSettingRow = {
  id: 'ethan_tron_address';
  tron_address: string | null;
  version: number;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

type SweepBatchRow = {
  id: string;
  partner_key: string;
  status: 'locked' | 'submitted' | 'completed' | 'cancelled';
  network: 'TRON';
  destination_address: string;
  destination_version: number;
  total_amount_minor: number;
  asset_decimals: 6;
  tx_hash: string | null;
  operator_note: string | null;
  created_by: string;
  submitted_by: string | null;
  completed_by: string | null;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
};

type SweepItemRow = {
  id: string;
  batch_id: string;
  application_id: string;
  customer_name: string;
  partner_customer_id: string | null;
  amount_minor: number;
  asset_decimals: 6;
  ledger_entry_id: string | null;
  created_at: string;
};

function normalizeSweepBatch(row: SweepBatchRow, items: SweepItemRow[] = []) {
  return {
    ...row,
    total_amount: minorToAmount(row.total_amount_minor, row.asset_decimals),
    total_amount_minor: undefined,
    items: items.map((item) => ({
      id: item.id,
      application_id: item.application_id,
      partner_customer_id: item.partner_customer_id,
      customer_name: item.customer_name,
      amount: minorToAmount(item.amount_minor, item.asset_decimals),
      ledger_entry_id: item.ledger_entry_id,
      created_at: item.created_at,
    })),
  };
}

function normalizePartnerSweepBatch(row: SweepBatchRow, items: SweepItemRow[] = []) {
  return {
    batch_id: row.id,
    status: row.status,
    network: row.network,
    asset: 'USDT',
    total_amount: minorToAmount(row.total_amount_minor, row.asset_decimals),
    destination_address: row.destination_address,
    tx_hash: row.tx_hash,
    created_at: row.created_at,
    submitted_at: row.submitted_at,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at,
    items: items.map((item) => ({
      application_id: item.application_id,
      partner_customer_id: item.partner_customer_id,
      customer_name: item.customer_name,
      amount: minorToAmount(item.amount_minor, item.asset_decimals),
      ledger_entry_id: item.ledger_entry_id,
    })),
  };
}

async function listPartnerSweepBatches(env: Env, url: URL) {
  const status = url.searchParams.get('status')?.trim() || 'all';
  const applicationSelector = await resolveApplicationQuery(env, url, true);
  if (applicationSelector instanceof Response) return applicationSelector;
  const applicationId = applicationSelector;
  const pageValue = url.searchParams.get('page') || '1';
  const limitValue = url.searchParams.get('limit') || '100';
  if (!['all', 'locked', 'submitted', 'completed', 'cancelled'].includes(status)) {
    return error(422, 'validation_error', '归集状态无效');
  }
  if (!/^[1-9]\d*$/.test(pageValue) || !/^[1-9]\d*$/.test(limitValue)) {
    return error(422, 'validation_error', 'page 和 limit 必须是正整数');
  }
  const page = Number(pageValue);
  const limit = Number(limitValue);
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit) || limit > 100) {
    return error(422, 'validation_error', 'page 超出范围，limit 最大为 100');
  }
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) {
    return error(422, 'validation_error', '分页范围过大');
  }
  const conditions = [
    'b.partner_key=?',
    `NOT EXISTS (
      SELECT 1 FROM usdt_sweep_items xi
      JOIN va_applications xa ON xa.id=xi.application_id
      WHERE xi.batch_id=b.id AND xa.partner_key<>?
    )`,
  ];
  const values: string[] = [PARTNER_KEY, PARTNER_KEY];
  if (status !== 'all') {
    conditions.push('b.status=?');
    values.push(status);
  }
  if (applicationId) {
    conditions.push(`EXISTS (
      SELECT 1 FROM usdt_sweep_items fi
      JOIN va_applications fa ON fa.id=fi.application_id
      WHERE fi.batch_id=b.id AND fi.application_id=? AND fa.partner_key=?
    )`);
    values.push(applicationId, PARTNER_KEY);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const [countRow, batches] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) total FROM usdt_sweep_batches b ${where}`)
      .bind(...values)
      .first<{ total: number }>(),
    env.DB.prepare(
      `SELECT b.* FROM usdt_sweep_batches b
       ${where}
       ORDER BY b.created_at DESC,b.id DESC
       LIMIT ? OFFSET ?`
    )
      .bind(...values, limit, offset)
      .all<SweepBatchRow>(),
  ]);
  const total = Number(countRow?.total || 0);
  const meta = {
    total,
    page,
    limit,
    total_pages: total ? Math.ceil(total / limit) : 0,
  };
  if (batches.results.length === 0) return json({ data: [], meta });
  const batchIds = batches.results.map((batch) => batch.id);
  const items = await env.DB.prepare(
    `SELECT i.*,a.customer_name,a.partner_customer_id
     FROM usdt_sweep_items i
     JOIN va_applications a ON a.id=i.application_id
     JOIN usdt_sweep_batches b ON b.id=i.batch_id
     WHERE i.batch_id IN (${batchIds.map(() => '?').join(',')})
       AND b.partner_key=? AND a.partner_key=?
     ORDER BY i.created_at`
  )
    .bind(...batchIds, PARTNER_KEY, PARTNER_KEY)
    .all<SweepItemRow>();
  const byBatch = new Map<string, SweepItemRow[]>();
  items.results.forEach((item) => {
    const current = byBatch.get(item.batch_id) || [];
    current.push(item);
    byBatch.set(item.batch_id, current);
  });
  return json({
    data: batches.results.map((batch) =>
      normalizePartnerSweepBatch(batch, byBatch.get(batch.id) || [])
    ),
    meta,
  });
}

async function getPartnerSweepBatch(env: Env, id: string) {
  const batch = await env.DB.prepare(
    `SELECT b.* FROM usdt_sweep_batches b
     WHERE b.id=? AND b.partner_key=?
       AND EXISTS (
         SELECT 1 FROM usdt_sweep_items i
         JOIN va_applications a ON a.id=i.application_id
         WHERE i.batch_id=b.id AND a.partner_key=?
       )
       AND NOT EXISTS (
         SELECT 1 FROM usdt_sweep_items xi
         JOIN va_applications xa ON xa.id=xi.application_id
         WHERE xi.batch_id=b.id AND xa.partner_key<>?
       )`
  )
    .bind(id, PARTNER_KEY, PARTNER_KEY, PARTNER_KEY)
    .first<SweepBatchRow>();
  if (!batch) return error(404, 'not_found', '归集批次不存在');
  const items = await env.DB.prepare(
    `SELECT i.*,a.customer_name,a.partner_customer_id
     FROM usdt_sweep_items i
     JOIN va_applications a ON a.id=i.application_id
     WHERE i.batch_id=? AND a.partner_key=?
     ORDER BY i.created_at`
  )
    .bind(id, PARTNER_KEY)
    .all<SweepItemRow>();
  return json({ data: normalizePartnerSweepBatch(batch, items.results) });
}

async function getSweepSettingResponse(env: Env) {
  const [setting, versions] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM sweep_settings WHERE id='ethan_tron_address'`
    ).first<SweepSettingRow>(),
    env.DB.prepare(
      `SELECT tron_address,version,changed_by,created_at
       FROM sweep_setting_versions
       WHERE setting_id='ethan_tron_address'
       ORDER BY version DESC LIMIT 20`
    ).all(),
  ]);
  return json({ data: setting, versions: versions.results });
}

async function updateSweepSetting(env: Env, request: Request) {
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const unknown = rejectUnknownFields(parsed, ['tron_address']);
  if (unknown) return unknown;
  const address = typeof parsed.tron_address === 'string' ? parsed.tron_address.trim() : '';
  if (!validCryptoAddress('TRON', address)) {
    return error(422, 'validation_error', '请输入有效的 TRON 地址');
  }
  const current = await env.DB.prepare(
    `SELECT * FROM sweep_settings WHERE id='ethan_tron_address'`
  ).first<SweepSettingRow>();
  if (!current) return error(500, 'sweep_setting_missing', '归集地址配置不存在');
  if (current.tron_address === address) return getSweepSettingResponse(env);
  const actor = trustedAccessReviewer(request);
  const now = new Date().toISOString();
  const version = current.version + 1;
  const [updated] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE sweep_settings
       SET tron_address=?,version=?,updated_by=?,updated_at=?
       WHERE id='ethan_tron_address' AND version=?`
    ).bind(address, version, actor, now, current.version),
    env.DB.prepare(
      `INSERT INTO sweep_setting_versions
        (id,setting_id,tron_address,version,changed_by,created_at)
       SELECT ?,'ethan_tron_address',?,?,?,?
       WHERE EXISTS (
         SELECT 1 FROM sweep_settings
         WHERE id='ethan_tron_address' AND version=? AND tron_address=?
       )`
    ).bind(
      `sweep_address_${crypto.randomUUID().replaceAll('-', '')}`,
      address,
      version,
      actor,
      now,
      version,
      address
    ),
    auditInsertStatement(
      env,
      null,
      'sweep_setting.address_updated',
      {
        previous_address: current.tron_address,
        tron_address: address,
        version,
        actor,
      },
      'operator',
      now
    ),
  ]);
  if (updated.meta.changes === 0) {
    return error(409, 'setting_changed', '白名单地址已被其他管理员更新，请刷新后重试');
  }
  return getSweepSettingResponse(env);
}

async function sweepCandidates(env: Env) {
  const result = await env.DB.prepare(
    `SELECT
       a.id application_id,
       a.customer_name,
       COALESCE(SUM(l.amount_minor),0) ledger_minor,
       COALESCE((
         SELECT SUM(f.amount_minor) FROM fund_transactions f
         WHERE f.application_id=a.id AND f.asset='USDT' AND f.network='TRON'
           AND f.type='usdt_withdrawal'
           AND f.status IN ('submitted','processing')
       ),0) reserved_funds,
       COALESCE((
         SELECT SUM(o.sell_amount_minor) FROM otc_orders o
         WHERE o.application_id=a.id AND o.sell_asset='USDT'
           AND o.sell_network='TRON'
           AND o.status IN ('submitted','processing')
       ),0) reserved_otc,
       COALESCE((
         SELECT SUM(i.amount_minor)
         FROM usdt_sweep_items i
         JOIN usdt_sweep_batches b ON b.id=i.batch_id
         WHERE i.application_id=a.id AND b.status IN ('locked','submitted')
       ),0) reserved_sweeps
     FROM va_applications a
     LEFT JOIN ledger_entries l
       ON l.application_id=a.id AND l.asset='USDT' AND l.network='TRON'
     WHERE a.status='active'
     GROUP BY a.id,a.customer_name
     ORDER BY a.customer_name`
  ).all<{
    application_id: string;
    customer_name: string;
    ledger_minor: number;
    reserved_funds: number;
    reserved_otc: number;
    reserved_sweeps: number;
  }>();
  return result.results
    .map((row) => {
      const reserved = row.reserved_funds + row.reserved_otc + row.reserved_sweeps;
      return {
        application_id: row.application_id,
        customer_name: row.customer_name,
        ledger_balance: minorToAmount(row.ledger_minor, 6),
        locked_amount: minorToAmount(row.reserved_sweeps, 6),
        available_amount: minorToAmount(row.ledger_minor - reserved, 6),
      };
    })
    .filter((row) => Number(row.ledger_balance) > 0);
}

async function listSweepBatches(env: Env, url: URL) {
  const status = url.searchParams.get('status')?.trim() || 'all';
  const query = url.searchParams.get('query')?.trim() || '';
  if (!['all', 'locked', 'submitted', 'completed', 'cancelled'].includes(status)) {
    return error(422, 'validation_error', '归集状态无效');
  }
  const conditions: string[] = [];
  const values: string[] = [];
  if (status !== 'all') {
    conditions.push('b.status=?');
    values.push(status);
  }
  if (query) {
    conditions.push(`(
      lower(b.id) LIKE lower(?) OR lower(COALESCE(b.tx_hash,'')) LIKE lower(?)
      OR EXISTS (
        SELECT 1 FROM usdt_sweep_items si
        JOIN va_applications sa ON sa.id=si.application_id
        WHERE si.batch_id=b.id
          AND (lower(sa.customer_name) LIKE lower(?) OR lower(sa.id) LIKE lower(?))
      )
    )`);
    const like = `%${query}%`;
    values.push(like, like, like, like);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [batches, items, candidates, summary] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM usdt_sweep_batches b ${where}
       ORDER BY b.created_at DESC LIMIT 100`
    )
      .bind(...values)
      .all<SweepBatchRow>(),
    env.DB.prepare(
      `SELECT i.*,a.customer_name,a.partner_customer_id
       FROM usdt_sweep_items i
       JOIN va_applications a ON a.id=i.application_id
       ORDER BY i.created_at`
    ).all<SweepItemRow>(),
    sweepCandidates(env),
    env.DB.prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN status IN ('locked','submitted')
          THEN total_amount_minor ELSE 0 END),0) locked_minor,
        COALESCE(SUM(CASE WHEN status IN ('locked','submitted')
          THEN 1 ELSE 0 END),0) pending_batches,
        COALESCE(SUM(CASE WHEN status='completed'
          AND substr(completed_at,1,10)=substr(strftime('%Y-%m-%dT%H:%M:%fZ','now'),1,10)
          THEN total_amount_minor ELSE 0 END),0) completed_today_minor
       FROM usdt_sweep_batches`
    ).first<{
      locked_minor: number;
      pending_batches: number;
      completed_today_minor: number;
    }>(),
  ]);
  const byBatch = new Map<string, SweepItemRow[]>();
  items.results.forEach((item) => {
    const current = byBatch.get(item.batch_id) || [];
    current.push(item);
    byBatch.set(item.batch_id, current);
  });
  const available = candidates.reduce((sum, row) => sum + Number(row.available_amount), 0);
  return json({
    data: batches.results.map((batch) => normalizeSweepBatch(batch, byBatch.get(batch.id) || [])),
    candidates,
    summary: {
      available_amount: available.toFixed(6).replace(/\.?0+$/, ''),
      locked_amount: minorToAmount(summary?.locked_minor || 0, 6),
      pending_batches: Number(summary?.pending_batches || 0),
      completed_today_amount: minorToAmount(summary?.completed_today_minor || 0, 6),
    },
  });
}

async function getSweepBatch(env: Env, id: string) {
  const [batch, items, deliveries] = await Promise.all([
    env.DB.prepare(`SELECT * FROM usdt_sweep_batches WHERE id=?`).bind(id).first<SweepBatchRow>(),
    env.DB.prepare(
      `SELECT i.*,a.customer_name,a.partner_customer_id
       FROM usdt_sweep_items i
       JOIN va_applications a ON a.id=i.application_id
       WHERE i.batch_id=? ORDER BY i.created_at`
    )
      .bind(id)
      .all<SweepItemRow>(),
    env.DB.prepare(
      `SELECT id,event_type,status,attempt_count,response_status,last_error,
        created_at,delivered_at
       FROM webhook_deliveries
       WHERE resource_type='usdt_sweep_batch' AND resource_id=?
       ORDER BY created_at DESC`
    )
      .bind(id)
      .all(),
  ]);
  if (!batch) return error(404, 'not_found', '归集批次不存在');
  return json({
    data: normalizeSweepBatch(batch, items.results),
    webhook_deliveries: deliveries.results,
  });
}

async function createSweepBatch(env: Env, request: Request) {
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const unknown = rejectUnknownFields(parsed, ['items', 'operator_note']);
  if (unknown) return unknown;
  if (!Array.isArray(parsed.items) || parsed.items.length === 0 || parsed.items.length > 100) {
    return error(422, 'validation_error', 'items 必须包含 1 至 100 位客户');
  }
  const seen = new Set<string>();
  const items: Array<{ applicationId: string; amountMinor: number }> = [];
  for (const input of parsed.items) {
    if (!isRecord(input)) return error(422, 'validation_error', '归集明细格式无效');
    const applicationId =
      typeof input.application_id === 'string' ? input.application_id.trim() : '';
    const amountMinor = amountToMinor(input.amount, 6);
    if (!applicationId || amountMinor instanceof Response || seen.has(applicationId)) {
      return error(422, 'validation_error', '客户不可重复且归集金额必须大于 0');
    }
    seen.add(applicationId);
    items.push({ applicationId, amountMinor });
  }
  const operatorNote = normalizeOptionalText(parsed.operator_note, 'operator_note', 1000);
  if (operatorNote instanceof Response) return operatorNote;
  const ownership = await env.DB.prepare(
    `SELECT COUNT(*) total,COUNT(DISTINCT partner_key) partner_count,
       MIN(partner_key) partner_key
     FROM va_applications
     WHERE status='active'
       AND id IN (${items.map(() => '?').join(',')})`
  )
    .bind(...items.map((item) => item.applicationId))
    .first<{ total: number; partner_count: number; partner_key: string | null }>();
  if (Number(ownership?.total || 0) !== items.length) {
    return error(422, 'account_not_active', '归集明细包含不存在或尚未开通的客户');
  }
  if (Number(ownership?.partner_count || 0) !== 1 || !ownership?.partner_key) {
    return error(422, 'mixed_partner_batch', '同一归集批次只能包含同一 Partner 的客户');
  }
  const customerIdentifiers = await env.DB.prepare(
    `SELECT id,partner_customer_id FROM va_applications
     WHERE id IN (${items.map(() => '?').join(',')})`
  )
    .bind(...items.map((item) => item.applicationId))
    .all<{ id: string; partner_customer_id: string | null }>();
  const partnerCustomerIds = new Map(
    customerIdentifiers.results.map((row) => [row.id, row.partner_customer_id])
  );
  const setting = await env.DB.prepare(
    `SELECT * FROM sweep_settings WHERE id='ethan_tron_address'`
  ).first<SweepSettingRow>();
  if (!setting?.tron_address || !validCryptoAddress('TRON', setting.tron_address)) {
    return error(409, 'sweep_address_missing', '请先配置 moventra TRON 白名单地址');
  }
  const totalMinor = items.reduce((sum, item) => sum + item.amountMinor, 0);
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) {
    return error(422, 'validation_error', '归集总额超出允许范围');
  }
  const id = `swp_${crypto.randomUUID().replaceAll('-', '')}`;
  const actor = trustedAccessReviewer(request);
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      `INSERT INTO usdt_sweep_batches
        (id,partner_key,status,network,destination_address,destination_version,
         total_amount_minor,asset_decimals,operator_note,created_by,created_at,updated_at)
       VALUES (?,?,'locked','TRON',?,?,?,6,?,?,?,?)`
    ).bind(
      id,
      ownership.partner_key,
      setting.tron_address,
      setting.version,
      totalMinor,
      operatorNote,
      actor,
      now,
      now
    ),
    ...items.map((item) =>
      env.DB.prepare(
        `INSERT INTO usdt_sweep_items
          (id,batch_id,application_id,amount_minor,asset_decimals,created_at)
         SELECT ?,?,?,?,6,?
         WHERE EXISTS (
           SELECT 1 FROM va_applications
           WHERE id=? AND status='active' AND partner_key=?
         )`
      ).bind(
        `swi_${crypto.randomUUID().replaceAll('-', '')}`,
        id,
        item.applicationId,
        item.amountMinor,
        now,
        item.applicationId,
        ownership.partner_key
      )
    ),
    customWebhookOutboxStatement(
      env,
      ownership.partner_key,
      'usdt_sweep.locked',
      'usdt_sweep_batch',
      id,
      null,
      'locked',
      now,
      {
        resource_type: 'usdt_sweep_batch',
        batch_id: id,
        status: 'locked',
        network: 'TRON',
        destination_address: setting.tron_address,
        total_amount: minorToAmount(totalMinor, 6),
        items: items.map((item) => ({
          application_id: item.applicationId,
          partner_customer_id: partnerCustomerIds.get(item.applicationId) || null,
          amount: minorToAmount(item.amountMinor, 6),
        })),
      },
      {
        table: 'usdt_sweep_batches',
        id,
        status: 'locked',
        updatedAt: now,
      }
    ),
    guardedAuditStatement(
      env,
      null,
      'usdt_sweep.locked',
      {
        batch_id: id,
        total_amount: minorToAmount(totalMinor, 6),
        customer_count: items.length,
        destination_address: setting.tron_address,
        actor,
      },
      'operator',
      now,
      {
        table: 'usdt_sweep_batches',
        id,
        status: 'locked',
        updatedAt: now,
      }
    ),
  ];
  try {
    await env.DB.batch(statements);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : '';
    if (message.includes('insufficient_sweep_available_balance')) {
      return error(409, 'insufficient_available_balance', '至少一位客户的 USDT/TRON 可用余额不足');
    }
    throw caught;
  }
  return getSweepBatch(env, id);
}

async function updateSweepBatch(
  env: Env,
  id: string,
  action: 'submit' | 'complete' | 'cancel',
  request: Request
) {
  const batch = await env.DB.prepare(`SELECT * FROM usdt_sweep_batches WHERE id=?`)
    .bind(id)
    .first<SweepBatchRow>();
  if (!batch) return error(404, 'not_found', '归集批次不存在');
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const allowed = action === 'submit' ? ['tx_hash', 'operator_note'] : ['operator_note'];
  const unknown = rejectUnknownFields(parsed, allowed);
  if (unknown) return unknown;
  const operatorNote = normalizeOptionalText(parsed.operator_note, 'operator_note', 1000);
  if (operatorNote instanceof Response) return operatorNote;
  const actor = trustedAccessReviewer(request);
  const now = new Date().toISOString();
  if (action === 'submit') {
    if (batch.status !== 'locked') {
      return error(409, 'invalid_status', '只有已锁定批次可以提交链上交易');
    }
    const txHash = typeof parsed.tx_hash === 'string' ? parsed.tx_hash.trim() : '';
    if (!/^[a-fA-F0-9]{64}$/.test(txHash)) {
      return error(422, 'validation_error', 'TRON Tx Hash 必须是 64 位十六进制字符串');
    }
    try {
      const [result] = await env.DB.batch([
        env.DB.prepare(
          `UPDATE usdt_sweep_batches
           SET status='submitted',tx_hash=?,operator_note=?,
             submitted_by=?,submitted_at=?,updated_at=?
           WHERE id=? AND status='locked'`
        ).bind(txHash.toLowerCase(), operatorNote, actor, now, now, id),
        guardedAuditStatement(
          env,
          null,
          'usdt_sweep.submitted',
          {
            batch_id: id,
            tx_hash: txHash.toLowerCase(),
            actor,
          },
          'operator',
          now,
          {
            table: 'usdt_sweep_batches',
            id,
            status: 'submitted',
            updatedAt: now,
          }
        ),
      ]);
      if (result.meta.changes === 0) {
        return error(409, 'invalid_status', '归集批次已被其他操作处理');
      }
    } catch (caught) {
      if ((caught instanceof Error ? caught.message : '').includes('UNIQUE')) {
        return error(409, 'duplicate_tx_hash', '该 Tx Hash 已用于其他归集批次');
      }
      throw caught;
    }
    return getSweepBatch(env, id);
  }
  if (action === 'cancel') {
    if (batch.status === 'submitted') {
      return error(
        409,
        'submitted_sweep_cannot_cancel',
        '已提交 Tx Hash 的归集不能取消，请核对链上结果后确认完成或进入人工对账'
      );
    }
    if (batch.status !== 'locked') {
      return error(409, 'invalid_status', '只有尚未提交 Tx Hash 的已锁定批次可以取消');
    }
    const [result] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE usdt_sweep_batches
         SET status='cancelled',operator_note=?,cancelled_by=?,
           cancelled_at=?,updated_at=?
         WHERE id=? AND status='locked'`
      ).bind(operatorNote, actor, now, now, id),
      customWebhookOutboxStatement(
        env,
        batch.partner_key,
        'usdt_sweep.cancelled',
        'usdt_sweep_batch',
        id,
        null,
        'cancelled',
        now,
        {
          resource_type: 'usdt_sweep_batch',
          batch_id: id,
          status: 'cancelled',
          total_amount: minorToAmount(batch.total_amount_minor, 6),
          destination_address: batch.destination_address,
          tx_hash: batch.tx_hash,
        },
        {
          table: 'usdt_sweep_batches',
          id,
          status: 'cancelled',
          updatedAt: now,
        }
      ),
      guardedAuditStatement(
        env,
        null,
        'usdt_sweep.cancelled',
        {
          batch_id: id,
          actor,
        },
        'operator',
        now,
        {
          table: 'usdt_sweep_batches',
          id,
          status: 'cancelled',
          updatedAt: now,
        }
      ),
    ]);
    if (result.meta.changes === 0) {
      return error(409, 'invalid_status', '归集批次已被其他操作处理');
    }
    return getSweepBatch(env, id);
  }
  if (batch.status !== 'submitted' || !batch.tx_hash) {
    return error(409, 'invalid_status', '只有已提交 Tx Hash 的批次可以确认完成');
  }
  const itemRows = await env.DB.prepare(
    `SELECT i.*,a.customer_name,a.partner_customer_id
     FROM usdt_sweep_items i
     JOIN va_applications a ON a.id=i.application_id
     WHERE i.batch_id=? ORDER BY i.created_at`
  )
    .bind(id)
    .all<SweepItemRow>();
  const completionStatements = itemRows.results.flatMap((item) => {
    const ledgerId = `led_${crypto.randomUUID().replaceAll('-', '')}`;
    return [
      env.DB.prepare(
        `INSERT INTO ledger_entries
          (id,application_id,source_type,source_id,asset,network,
           amount_minor,asset_decimals,entry_type,created_at)
         VALUES (?,?,'adjustment',?,'USDT','TRON',?,6,'adjustment_debit',?)`
      ).bind(ledgerId, item.application_id, item.id, -item.amount_minor, now),
      env.DB.prepare(
        `UPDATE usdt_sweep_items SET ledger_entry_id=?
         WHERE id=? AND ledger_entry_id IS NULL`
      ).bind(ledgerId, item.id),
    ];
  });
  const eventItems = itemRows.results.map((item) => ({
    application_id: item.application_id,
    partner_customer_id: item.partner_customer_id,
    customer_name: item.customer_name,
    amount: minorToAmount(item.amount_minor, 6),
  }));
  try {
    const results = await env.DB.batch([
      ...completionStatements,
      env.DB.prepare(
        `UPDATE usdt_sweep_batches
         SET status='completed',operator_note=?,completed_by=?,
           completed_at=?,updated_at=?
         WHERE id=? AND status='submitted' AND tx_hash IS NOT NULL`
      ).bind(operatorNote, actor, now, now, id),
      customWebhookOutboxStatement(
        env,
        batch.partner_key,
        'usdt_sweep.completed',
        'usdt_sweep_batch',
        id,
        null,
        'completed',
        now,
        {
          resource_type: 'usdt_sweep_batch',
          batch_id: id,
          status: 'completed',
          network: 'TRON',
          destination_address: batch.destination_address,
          total_amount: minorToAmount(batch.total_amount_minor, 6),
          tx_hash: batch.tx_hash,
          items: eventItems,
        },
        {
          table: 'usdt_sweep_batches',
          id,
          status: 'completed',
          updatedAt: now,
        }
      ),
      guardedAuditStatement(
        env,
        null,
        'usdt_sweep.completed',
        {
          batch_id: id,
          tx_hash: batch.tx_hash,
          total_amount: minorToAmount(batch.total_amount_minor, 6),
          customer_count: eventItems.length,
          actor,
        },
        'operator',
        now,
        {
          table: 'usdt_sweep_batches',
          id,
          status: 'completed',
          updatedAt: now,
        }
      ),
    ]);
    const batchUpdate = results[completionStatements.length];
    if (!batchUpdate || batchUpdate.meta.changes === 0) {
      return error(409, 'invalid_status', '归集批次已被其他操作处理');
    }
  } catch (caught) {
    if ((caught instanceof Error ? caught.message : '').includes('UNIQUE')) {
      const latest = await env.DB.prepare(`SELECT status FROM usdt_sweep_batches WHERE id=?`)
        .bind(id)
        .first<{ status: string }>();
      if (latest?.status === 'completed') return getSweepBatch(env, id);
    }
    throw caught;
  }
  return getSweepBatch(env, id);
}

type AuditLogRow = {
  id: string;
  application_id: string | null;
  customer_name: string | null;
  action: string;
  actor_type: string;
  metadata_json: string;
  created_at: string;
};

function parseAuditMetadata(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

async function listAuditLogs(env: Env, url: URL) {
  const applicationId = url.searchParams.get('application_id')?.trim() || '';
  const actorType = url.searchParams.get('actor_type')?.trim() || '';
  const action = url.searchParams.get('action')?.trim() || '';
  const pageValue = url.searchParams.get('page') || '1';
  const limitValue = url.searchParams.get('limit') || '50';
  if (actorType && actorType !== 'all' && !['operator', 'partner'].includes(actorType)) {
    return error(422, 'validation_error', 'actor_type 仅支持 operator 或 partner');
  }
  if (!/^[1-9]\d*$/.test(pageValue) || !/^[1-9]\d*$/.test(limitValue)) {
    return error(422, 'validation_error', 'page 和 limit 必须是正整数');
  }
  const page = Number(pageValue);
  const limit = Number(limitValue);
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit) || limit > 200) {
    return error(422, 'validation_error', 'page 超出范围，limit 最大为 200');
  }
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) {
    return error(422, 'validation_error', '分页范围过大');
  }

  const conditions: string[] = [];
  const values: Array<string | number> = [];
  if (applicationId) {
    conditions.push('l.application_id=?');
    values.push(applicationId);
  }
  if (actorType && actorType !== 'all') {
    conditions.push('l.actor_type=?');
    values.push(actorType);
  }
  if (action) {
    conditions.push('l.action=?');
    values.push(action);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [countRow, rows] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) total FROM audit_logs l ${where}`)
      .bind(...values)
      .first<{ total: number }>(),
    env.DB.prepare(
      `SELECT
        l.id,l.application_id,a.customer_name,l.action,l.actor_type,
        l.metadata_json,l.created_at
      FROM audit_logs l
      LEFT JOIN va_applications a ON a.id=l.application_id
      ${where}
      ORDER BY l.created_at DESC,l.id DESC
      LIMIT ? OFFSET ?`
    )
      .bind(...values, limit, offset)
      .all<AuditLogRow>(),
  ]);
  const total = Number(countRow?.total || 0);
  return json({
    data: rows.results.map((row) => ({
      id: row.id,
      application_id: row.application_id,
      customer_name: row.customer_name,
      action: row.action,
      actor_type: row.actor_type,
      metadata: parseAuditMetadata(row.metadata_json),
      created_at: row.created_at,
    })),
    meta: {
      count: rows.results.length,
      total,
      page,
      limit,
      total_pages: total ? Math.ceil(total / limit) : 0,
    },
  });
}

const PORTAL_NOTIFICATION_ACTIONS = [
  'application.created',
  'application.status_changed',
  'application.changes_requested',
  'application.resubmitted',
  'fund_transaction.created',
  'fund_transaction.status_changed',
  'fiat_deposit.cleared_and_converted',
  'api_integration.ip_allowlist_approved',
  'api_integration.ip_allowlist_rejected',
  'api_integration.webhook_approved',
  'api_integration.webhook_rejected',
  'api_integration.credential_rotation_approved',
  'api_integration.credential_rotation_rejected',
] as const;

const PORTAL_NOTIFICATION_ACTION_SQL = PORTAL_NOTIFICATION_ACTIONS.map(() => '?').join(',');

async function listPortalNotifications(env: Env, userId: string, url: URL) {
  const limitValue = url.searchParams.get('limit') || '50';
  if (!/^[1-9]\d*$/.test(limitValue)) {
    return error(422, 'validation_error', 'limit 必须是正整数');
  }
  const limit = Number(limitValue);
  if (!Number.isSafeInteger(limit) || limit > 100) {
    return error(422, 'validation_error', 'limit 最大为 100');
  }
  const [rows, unread] = await Promise.all([
    env.DB.prepare(
      `SELECT
        l.id,l.application_id,a.customer_name,l.action,l.metadata_json,l.created_at,
        CASE WHEN r.audit_log_id IS NULL THEN 0 ELSE 1 END AS is_read
      FROM audit_logs l
      LEFT JOIN va_applications a ON a.id=l.application_id
      LEFT JOIN portal_notification_reads r
        ON r.audit_log_id=l.id AND r.user_id=?
      WHERE l.action IN (${PORTAL_NOTIFICATION_ACTION_SQL})
      ORDER BY l.created_at DESC,l.id DESC
      LIMIT ?`
    )
      .bind(userId, ...PORTAL_NOTIFICATION_ACTIONS, limit)
      .all<{
        id: string;
        application_id: string | null;
        customer_name: string | null;
        action: string;
        metadata_json: string;
        created_at: string;
        is_read: number;
      }>(),
    env.DB.prepare(
      `SELECT COUNT(*) total
      FROM audit_logs l
      LEFT JOIN portal_notification_reads r
        ON r.audit_log_id=l.id AND r.user_id=?
      WHERE l.action IN (${PORTAL_NOTIFICATION_ACTION_SQL})
        AND r.audit_log_id IS NULL`
    )
      .bind(userId, ...PORTAL_NOTIFICATION_ACTIONS)
      .first<{ total: number }>(),
  ]);
  return json({
    data: rows.results.map((row) => ({
      id: row.id,
      application_id: row.application_id,
      customer_name: row.customer_name,
      action: row.action,
      metadata: parseAuditMetadata(row.metadata_json),
      created_at: row.created_at,
      is_read: Boolean(row.is_read),
    })),
    meta: { count: rows.results.length, unread: Number(unread?.total || 0), limit },
  });
}

async function readPortalNotification(env: Env, userId: string, notificationId: string) {
  const exists = await env.DB.prepare(
    `SELECT id FROM audit_logs WHERE id=? AND action IN (${PORTAL_NOTIFICATION_ACTION_SQL})`
  )
    .bind(notificationId, ...PORTAL_NOTIFICATION_ACTIONS)
    .first<{ id: string }>();
  if (!exists) return error(404, 'not_found', '通知不存在');
  await env.DB.prepare(
    `INSERT OR IGNORE INTO portal_notification_reads
    (user_id,audit_log_id,read_at) VALUES (?,?,?)`
  )
    .bind(userId, notificationId, new Date().toISOString())
    .run();
  return json({ data: { id: notificationId, is_read: true } });
}

async function readAllPortalNotifications(env: Env, userId: string) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO portal_notification_reads
      (user_id,audit_log_id,read_at)
    SELECT ?,l.id,? FROM audit_logs l
    WHERE l.action IN (${PORTAL_NOTIFICATION_ACTION_SQL})`
  )
    .bind(userId, now, ...PORTAL_NOTIFICATION_ACTIONS)
    .run();
  return json({ data: { read_at: now } });
}

type OverviewCustomerCounts = {
  total: number;
  active: number;
  onboarding: number;
};

type OverviewFundCounts = {
  deposits: number;
  withdrawals: number;
};

type OverviewOtcCounts = {
  otc: number;
};

type OverviewBalanceRow = {
  asset: string;
  network: string;
  asset_decimals: number;
  ledger_minor: number;
  reserved_funds: number;
  reserved_otc: number;
  reserved_sweeps: number;
};

async function getAdminOverview(env: Env) {
  const recentUrl = new URL(
    'https://internal.invalid/api/v1/admin/transactions?category=all&status=all&page=1&limit=8'
  );
  const [customerCounts, fundCounts, otcCounts, balanceResult, recentResponse] = await Promise.all([
    env.DB.prepare(
      `SELECT
          COUNT(*) total,
          COALESCE(SUM(CASE WHEN status='active' THEN 1 ELSE 0 END),0) active,
          COALESCE(SUM(CASE WHEN status<>'active' THEN 1 ELSE 0 END),0) onboarding
        FROM va_applications`
    ).first<OverviewCustomerCounts>(),
    env.DB.prepare(
      `SELECT
          COALESCE(SUM(CASE
            WHEN type IN ('fiat_deposit','usdt_deposit') THEN 1 ELSE 0 END),0) deposits,
          COALESCE(SUM(CASE
            WHEN type IN ('fiat_withdrawal','usdt_withdrawal') THEN 1 ELSE 0 END),0) withdrawals
        FROM fund_transactions
        WHERE status IN ('submitted','processing')`
    ).first<OverviewFundCounts>(),
    env.DB.prepare(
      `SELECT COUNT(*) otc
        FROM otc_orders
        WHERE status IN ('submitted','processing')`
    ).first<OverviewOtcCounts>(),
    env.DB.prepare(
      `SELECT
          ledger.asset,
          ledger.network,
          ledger.asset_decimals,
          ledger.ledger_minor,
          COALESCE((
            SELECT SUM(f.amount_minor)
            FROM fund_transactions f
            WHERE f.asset=ledger.asset
              AND COALESCE(f.network,'')=ledger.network
              AND f.type IN ('fiat_withdrawal','usdt_withdrawal')
              AND f.status IN ('submitted','processing')
          ),0) reserved_funds,
          COALESCE((
            SELECT SUM(o.sell_amount_minor)
            FROM otc_orders o
            WHERE o.sell_asset=ledger.asset
              AND o.sell_network=ledger.network
              AND o.status IN ('submitted','processing')
          ),0) reserved_otc,
          CASE WHEN ledger.asset='USDT' AND ledger.network='TRON' THEN COALESCE((
            SELECT SUM(i.amount_minor)
            FROM usdt_sweep_items i
            JOIN usdt_sweep_batches b ON b.id=i.batch_id
            WHERE b.status IN ('locked','submitted')
          ),0) ELSE 0 END reserved_sweeps
        FROM (
          SELECT
            asset,network,asset_decimals,SUM(amount_minor) ledger_minor
          FROM ledger_entries
          GROUP BY asset,network,asset_decimals
        ) ledger
        ORDER BY ledger.asset,ledger.network`
    ).all<OverviewBalanceRow>(),
    listTransactions(env, recentUrl, true),
  ]);
  const recentPayload = (await recentResponse.json()) as {
    data?: Array<Record<string, unknown>>;
  };
  const deposits = Number(fundCounts?.deposits || 0);
  const withdrawals = Number(fundCounts?.withdrawals || 0);
  const otc = Number(otcCounts?.otc || 0);

  return json({
    data: {
      customers: {
        total: Number(customerCounts?.total || 0),
        active: Number(customerCounts?.active || 0),
        onboarding: Number(customerCounts?.onboarding || 0),
      },
      pending: {
        deposits,
        withdrawals,
        otc,
        total: deposits + withdrawals + otc,
      },
      balances: balanceResult.results.map((row) => {
        const reservedMinor = row.reserved_funds + row.reserved_otc + row.reserved_sweeps;
        return {
          asset: row.asset,
          network: row.network || null,
          ledger_balance: minorToAmount(row.ledger_minor, row.asset_decimals),
          reserved: minorToAmount(reservedMinor, row.asset_decimals),
          available_balance: minorToAmount(row.ledger_minor - reservedMinor, row.asset_decimals),
          asset_decimals: row.asset_decimals,
        };
      }),
      recent_transactions: recentPayload.data || [],
    },
  });
}

async function listCustomers(env: Env, includeOperatorFields = false, url?: URL) {
  const query = url?.searchParams.get('q')?.trim().toLocaleLowerCase() || '';
  const status = url?.searchParams.get('status')?.trim() || 'all';
  const balanceState = url?.searchParams.get('balance_state')?.trim() || 'all';
  const partnerCustomerId = url?.searchParams.get('partner_customer_id')?.trim() || '';
  if (
    partnerCustomerId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(partnerCustomerId)
  ) {
    return error(422, 'invalid_partner_customer_id', '客户方客户 ID 必须是小写 UUID v4 字符串');
  }
  const pageValue = url?.searchParams.get('page') || '1';
  const limitValue = url?.searchParams.get('limit') || '100';
  if (!/^[1-9]\d*$/.test(pageValue) || !/^[1-9]\d*$/.test(limitValue)) {
    return error(422, 'validation_error', 'page 和 limit 必须是正整数');
  }
  const page = Number(pageValue);
  const limit = Number(limitValue);
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit) || limit > 100) {
    return error(422, 'validation_error', 'page 超出范围，limit 最大为 100');
  }
  if (!['all', 'with_balance', 'with_reserved'].includes(balanceState)) {
    return error(422, 'validation_error', 'balance_state 无效');
  }
  const [applications, balanceRows] = await Promise.all([
    env.DB.prepare(
      `${APPLICATION_SELECT}${
        includeOperatorFields ? '' : ' WHERE a.partner_key=?'
      } ORDER BY a.created_at DESC`
    )
      .bind(...(includeOperatorFields ? [] : [PARTNER_KEY]))
      .all<ApplicationRow>(),
    getBalanceRows(env, undefined, !includeOperatorFields),
  ]);
  const balancesByApplication = new Map<string, ReturnType<typeof normalizeBalance>[]>();
  balanceRows.forEach((row) => {
    const balances = balancesByApplication.get(row.application_id) || [];
    balances.push(normalizeBalance(row));
    balancesByApplication.set(row.application_id, balances);
  });
  const customers = applications.results.map((application) => ({
    ...normalizeApplication(application, includeOperatorFields),
    balances: balancesByApplication.get(application.id) || [],
  }));
  const filtered = customers.filter((customer) => {
    if (partnerCustomerId && customer.partner_customer_id !== partnerCustomerId) return false;
    if (status !== 'all' && customer.status !== status) return false;
    if (
      query &&
      !`${customer.customer_name || ''} ${customer.application_id || ''} ${
        customer.partner_customer_id || ''
      } ${customer.email || ''}`
        .toLocaleLowerCase()
        .includes(query)
    ) {
      return false;
    }
    const balances = customer.balances || [];
    if (
      balanceState === 'with_balance' &&
      !balances.some((balance) => Number(balance.ledger_balance || 0) !== 0)
    ) {
      return false;
    }
    if (
      balanceState === 'with_reserved' &&
      !balances.some((balance) => Number(balance.reserved || 0) > 0)
    ) {
      return false;
    }
    return true;
  });
  const offset = (page - 1) * limit;
  return json({
    data: filtered.slice(offset, offset + limit),
    meta: {
      count: Math.min(limit, Math.max(0, filtered.length - offset)),
      total: filtered.length,
      page,
      limit,
      snapshot_at: new Date().toISOString(),
    },
  });
}

async function getCustomerOverview(env: Env, applicationId: string, includeOperatorFields = false) {
  const application = await getApplication(env, applicationId, !includeOperatorFields);
  if (!application) return error(404, 'not_found', '客户不存在');
  const internalApplicationId = application.id;
  const [balanceRows, funds, otcOrders] = await Promise.all([
    getBalanceRows(env, internalApplicationId, !includeOperatorFields),
    env.DB.prepare(
      `SELECT f.*,a.customer_name,a.partner_customer_id FROM fund_transactions f
      JOIN va_applications a ON a.id=f.application_id
      WHERE f.application_id=?${
        includeOperatorFields ? '' : ' AND a.partner_key=?'
      } ORDER BY f.created_at DESC LIMIT 100`
    )
      .bind(
        ...(includeOperatorFields ? [internalApplicationId] : [internalApplicationId, PARTNER_KEY])
      )
      .all<FundRow>(),
    env.DB.prepare(
      `SELECT o.*,a.customer_name,a.partner_customer_id FROM otc_orders o
      JOIN va_applications a ON a.id=o.application_id
      WHERE o.application_id=?${
        includeOperatorFields ? '' : ' AND a.partner_key=?'
      } ORDER BY o.created_at DESC LIMIT 100`
    )
      .bind(
        ...(includeOperatorFields ? [internalApplicationId] : [internalApplicationId, PARTNER_KEY])
      )
      .all<OtcRow>(),
  ]);
  return json({
    customer: normalizeApplication(application, includeOperatorFields),
    balances: balanceRows.map(normalizeBalance),
    fund_transactions: funds.results.map((row) => normalizeFund(row, includeOperatorFields)),
    otc_orders: otcOrders.results.map((row) => normalizeOtc(row, includeOperatorFields)),
  });
}

async function routeApi(request: Request, env: WebhookEnv, requestId: string) {
  request = withoutAuthenticatedPrincipal(request);
  let authenticatedPrincipal: AuthPrincipal | null = null;
  let portalPrincipal: PortalTeamPrincipal | null = null;
  const incomingUrl = new URL(request.url);
  if (incomingUrl.pathname === '/api/auth' || incomingUrl.pathname.startsWith('/api/auth/')) {
    return handleAuthRequest(request, env);
  }

  const browserScopeMatch = incomingUrl.pathname.match(
    /^\/api\/browser\/v1\/(admin|portal)(?:\/|$)/
  );
  const legacyHumanScopeMatch = incomingUrl.pathname.match(/^\/api\/v1\/(admin|portal)(?:\/|$)/);
  const humanScope = browserScopeMatch?.[1] || legacyHumanScopeMatch?.[1];
  if (humanScope === 'admin' || humanScope === 'portal') {
    const requiredRole = humanScope === 'admin' ? 'admin' : 'partner';
    const authorization = browserScopeMatch
      ? await authorizeBrowserRequest(request, env, requiredRole)
      : await authorizeLegacyHumanRequest(request, env, requiredRole);
    if (authorization instanceof Response) return authorization;
    authenticatedPrincipal = authorization;
    if (requiredRole === 'partner') {
      const portalAuthorization = await resolvePortalTeamPrincipal(env, authorization);
      if (portalAuthorization instanceof Response) return portalAuthorization;
      portalPrincipal = portalAuthorization;
      authenticatedPrincipal = portalAuthorization;
    }
    request = withAuthenticatedPrincipal(request, authorization);
    if (browserScopeMatch) request = rewriteBrowserApiRequest(request);
  }

  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const isPartnerApiRoot = url.pathname === '/api/v1' || url.pathname === '/api/v1/';
  const adminBase = '/api/v1/admin/va-applications';
  const partnerBase = '/api/v1/va-applications';
  const scope =
    url.pathname === '/api/v1/admin' || url.pathname.startsWith('/api/v1/admin/')
      ? 'admin'
      : url.pathname === '/api/v1/portal' || url.pathname.startsWith('/api/v1/portal/')
      ? 'portal'
      : 'partner';
  const scopedPath = url.pathname.replace(`/api/v1/${scope === 'partner' ? '' : `${scope}/`}`, '/');

  if (scope === 'portal' && portalPrincipal) {
    const requiredPermission = portalPermissionForRequest(scopedPath, request.method);
    if (requiredPermission) {
      const permissionError = requirePortalTeamPermission(portalPrincipal, requiredPermission);
      if (permissionError) return permissionError;
    }
    if (scopedPath === '/reconciliation' || scopedPath === '/reconciliation/movements') {
      const balancePermissionError = requirePortalTeamPermission(portalPrincipal, 'balances.read');
      if (balancePermissionError) return balancePermissionError;
    }
    const teamResponse = await handlePortalTeamRequest(request, env, portalPrincipal);
    if (teamResponse) return teamResponse;
  }

  if (scope === 'partner' && (isPartnerApiRoot || url.pathname.startsWith('/api/v1/'))) {
    const ipRejection = await enforcePartnerApiIpAllowlist(env, request, url.pathname, requestId);
    if (ipRejection) return ipRejection;
    const rateLimit = await env.PARTNER_API_RATE_LIMITER.limit({
      key: 'partner:ethan:v1',
    });
    if (!rateLimit.success) {
      return json(
        {
          error: {
            code: 'rate_limit_exceeded',
            message: 'Partner API 请求过于频繁，请稍后重试',
          },
        },
        429,
        { 'retry-after': '60' }
      );
    }
  }

  if (isPartnerApiRoot) {
    if (request.method !== 'GET') {
      return error(405, 'method_not_allowed', '不支持该请求方法');
    }
    return json({
      name: 'VA BaaS Partner API',
      version: PARTNER_API_VERSION,
      status: 'ok',
      description: 'Partner API base URL. Use the links below to start integration.',
      links: {
        health: '/api/v1/health',
        openapi: '/api/v1/openapi.yaml',
        country_calling_codes: '/api/v1/country-calling-codes',
        portal_guide: '/portal/api-guide',
      },
    });
  }
  if (url.pathname === '/api/v1/health' && request.method === 'GET') {
    return json({ status: 'ok', service: 'va-api', time: new Date().toISOString() });
  }
  if (scopedPath === '/country-calling-codes') {
    if (request.method === 'GET') return listCountryCallingCodes();
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/openapi.yaml' && request.method === 'GET') {
    const assetUrl = new URL('/openapi.yaml', request.url);
    return env.ASSETS.fetch(new Request(assetUrl.toString()));
  }
  if (scopedPath === '/api-integration') {
    if (request.method === 'GET') {
      return listApiIntegration(env, scope === 'admin', request);
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/api-integration/deliveries' && scope === 'portal') {
    if (request.method === 'GET') return listPortalWebhookDeliveries(env, url);
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/api-integration/ip-allowlist-requests') {
    if (request.method === 'POST' && scope !== 'admin') {
      return createIpAllowlistRequest(env, request, scope === 'portal' ? 'portal' : 'api');
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/api-integration/webhook-requests') {
    if (request.method === 'POST' && scope !== 'admin') {
      return createWebhookRequest(env, request, scope === 'portal' ? 'portal' : 'api');
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/api-integration/credential-rotation-requests') {
    if (request.method === 'POST' && scope !== 'admin') {
      return createCredentialRotationRequest(env, request, scope === 'portal' ? 'portal' : 'api');
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  const credentialRotationCancelMatch = scopedPath.match(
    /^\/api-integration\/credential-rotation-requests\/([^/]+)\/cancel$/
  );
  const credentialRotationDetailMatch = scopedPath.match(
    /^\/api-integration\/credential-rotation-requests\/([^/]+)$/
  );
  if (credentialRotationDetailMatch) {
    if (request.method === 'GET') {
      return getCredentialRotationRequest(env, credentialRotationDetailMatch[1], scope === 'admin');
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (credentialRotationCancelMatch) {
    if (request.method === 'POST' && scope !== 'admin') {
      return cancelCredentialRotationRequest(env, credentialRotationCancelMatch[1]);
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  const credentialRotationReviewMatch = scopedPath.match(
    /^\/api-integration\/credential-rotation-requests\/([^/]+)\/(approve|reject)$/
  );
  if (credentialRotationReviewMatch) {
    if (request.method === 'POST' && scope === 'admin') {
      return reviewCredentialRotationRequest(
        env,
        credentialRotationReviewMatch[1],
        credentialRotationReviewMatch[2] as 'approve' | 'reject',
        request
      );
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  const credentialRevealMatch = scopedPath.match(
    /^\/api-integration\/credentials\/([^/]+)\/reveal$/
  );
  if (credentialRevealMatch) {
    if (
      request.method === 'POST' &&
      scope === 'portal' &&
      authenticatedPrincipal?.role === 'partner'
    ) {
      return revealApiCredential(env, credentialRevealMatch[1], request, authenticatedPrincipal);
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/api-integration/webhook-signing-key-requests') {
    if (request.method === 'POST' && scope !== 'admin') {
      return createWebhookSigningKeyRequest(env, request, scope === 'portal' ? 'portal' : 'api');
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  const webhookSigningKeyRequestCancelMatch = scopedPath.match(
    /^\/api-integration\/webhook-signing-key-requests\/([^/]+)\/cancel$/
  );
  if (webhookSigningKeyRequestCancelMatch) {
    if (request.method === 'POST' && scope !== 'admin') {
      return cancelWebhookSigningKeyRequest(env, webhookSigningKeyRequestCancelMatch[1]);
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  const webhookSigningKeyRequestReviewMatch = scopedPath.match(
    /^\/api-integration\/webhook-signing-key-requests\/([^/]+)\/(approve|reject)$/
  );
  if (webhookSigningKeyRequestReviewMatch) {
    if (request.method === 'POST' && scope === 'admin') {
      return reviewWebhookSigningKeyRequest(
        env,
        webhookSigningKeyRequestReviewMatch[1],
        webhookSigningKeyRequestReviewMatch[2] as 'approve' | 'reject',
        request
      );
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  const webhookSigningKeyRevealMatch = scopedPath.match(
    /^\/api-integration\/webhook-signing-keys\/([^/]+)\/reveal$/
  );
  if (webhookSigningKeyRevealMatch) {
    if (
      request.method === 'POST' &&
      scope === 'portal' &&
      authenticatedPrincipal?.role === 'partner'
    ) {
      return revealWebhookSigningSecret(
        env,
        webhookSigningKeyRevealMatch[1],
        request,
        authenticatedPrincipal
      );
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  const webhookSigningKeyActivateMatch = scopedPath.match(
    /^\/api-integration\/webhook-signing-keys\/([^/]+)\/activate$/
  );
  if (webhookSigningKeyActivateMatch) {
    if (
      request.method === 'POST' &&
      scope === 'portal' &&
      authenticatedPrincipal?.role === 'partner'
    ) {
      return activateWebhookSigningKey(
        env,
        webhookSigningKeyActivateMatch[1],
        request,
        authenticatedPrincipal
      );
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  const integrationRequestMatch = scopedPath.match(/^\/api-integration\/requests\/([^/]+)$/);
  if (integrationRequestMatch) {
    if (request.method === 'GET') {
      return getIntegrationRequest(env, integrationRequestMatch[1], scope === 'admin');
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  const integrationCancelMatch = scopedPath.match(/^\/api-integration\/requests\/([^/]+)\/cancel$/);
  if (integrationCancelMatch) {
    if (request.method === 'POST' && scope !== 'admin') {
      return cancelIntegrationRequest(env, integrationCancelMatch[1]);
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/api-integration/webhook-test') {
    if (request.method === 'POST' && scope !== 'admin') {
      return createWebhookTest(env);
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  const integrationReviewMatch = scopedPath.match(
    /^\/api-integration\/requests\/([^/]+)\/(approve|reject)$/
  );
  if (integrationReviewMatch) {
    if (request.method === 'POST' && scope === 'admin') {
      return reviewIntegrationRequest(
        env,
        integrationReviewMatch[1],
        integrationReviewMatch[2] as 'approve' | 'reject',
        request
      );
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  const deliveryRetryMatch = scopedPath.match(/^\/api-integration\/deliveries\/([^/]+)\/retry$/);
  if (scopedPath === '/api-integration/webhook-replays') {
    if (request.method === 'POST' && scope === 'admin') {
      return createWebhookReplay(env, request);
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (deliveryRetryMatch) {
    if (request.method === 'POST' && scope === 'admin') {
      return retryWebhookDelivery(env, deliveryRetryMatch[1]);
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/overview' && scope === 'admin') {
    if (request.method === 'GET') return getAdminOverview(env);
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/reconciliation' && scope !== 'partner') {
    if (request.method === 'GET') return getReconciliationSummary(env, url, scope === 'admin');
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/reconciliation/movements' && scope !== 'partner') {
    if (request.method === 'GET') return listTransactions(env, url, scope === 'admin');
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/audit-logs' && scope === 'admin') {
    if (request.method === 'GET') return listAuditLogs(env, url);
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (
    scopedPath === '/notifications' &&
    scope === 'portal' &&
    authenticatedPrincipal?.role === 'partner'
  ) {
    if (request.method === 'GET') {
      return listPortalNotifications(env, authenticatedPrincipal.userId, url);
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (
    scopedPath === '/notifications/read-all' &&
    scope === 'portal' &&
    authenticatedPrincipal?.role === 'partner'
  ) {
    if (request.method === 'POST') {
      return readAllPortalNotifications(env, authenticatedPrincipal.userId);
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  const portalNotificationReadMatch = scopedPath.match(/^\/notifications\/([^/]+)\/read$/);
  if (
    portalNotificationReadMatch &&
    scope === 'portal' &&
    authenticatedPrincipal?.role === 'partner'
  ) {
    if (request.method === 'POST') {
      return readPortalNotification(
        env,
        authenticatedPrincipal.userId,
        portalNotificationReadMatch[1]
      );
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/api-security' && scope === 'admin') {
    if (request.method === 'GET') return listApiSecurity(env);
    if (request.method === 'PATCH') return updateApiSecurity(env, request, requestId);
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/api-security/ip-allowlist' && scope === 'admin') {
    if (request.method === 'POST') return createApiIpAllowlist(env, request);
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  const apiIpAllowlistMatch = scopedPath.match(/^\/api-security\/ip-allowlist\/([^/]+)$/);
  if (apiIpAllowlistMatch && scope === 'admin') {
    if (request.method === 'PATCH') {
      return updateApiIpAllowlist(env, apiIpAllowlistMatch[1], request);
    }
    if (request.method === 'DELETE') {
      return deleteApiIpAllowlist(env, apiIpAllowlistMatch[1]);
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/conversion-settings/usd-usdt-tron' && scope === 'admin') {
    if (request.method === 'GET') return conversionSettingResponse(env);
    if (request.method === 'PATCH') return updateConversionSetting(env, request);
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/sweep-settings/ethan-tron-address' && scope === 'admin') {
    if (request.method === 'GET') return getSweepSettingResponse(env);
    if (request.method === 'PATCH') return updateSweepSetting(env, request);
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/sweep-batches' && scope === 'admin') {
    if (request.method === 'GET') return listSweepBatches(env, url);
    if (request.method === 'POST') return createSweepBatch(env, request);
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/sweep-batches' && scope !== 'admin') {
    if (request.method === 'GET') return listPartnerSweepBatches(env, url);
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  const sweepActionMatch = scopedPath.match(/^\/sweep-batches\/([^/]+)\/(submit|complete|cancel)$/);
  if (sweepActionMatch && scope === 'admin') {
    if (request.method === 'POST') {
      return updateSweepBatch(
        env,
        sweepActionMatch[1],
        sweepActionMatch[2] as 'submit' | 'complete' | 'cancel',
        request
      );
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  const sweepBatchMatch = scopedPath.match(/^\/sweep-batches\/([^/]+)$/);
  if (sweepBatchMatch && scope === 'admin') {
    if (request.method === 'GET') return getSweepBatch(env, sweepBatchMatch[1]);
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (sweepBatchMatch && scope !== 'admin') {
    if (request.method === 'GET') return getPartnerSweepBatch(env, sweepBatchMatch[1]);
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/customers' && request.method === 'GET') {
    return listCustomers(env, scope === 'admin', url);
  }
  const customerMatch = scopedPath.match(/^\/customers\/([^/]+)$/);
  if (customerMatch && request.method === 'GET') {
    return getCustomerOverview(env, customerMatch[1], scope === 'admin');
  }

  const applicationActionMatch = scopedPath.match(
    /^\/va-applications\/([^/]+)\/(request-changes|resubmit)$/
  );
  if (applicationActionMatch) {
    if (
      applicationActionMatch[2] === 'request-changes' &&
      request.method === 'POST' &&
      scope === 'admin'
    ) {
      return requestApplicationChanges(env, applicationActionMatch[1], request);
    }
    if (
      applicationActionMatch[2] === 'resubmit' &&
      request.method === 'POST' &&
      scope !== 'admin'
    ) {
      return resubmitApplication(env, applicationActionMatch[1], request);
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }

  if (url.pathname === adminBase || url.pathname === partnerBase) {
    if (request.method === 'GET') {
      return listApplications(env, url, url.pathname === adminBase);
    }
    if (request.method === 'POST') {
      return createApplication(env, request, url.pathname === adminBase ? 'operator' : 'partner');
    }
    return error(405, 'method_not_allowed', '不支持该请求方法', undefined);
  }

  if (
    (parts.length === 4 || parts.length === 5) &&
    parts[0] === 'api' &&
    parts[1] === 'v1' &&
    ((parts[2] === 'va-applications' && parts.length === 4) ||
      (parts[2] === 'admin' && parts[3] === 'va-applications' && parts.length === 5))
  ) {
    const isAdmin = parts[2] === 'admin';
    const id = isAdmin ? parts[4] : parts[3];
    if (request.method === 'GET') {
      const application = await getApplication(env, id, !isAdmin);
      return application
        ? json(normalizeApplication(application, isAdmin))
        : error(404, 'not_found', '开户申请不存在');
    }
    if (request.method === 'PATCH' && isAdmin) return updateApplication(env, id, request);
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }

  if (scopedPath === '/va-applications' && scope === 'portal') {
    if (request.method === 'GET') return listApplications(env, url);
    if (request.method === 'POST') return createApplication(env, request, 'partner');
  }
  const portalApplicationMatch = scopedPath.match(/^\/va-applications\/([^/]+)$/);
  if (portalApplicationMatch && scope === 'portal' && request.method === 'GET') {
    const application = await getApplication(env, portalApplicationMatch[1], true);
    return application
      ? json(normalizeApplication(application))
      : error(404, 'not_found', '开户申请不存在');
  }

  if (scopedPath === '/fund-transactions') {
    if (request.method === 'GET') {
      return listFunds(env, url, scope === 'admin');
    }
    if (request.method === 'POST') return createFund(env, request, scope !== 'admin');
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/transactions' && request.method === 'GET') {
    return listTransactions(env, url, scope === 'admin');
  }
  const fundMatch = scopedPath.match(/^\/fund-transactions\/([^/]+)$/);
  if (fundMatch) {
    if (request.method === 'GET') {
      return getFundById(env, fundMatch[1], scope === 'admin');
    }
    if (request.method === 'PATCH' && scope === 'admin') {
      return updateFund(env, fundMatch[1], request);
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/otc-orders') {
    if (request.method === 'GET') {
      return listOtc(env, url, scope === 'admin');
    }
    if (request.method === 'POST') {
      return error(
        403,
        'manual_otc_disabled',
        '客户手动 OTC 已关闭；法币清算后由系统自动兑换为 USDT/TRON'
      );
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  const otcMatch = scopedPath.match(/^\/otc-orders\/([^/]+)$/);
  if (otcMatch) {
    if (request.method === 'GET') {
      return getOtcById(env, otcMatch[1], scope === 'admin');
    }
    if (request.method === 'PATCH' && scope === 'admin') {
      return error(
        409,
        'otc_auto_settlement_enabled',
        'OTC 已改为自动校验并即时记账，无需后台审批'
      );
    }
    return error(405, 'method_not_allowed', '不支持该请求方法');
  }
  if (scopedPath === '/balances' && request.method === 'GET') {
    return listBalances(env, url, scope === 'admin');
  }
  if (scopedPath === '/ledger' && request.method === 'GET' && scope === 'admin')
    return listLedger(env, url);

  return error(404, 'not_found', 'API 路径不存在');
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();

    try {
      if (url.pathname.startsWith('/api/')) {
        const response = await routeApi(request, env, requestId);
        if (response.ok && !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
          ctx.waitUntil(processWebhookDeliveries(env, 10));
        }
        console.log(
          JSON.stringify({
            event: 'api_request',
            request_id: requestId,
            method: request.method,
            path: url.pathname,
            status: response.status,
          })
        );
        return secureResponse(response, true, requestId);
      }
      return secureResponse(await env.ASSETS.fetch(request));
    } catch (caught) {
      console.error(
        JSON.stringify({
          event: 'unhandled_error',
          request_id: requestId,
          method: request.method,
          path: url.pathname,
          message: caught instanceof Error ? caught.message : 'unknown error',
        })
      );
      return secureResponse(
        error(500, 'internal_error', '服务器处理请求失败', { request_id: requestId }),
        true,
        requestId
      );
    }
  },
  async scheduled(controller, env, ctx): Promise<void> {
    console.log(
      JSON.stringify({
        event: 'webhook_retry_schedule_started',
        cron: controller.cron,
        scheduled_time: controller.scheduledTime,
      })
    );
    ctx.waitUntil(processWebhookDeliveries(env, 25));
    ctx.waitUntil(cleanupExpiredAuthState(env));
  },
} satisfies ExportedHandler<Env>;
